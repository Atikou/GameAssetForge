"use strict";

const fs = require("fs/promises");
const path = require("path");

const {
  assertValidDocument,
  canonicalJson,
  createDefaultProject,
  hashProject,
  resolveProjectPath,
  sha256,
} = require("../protocol");
const { AtomicProjectTransaction, inspectTransactions, recoverTransactions } = require("./atomic-transaction");
const { ImageSpecError, asImageSpecError } = require("./errors");
const { acquireProjectLock, readLock } = require("./project-lock");
const { createReceipt } = require("./receipt");
const {
  PROJECT_SUFFIX,
  PROJECT_FILE,
  PROJECT_DIRECTORIES,
} = require("./project-layout");

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function readJson(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new ImageSpecError("IMAGESPEC_INVALID_JSON", `Invalid JSON: ${filePath}`, { filePath }, { cause: error });
    }
    throw error;
  }
}

function assertCanonicalProjectDir(projectDir, options = {}) {
  const resolved = path.resolve(projectDir);
  if (!options.allowNonCanonical && !resolved.toLowerCase().endsWith(PROJECT_SUFFIX)) {
    throw new ImageSpecError("IMAGESPEC_PROJECT_SUFFIX_REQUIRED", `ImageSpec project directory must end with ${PROJECT_SUFFIX}.`, { projectDir: resolved });
  }
  return resolved;
}

function revisionMatches(actual, expected) {
  return actual?.number === expected?.number && actual?.hash === expected?.hash;
}

function historyFileName(revisionNumber) {
  return `history/revision-${String(revisionNumber).padStart(6, "0")}.json`;
}

async function immutableJsonWrite(transaction, projectDir, relativePath, value) {
  const target = resolveProjectPath(projectDir, relativePath);
  if (await exists(target)) {
    const existing = await readJson(target);
    if (canonicalJson(existing) !== canonicalJson(value)) {
      throw new ImageSpecError("IMAGESPEC_IMMUTABLE_CONFLICT", `Immutable ImageSpec record already exists with different content: ${relativePath}`, { relativePath }, { statusCode: 409 });
    }
    return false;
  }
  transaction.stageJson(relativePath, value);
  return true;
}

class ProjectRepository {
  constructor(options = {}) {
    this.allowNonCanonical = Boolean(options.allowNonCanonical);
    this.lockOptions = options.lockOptions || {};
  }

  resolve(projectDir) {
    return assertCanonicalProjectDir(projectDir, { allowNonCanonical: this.allowNonCanonical });
  }

  async create(projectDir, projectOrOptions = {}) {
    const resolved = this.resolve(projectDir);
    if (await exists(resolved)) {
      const entries = await fs.readdir(resolved);
      if (entries.length) throw new ImageSpecError("IMAGESPEC_PROJECT_EXISTS", "Target ImageSpec project directory is not empty.", { projectDir: resolved }, { statusCode: 409 });
    } else {
      await fs.mkdir(resolved, { recursive: true });
    }

    for (const relativeDir of PROJECT_DIRECTORIES) await fs.mkdir(resolveProjectPath(resolved, relativeDir), { recursive: true });
    const project = projectOrOptions.$schema ? structuredClone(projectOrOptions) : createDefaultProject(projectOrOptions);
    project.revision = { number: 0, hash: null };
    project.revision.hash = hashProject(project);
    assertValidDocument("project", project);
    const transaction = new AtomicProjectTransaction(resolved);
    transaction.stageJson(PROJECT_FILE, project);
    transaction.stageJson(historyFileName(0), {
      type: "project.created",
      projectId: project.projectId,
      revision: project.revision,
      at: project.metadata.createdAt,
    });
    await transaction.commit();
    return this.inspect(resolved);
  }

  async read(projectDir, options = {}) {
    const resolved = this.resolve(projectDir);
    const projectPath = path.join(resolved, PROJECT_FILE);
    if (!(await exists(projectPath))) throw new ImageSpecError("IMAGESPEC_PROJECT_NOT_FOUND", "ImageSpec project.json was not found.", { projectDir: resolved }, { statusCode: 404 });
    const project = await readJson(projectPath);
    if (options.validate !== false) assertValidDocument("project", project);
    if (options.verifyHash !== false && project.revision?.hash !== hashProject(project)) {
      throw new ImageSpecError("IMAGESPEC_REVISION_HASH_MISMATCH", "ImageSpec project revision hash does not match project.json.", { expected: project.revision?.hash, actual: hashProject(project) }, { statusCode: 409 });
    }
    return project;
  }

  async inspect(projectDir) {
    const resolved = this.resolve(projectDir);
    const project = await this.read(resolved);
    const [transactions, lock, planNames, receiptNames] = await Promise.all([
      inspectTransactions(resolved),
      readLock(path.join(resolved, ".imagespec.lock")),
      fs.readdir(resolveProjectPath(resolved, "plans")).catch((error) => (error.code === "ENOENT" ? [] : Promise.reject(error))),
      fs.readdir(resolveProjectPath(resolved, "receipts")).catch((error) => (error.code === "ENOENT" ? [] : Promise.reject(error))),
    ]);
    return {
      projectDir: resolved,
      projectId: project.projectId,
      name: project.name,
      schemaVersion: project.schemaVersion,
      revision: project.revision,
      canvas: project.canvas,
      assetCount: project.assetGraph.nodes.length,
      regionCount: project.regions.length,
      exportPresetCount: project.exportPresets.length,
      pendingTransactions: transactions,
      lock,
      planCount: planNames.filter((name) => name.endsWith(".json")).length,
      receiptCount: receiptNames.filter((name) => name.endsWith(".json")).length,
    };
  }

  async savePlan(projectDir, plan) {
    const resolved = this.resolve(projectDir);
    const lock = await acquireProjectLock(resolved, this.lockOptions);
    try {
      await recoverTransactions(resolved);
      const project = await this.read(resolved);
      assertValidDocument("plan", plan, { project });
      const transaction = new AtomicProjectTransaction(resolved);
      await immutableJsonWrite(transaction, resolved, `plans/${plan.planId}.json`, plan);
      if (transaction.listWrites().length) await transaction.commit();
      return structuredClone(plan);
    } finally {
      await lock.release();
    }
  }

  async recover(projectDir) {
    const resolved = this.resolve(projectDir);
    const lock = await acquireProjectLock(resolved, this.lockOptions);
    try {
      return await recoverTransactions(resolved);
    } finally {
      await lock.release();
    }
  }

  async readPlan(projectDir, planId) {
    const resolved = this.resolve(projectDir);
    const plan = await readJson(resolveProjectPath(resolved, `plans/${planId}.json`));
    assertValidDocument("plan", plan, { semantic: false });
    return plan;
  }

  async listPlans(projectDir) {
    const resolved = this.resolve(projectDir);
    const names = await fs.readdir(resolveProjectPath(resolved, "plans"));
    const plans = [];
    for (const name of names.filter((entry) => entry.endsWith(".json")).sort()) {
      const plan = await readJson(resolveProjectPath(resolved, `plans/${name}`));
      assertValidDocument("plan", plan, { semantic: false });
      plans.push(plan);
    }
    return plans.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async listReceipts(projectDir) {
    const resolved = this.resolve(projectDir);
    const names = await fs.readdir(resolveProjectPath(resolved, "receipts"));
    const receipts = [];
    for (const name of names.filter((entry) => entry.endsWith(".json")).sort()) {
      const receipt = await readJson(resolveProjectPath(resolved, `receipts/${name}`));
      assertValidDocument("receipt", receipt);
      receipts.push(receipt);
    }
    return receipts.sort((a, b) => b.finishedAt.localeCompare(a.finishedAt));
  }

  async readFile(projectDir, relativePath) {
    const resolved = this.resolve(projectDir);
    return fs.readFile(resolveProjectPath(resolved, relativePath));
  }

  async findAssets(projectDir, query = "") {
    const project = await this.read(projectDir);
    const needle = String(query).trim().toLowerCase();
    return project.assetGraph.nodes.filter((asset) => {
      if (!needle) return true;
      return asset.id.toLowerCase().includes(needle) || asset.name.toLowerCase().includes(needle) || asset.tags?.some((tag) => tag.toLowerCase().includes(needle));
    });
  }

  async transact(projectDir, plan, worker) {
    const resolved = this.resolve(projectDir);
    const lock = await acquireProjectLock(resolved, this.lockOptions);
    const startedAt = new Date().toISOString();
    let current = null;
    try {
      await recoverTransactions(resolved);
      current = await this.read(resolved);
      assertValidDocument("plan", plan, { project: current });
      const transaction = new AtomicProjectTransaction(resolved);
      const result = await worker({
        project: structuredClone(current),
        projectDir: resolved,
        transaction,
        readFile: async (relativePath) => transaction.getStaged(relativePath) || fs.readFile(resolveProjectPath(resolved, relativePath)),
      });
      if (!result?.project) throw new ImageSpecError("IMAGESPEC_TRANSACTION_RESULT_REQUIRED", "Transaction worker did not return a project.");
      if (!result.validationResult?.ok) {
        await transaction.abort();
        return await this.recordOutcomeUnlocked(resolved, current, plan, {
          status: result.status || "failed",
          startedAt,
          changedAssets: [],
          generatedFiles: [],
          validationResult: result.validationResult || { ok: false, issues: [] },
          warnings: result.warnings || [],
          error: result.error || { code: "IMAGESPEC_VALIDATION_FAILED", message: "Transaction validation failed." },
          adapters: result.adapters || [],
          provenance: result.provenance || {},
        });
      }
      return await this.commitRevisionUnlocked(resolved, current, plan, transaction, result, startedAt);
    } catch (error) {
      const normalized = asImageSpecError(error);
      if (current && plan?.planId && plan?.projectId === current.projectId) {
        try {
          const status = normalized.code === "IMAGESPEC_PLAN_STALE" || normalized.code === "IMAGESPEC_VALIDATION_FAILED" && normalized.details?.issues?.some?.((entry) => entry.code === "plan.stale") ? "stale" : "failed";
          const receipt = await this.recordOutcomeUnlocked(resolved, current, plan, {
            status,
            startedAt,
            validationResult: { ok: false, issues: [{ code: normalized.code, severity: "error", message: normalized.message, details: normalized.details || {} }] },
            error: { code: normalized.code, message: normalized.message, details: normalized.details || {} },
          });
          normalized.receipt = receipt;
        } catch (receiptError) {
          normalized.receiptError = receiptError.message;
        }
      }
      throw normalized;
    } finally {
      await lock.release();
    }
  }

  async commitRevisionUnlocked(projectDir, current, plan, transaction, result, startedAt) {
    const nextProject = structuredClone(result.project);
    const oldRevision = structuredClone(current.revision);
    const provisionalRevision = { number: oldRevision.number + 1, hash: null };
    const receiptId = result.receiptId || require("../protocol").createId("receipt");
    nextProject.metadata.updatedAt = new Date().toISOString();
    nextProject.revision = provisionalRevision;
    nextProject.operationHistory.push({
      planId: plan.planId,
      receiptId,
      status: "succeeded",
      oldRevision,
      newRevision: structuredClone(provisionalRevision),
      at: nextProject.metadata.updatedAt,
    });
    nextProject.revision.hash = hashProject(nextProject);
    assertValidDocument("project", nextProject);

    const receipt = createReceipt({
      ...result,
      receiptId,
      plan,
      status: "succeeded",
      startedAt,
      oldRevision,
      newRevision: nextProject.revision,
      finishedAt: new Date().toISOString(),
    });
    assertValidDocument("receipt", receipt);
    const validationReport = {
      projectId: nextProject.projectId,
      revision: nextProject.revision,
      generatedAt: receipt.finishedAt,
      ...structuredClone(result.validationResult),
    };
    const history = {
      type: "project.revision",
      projectId: nextProject.projectId,
      planId: plan.planId,
      receiptId: receipt.receiptId,
      oldRevision,
      newRevision: nextProject.revision,
      changedAssets: receipt.changedAssets,
      generatedFiles: receipt.generatedFiles,
      at: receipt.finishedAt,
    };

    await immutableJsonWrite(transaction, projectDir, `plans/${plan.planId}.json`, plan);
    transaction.stageJson(PROJECT_FILE, nextProject);
    transaction.stageJson("validation-report.json", validationReport);
    await immutableJsonWrite(transaction, projectDir, `receipts/${receipt.receiptId}.json`, receipt);
    await immutableJsonWrite(transaction, projectDir, historyFileName(nextProject.revision.number), history);
    await transaction.commit();
    return { project: nextProject, receipt, validationReport };
  }

  async recordOutcomeUnlocked(projectDir, current, plan, options) {
    const status = options.status || "failed";
    const receipt = createReceipt({
      ...options,
      plan,
      status,
      oldRevision: current.revision,
      newRevision: current.revision,
      finishedAt: new Date().toISOString(),
      changedAssets: [],
      generatedFiles: [],
    });
    assertValidDocument("receipt", receipt);
    const transaction = new AtomicProjectTransaction(projectDir);
    await immutableJsonWrite(transaction, projectDir, `plans/${plan.planId}.json`, plan);
    await immutableJsonWrite(transaction, projectDir, `receipts/${receipt.receiptId}.json`, receipt);
    await immutableJsonWrite(transaction, projectDir, `history/outcome-${receipt.receiptId}.json`, {
      type: "project.outcome",
      projectId: current.projectId,
      planId: plan.planId,
      receiptId: receipt.receiptId,
      status,
      revision: current.revision,
      at: receipt.finishedAt,
    });
    await transaction.commit();
    return receipt;
  }
}

module.exports = {
  ProjectRepository,
  assertCanonicalProjectDir,
  revisionMatches,
  historyFileName,
  readJson,
};
