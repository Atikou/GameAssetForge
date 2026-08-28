"use strict";

const {
  assertValidDocument,
  createOperationPlan,
  sha256,
} = require("../protocol");
const { createDefaultRunnerRegistry } = require("../runner");
const { validatePlanMutation, validateProjectFiles } = require("../validator");
const { buildProjectOutputs, exportProjectArchive } = require("../builder");
const { ImageSpecError } = require("./errors");
const { applyOperations, previewOperations } = require("./operations");
const { ProjectRepository } = require("./project-repository");

function operationNeedsApproval(project, operation, runner) {
  if (operation.requiresApproval) return true;
  if (["asset.replaceSource", "asset.generate", "asset.reconstruct", "asset.delete"].includes(operation.op)) return true;
  const asset = operation.targetId ? project.assetGraph.nodes.find((candidate) => candidate.id === operation.targetId) : null;
  if (asset?.editPolicy.requiresApproval) return true;
  const capability = operation.params?.capability ? runner.get(operation.params.capability) : null;
  return Boolean(capability?.requiresApproval);
}

function combineValidationResults(...results) {
  const issues = results.flatMap((result) => result?.issues || []);
  return { ok: !issues.some((entry) => entry.severity === "error"), issues };
}

function planActionResult(summary) {
  return { summary, generatedFiles: [], adapters: [], warnings: [], changes: [], affectedAssets: [] };
}

class ImageSpecService {
  constructor(options = {}) {
    this.repository = options.repository || new ProjectRepository(options.repositoryOptions);
    this.runner = options.runner || createDefaultRunnerRegistry(options.runnerOptions);
  }

  createProject(projectDir, options) {
    return this.repository.create(projectDir, options);
  }

  inspectProject(projectDir) {
    return this.repository.inspect(projectDir);
  }

  recoverProject(projectDir) {
    return this.repository.recover(projectDir);
  }

  readProject(projectDir) {
    return this.repository.read(projectDir);
  }

  listPlans(projectDir) {
    return this.repository.listPlans(projectDir);
  }

  listReceipts(projectDir) {
    return this.repository.listReceipts(projectDir);
  }

  readProjectFile(projectDir, relativePath) {
    return this.repository.readFile(projectDir, relativePath);
  }

  findAssets(projectDir, query) {
    return this.repository.findAssets(projectDir, query);
  }

  listCapabilities() {
    return this.runner.list();
  }

  async createPlan(projectDir, input = {}, options = {}) {
    const project = await this.repository.read(projectDir);
    let plan = input.$schema ? structuredClone(input) : createOperationPlan(project, input);
    plan.requiredApproval =
      plan.requiredApproval ||
      plan.ambiguities.length > 0 ||
      plan.operations.some((operation) => operationNeedsApproval(project, operation, this.runner));
    plan.status = plan.ambiguities.length ? "ambiguous" : plan.requiredApproval ? "needs_confirmation" : "planned";
    assertValidDocument("plan", plan, { project });
    plan = await previewOperations(project, plan, {
      runner: this.runner,
      projectActions: {
        "project.validate": async () => planActionResult("Project validation will run."),
        "project.build": async ({ operation }) => planActionResult(`Preset ${operation.params.presetId} will be built.`),
        "project.export": async ({ operation }) => planActionResult(`Preset ${operation.params.presetId} will be exported to ${operation.params.destinationPath}.`),
      },
    });
    assertValidDocument("plan", plan, { project });
    if (options.save !== false) await this.repository.savePlan(projectDir, plan);
    return plan;
  }

  async getPlan(projectDir, planOrId) {
    if (typeof planOrId === "string") return this.repository.readPlan(projectDir, planOrId);
    return structuredClone(planOrId);
  }

  async previewPlan(projectDir, planOrId) {
    const [project, plan] = await Promise.all([this.repository.read(projectDir), this.getPlan(projectDir, planOrId)]);
    return previewOperations(project, plan, {
      runner: this.runner,
      projectActions: {
        "project.validate": async () => planActionResult("Project validation will run."),
        "project.build": async ({ operation }) => planActionResult(`Preset ${operation.params.presetId} will be built.`),
        "project.export": async ({ operation }) => planActionResult(`Preset ${operation.params.presetId} will be exported to ${operation.params.destinationPath}.`),
      },
    });
  }

  async validateProject(projectDir, options = {}) {
    const project = await this.repository.read(projectDir);
    return validateProjectFiles(projectDir, project, { forBuild: Boolean(options.forBuild) });
  }

  async applyPlan(projectDir, planOrId, options = {}) {
    const plan = await this.getPlan(projectDir, planOrId);
    if (plan.ambiguities.length || plan.status === "ambiguous") {
      throw new ImageSpecError("IMAGESPEC_PLAN_AMBIGUOUS", "Ambiguous ImageSpec plan cannot be applied.", { ambiguities: plan.ambiguities }, { statusCode: 409 });
    }
    if (plan.requiredApproval && !options.approved) {
      throw new ImageSpecError("IMAGESPEC_APPROVAL_REQUIRED", "ImageSpec plan requires explicit approval before apply.", { planId: plan.planId }, { statusCode: 409 });
    }
    return this.repository.transact(projectDir, plan, async ({ project, projectDir: resolved, transaction, readFile }) => {
      const beforeProject = structuredClone(project);
      const projectActions = {
        "project.validate": async ({ project: draft }) => {
          const validation = await validateProjectFiles(resolved, draft, { readFile });
          const changes = [];
          const affectedAssets = [];
          for (const asset of draft.assetGraph.nodes) {
            if (!asset.source.path || ["composite", "text"].includes(asset.type)) continue;
            const hasAssetError = validation.issues.some((entry) => entry.severity === "error" && entry.assetId === asset.id);
            if (!hasAssetError && asset.state !== "validated" && asset.state !== "exportable") {
              const before = asset.state;
              asset.state = "validated";
              changes.push({ path: `asset.${asset.id}.state`, before, after: asset.state });
              affectedAssets.push(asset.id);
            }
          }
          return { summary: validation.ok ? "Project validation passed." : "Project validation failed.", validation, changes, affectedAssets };
        },
        "project.build": async ({ project: draft, operation }) => {
          const build = await buildProjectOutputs(resolved, draft, operation.params.presetId, { transaction, readFile });
          const changes = [];
          const affectedAssets = [];
          for (const built of build.builtAssets) {
            const asset = draft.assetGraph.nodes.find((candidate) => candidate.id === built.assetId);
            if (asset && asset.state !== "exportable") {
              const before = asset.state;
              asset.state = "exportable";
              changes.push({ path: `asset.${asset.id}.state`, before, after: asset.state });
              affectedAssets.push(asset.id);
            }
          }
          return { summary: `Built ${build.builtAssets.length} asset output(s).`, ...build, changes, affectedAssets, adapters: [{ id: "gameassetforge.builder", version: "1" }] };
        },
        "project.export": async ({ project: draft, operation }) => {
          const exported = await exportProjectArchive(resolved, draft, operation.params.presetId, operation.params.destinationPath, { transaction, readFile });
          const changes = [];
          const affectedAssets = [];
          for (const built of exported.builtAssets) {
            const asset = draft.assetGraph.nodes.find((candidate) => candidate.id === built.assetId);
            if (asset && asset.state !== "exportable") {
              const before = asset.state;
              asset.state = "exportable";
              changes.push({ path: `asset.${asset.id}.state`, before, after: asset.state });
              affectedAssets.push(asset.id);
            }
          }
          return { summary: `Exported ${exported.builtAssets.length} asset output(s).`, ...exported, changes, affectedAssets, adapters: [{ id: "gameassetforge.exporter", version: "1" }] };
        },
      };

      const applied = await applyOperations(project, plan, {
        projectDir: resolved,
        transaction,
        readFile,
        runner: this.runner,
        signal: options.signal,
        projectActions,
        dryRun: false,
      });
      const mutationValidation = await validatePlanMutation(beforeProject, applied.project, plan, { snapshots: applied.snapshots });
      const projectValidation = await validateProjectFiles(resolved, applied.project, { readFile });
      const validationResult = combineValidationResults(...applied.validationResults, mutationValidation, projectValidation);
      validationResult.reportPath = "validation-report.json";
      return {
        project: applied.project,
        changedAssets: applied.affectedAssets,
        generatedFiles: applied.generatedFiles,
        validationResult,
        warnings: applied.warnings,
        adapters: applied.adapters,
        provenance: options.approval
          ? { requestId: options.approval.id || `approval-${Date.now()}` }
          : {},
      };
    });
  }

  async createValidationPlan(projectDir, options = {}) {
    const project = await this.repository.read(projectDir);
    const affectedAssets = project.assetGraph.nodes.filter((asset) => asset.source.path && !["composite", "text"].includes(asset.type)).map((asset) => asset.id);
    return this.createPlan(projectDir, {
      planId: options.planId,
      sourceUserRequest: options.sourceUserRequest || "Validate the ImageSpec project and advance passing assets to validated state.",
      affectedAssets,
      operations: [
        {
          operationId: options.operationId || "operation.project.validate",
          op: "project.validate",
          targetId: null,
          params: {},
          allowedChanges: ["validation-report.json", "asset.*"],
          deniedChanges: ["canvas", "source"],
          requiresApproval: false,
        },
      ],
      requiredApproval: false,
    });
  }

  async createBuildPlan(projectDir, presetId, options = {}) {
    const project = await this.repository.read(projectDir);
    const affectedAssets = project.assetGraph.nodes.filter((asset) => asset.exportPolicy.enabled).map((asset) => asset.id);
    return this.createPlan(projectDir, {
      planId: options.planId,
      sourceUserRequest: options.sourceUserRequest || `Build export preset ${presetId}.`,
      affectedAssets,
      operations: [
        {
          operationId: options.operationId || "operation.project.build",
          op: "project.build",
          targetId: null,
          params: { presetId },
          allowedChanges: [`build:${presetId}`, "asset.*"],
          deniedChanges: ["canvas", "source"],
          requiresApproval: false,
        },
      ],
      requiredApproval: false,
    });
  }

  async createExportPlan(projectDir, presetId, destinationPath, options = {}) {
    const project = await this.repository.read(projectDir);
    const affectedAssets = project.assetGraph.nodes.filter((asset) => asset.exportPolicy.enabled).map((asset) => asset.id);
    return this.createPlan(projectDir, {
      planId: options.planId,
      sourceUserRequest: options.sourceUserRequest || `Export preset ${presetId} to ${destinationPath}.`,
      affectedAssets,
      operations: [
        {
          operationId: options.operationId || "operation.project.export",
          op: "project.export",
          targetId: null,
          params: { presetId, destinationPath },
          allowedChanges: [`export:${destinationPath}`, "asset.*"],
          deniedChanges: ["canvas", "source"],
          requiresApproval: false,
        },
      ],
      requiredApproval: false,
    });
  }
}

module.exports = {
  ImageSpecService,
  combineValidationResults,
  operationNeedsApproval,
};
