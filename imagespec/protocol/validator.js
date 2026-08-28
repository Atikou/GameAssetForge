"use strict";

const Ajv2020 = require("ajv/dist/2020");
const addFormats = require("ajv-formats");

const commonSchema = require("./schemas/common.schema.json");
const projectSchema = require("./schemas/project.schema.json");
const planSchema = require("./schemas/operation-plan.schema.json");
const receiptSchema = require("./schemas/receipt.schema.json");
const { isSafeRelativePath } = require("./paths");

const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });
addFormats(ajv);
ajv.addSchema(commonSchema);
const validators = {
  project: ajv.compile(projectSchema),
  plan: ajv.compile(planSchema),
  receipt: ajv.compile(receiptSchema),
};

function issue(code, message, path = "", details = {}, severity = "error") {
  return { code, severity, message, ...(path ? { path } : {}), ...(Object.keys(details).length ? { details } : {}) };
}

function schemaIssues(errors = []) {
  return errors.map((error) =>
    issue(
      `schema.${error.keyword}`,
      error.message || "Schema validation failed.",
      error.instancePath || "/",
      { schemaPath: error.schemaPath, params: error.params },
    ),
  );
}

function duplicateIssues(items, label, pathPrefix) {
  const seen = new Set();
  const issues = [];
  items.forEach((item, index) => {
    if (seen.has(item.id)) issues.push(issue("id.duplicate", `Duplicate ${label} id: ${item.id}`, `${pathPrefix}/${index}/id`, { id: item.id }));
    seen.add(item.id);
  });
  return issues;
}

function assetCycleIssues(assets) {
  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  const visiting = new Set();
  const visited = new Set();
  const issues = [];

  function visit(asset, chain = []) {
    if (visited.has(asset.id)) return;
    if (visiting.has(asset.id)) {
      const start = chain.indexOf(asset.id);
      const cycle = [...chain.slice(Math.max(0, start)), asset.id];
      issues.push(issue("graph.cycle", `AssetGraph cycle: ${cycle.join(" -> ")}`, "/assetGraph/nodes", { cycle }));
      return;
    }
    visiting.add(asset.id);
    if (asset.parentId && byId.has(asset.parentId)) visit(byId.get(asset.parentId), [...chain, asset.id]);
    visiting.delete(asset.id);
    visited.add(asset.id);
  }

  assets.forEach((asset) => visit(asset));
  return issues;
}

function collectProjectPaths(project) {
  const entries = [];
  const add = (value, path) => {
    if (value !== undefined && value !== null) entries.push({ value, path });
  };
  project.designSystem?.references?.forEach((reference, index) => add(reference.path, `/designSystem/references/${index}/path`));
  project.assetGraph?.nodes?.forEach((asset, index) => {
    add(asset.source?.path, `/assetGraph/nodes/${index}/source/path`);
    add(asset.source?.provenanceRef, `/assetGraph/nodes/${index}/source/provenanceRef`);
    for (const [name, value] of Object.entries(asset.masks || {})) add(value, `/assetGraph/nodes/${index}/masks/${name}`);
  });
  project.regions?.forEach((region, index) => {
    for (const [name, value] of Object.entries(region.masks || {})) add(value, `/regions/${index}/masks/${name}`);
  });
  project.exportPresets?.forEach((preset, index) => add(preset.outputDir, `/exportPresets/${index}/outputDir`));
  return entries;
}

function semanticProjectIssues(project) {
  const issues = [];
  const assets = project.assetGraph?.nodes || [];
  const regions = project.regions || [];
  const presets = project.exportPresets || [];
  const rules = project.validationRules || [];
  const references = project.designSystem?.references || [];
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]));

  issues.push(...duplicateIssues(assets, "asset", "/assetGraph/nodes"));
  issues.push(...duplicateIssues(regions, "region", "/regions"));
  issues.push(...duplicateIssues(presets, "export preset", "/exportPresets"));
  issues.push(...duplicateIssues(rules, "validation rule", "/validationRules"));
  issues.push(...duplicateIssues(references, "reference", "/designSystem/references"));
  issues.push(...assetCycleIssues(assets));

  const globalIds = new Map();
  [
    [assets, "asset"],
    [regions, "region"],
    [presets, "preset"],
    [rules, "rule"],
    [references, "reference"],
  ].forEach(([items, kind]) => {
    items.forEach((item) => {
      if (globalIds.has(item.id)) issues.push(issue("id.globalDuplicate", `Id ${item.id} is shared by ${globalIds.get(item.id)} and ${kind}.`, "/", { id: item.id }));
      else globalIds.set(item.id, kind);
    });
  });

  assets.forEach((asset, index) => {
    const base = `/assetGraph/nodes/${index}`;
    if (asset.parentId && !assetsById.has(asset.parentId)) {
      issues.push(issue("graph.missingParent", `Missing parent asset: ${asset.parentId}`, `${base}/parentId`, { assetId: asset.id, parentId: asset.parentId }));
    }
    const sourceNeedsPath = ["file", "generated", "legacyFlattened"].includes(asset.source.kind);
    if (sourceNeedsPath && !asset.source.path) issues.push(issue("source.pathRequired", `Asset ${asset.id} requires a source path.`, `${base}/source`));
    if (asset.source.path && !asset.source.sha256) issues.push(issue("source.hashRequired", `Asset ${asset.id} requires a source hash.`, `${base}/source/sha256`));
    if (asset.source.kind === "text" && asset.source.text === undefined) issues.push(issue("source.textRequired", `Text asset ${asset.id} requires source.text.`, `${base}/source/text`));
    if (asset.type === "text" && asset.exportPolicy.enabled) issues.push(issue("text.dynamicBaking", `Dynamic text asset ${asset.id} cannot be baked as an exported image.`, `${base}/exportPolicy/enabled`));
    if (asset.type === "nineSlice" && !asset.exportPolicy.nineSlice) issues.push(issue("nineSlice.required", `nineSlice asset ${asset.id} requires border data.`, `${base}/exportPolicy/nineSlice`));
    if (asset.exportPolicy.format === "jpg" && !["background", "baked"].includes(asset.type)) {
      issues.push(issue("export.jpgTransparency", `Asset ${asset.id} may require transparency and cannot export as JPG.`, `${base}/exportPolicy/format`));
    }
    for (const referenceId of asset.generationRule.referenceIds) {
      if (!references.some((reference) => reference.id === referenceId)) {
        issues.push(issue("reference.missing", `Asset ${asset.id} uses missing reference ${referenceId}.`, `${base}/generationRule/referenceIds`, { referenceId }));
      }
    }
  });

  regions.forEach((region, index) => {
    region.associatedAssetIds.forEach((assetId) => {
      if (!assetsById.has(assetId)) issues.push(issue("region.missingAsset", `Region ${region.id} references missing asset ${assetId}.`, `/regions/${index}/associatedAssetIds`, { assetId }));
    });
    if (["polygon", "brush"].includes(region.geometry.type) && !region.geometry.points?.length) {
      issues.push(issue("region.pointsRequired", `${region.geometry.type} region ${region.id} requires points.`, `/regions/${index}/geometry/points`));
    }
  });

  const exportNames = new Map();
  assets.forEach((asset, index) => {
    if (!asset.exportPolicy.enabled) return;
    const key = asset.exportPolicy.fileName.toLowerCase();
    if (exportNames.has(key)) issues.push(issue("export.duplicateFileName", `Duplicate export filename: ${asset.exportPolicy.fileName}`, `/assetGraph/nodes/${index}/exportPolicy/fileName`, { otherAssetId: exportNames.get(key) }));
    else exportNames.set(key, asset.id);
  });

  collectProjectPaths(project).forEach(({ value, path }) => {
    if (!isSafeRelativePath(value)) issues.push(issue("path.unsafe", `Path escapes the project: ${value}`, path, { value }));
  });
  return issues;
}

const REQUIRED_PARAMS = {
  "asset.import": ["sourcePath", "name", "type"],
  "asset.rename": ["name"],
  "asset.align": ["relativeTo", "axis", "alignment"],
  "asset.resize": [],
  "asset.setPolicy": [],
  "asset.process": ["capability"],
  "asset.replaceSource": ["sourcePath"],
  "asset.generate": ["capability"],
  "asset.reconstruct": ["capability"],
  "asset.delete": [],
  "region.create": ["region"],
  "region.associate": ["regionId", "assetIds"],
  "region.update": ["regionId", "patch"],
  "region.setMasks": ["regionId", "masks"],
  "region.delete": ["regionId"],
  "exportPreset.update": ["preset"],
  "project.validate": [],
  "project.build": ["presetId"],
  "project.export": ["presetId", "destinationPath"],
};

function semanticPlanIssues(plan, project = null) {
  const issues = [];
  const seen = new Set();
  const assetIds = new Set(project?.assetGraph?.nodes?.map((asset) => asset.id) || []);
  const regionIds = new Set(project?.regions?.map((region) => region.id) || []);

  plan.operations.forEach((operation, index) => {
    const base = `/operations/${index}`;
    if (seen.has(operation.operationId)) issues.push(issue("operation.duplicateId", `Duplicate operation id: ${operation.operationId}`, `${base}/operationId`));
    seen.add(operation.operationId);
    if (operation.op.startsWith("asset.") && !operation.targetId) issues.push(issue("operation.targetRequired", `${operation.op} requires targetId.`, `${base}/targetId`));
    if (operation.op !== "asset.import" && operation.op !== "asset.generate" && operation.op.startsWith("asset.") && project && !assetIds.has(operation.targetId)) {
      issues.push(issue("operation.missingTarget", `Unknown asset target: ${operation.targetId}`, `${base}/targetId`));
    }
    for (const field of REQUIRED_PARAMS[operation.op] || []) {
      if (operation.params[field] === undefined) issues.push(issue("operation.missingParam", `${operation.op} requires params.${field}.`, `${base}/params/${field}`));
    }
    if (operation.op === "asset.resize" && operation.params.width === undefined && operation.params.height === undefined) {
      issues.push(issue("operation.resizeSizeRequired", "asset.resize requires width or height.", `${base}/params`));
    }
    if (operation.op === "asset.setPolicy" && !operation.params.editPolicy && !operation.params.exportPolicy && !operation.params.generationRule && !operation.params.state) {
      issues.push(issue("operation.policyRequired", "asset.setPolicy requires a policy or state change.", `${base}/params`));
    }
    if (operation.op === "asset.setPolicy" && ["validated", "exportable"].includes(operation.params.state)) {
      issues.push(issue("operation.stateReserved", `${operation.params.state} state is reserved for project validation/build actions.`, `${base}/params/state`));
    }
    if (["region.associate", "region.update", "region.setMasks", "region.delete"].includes(operation.op) && project && !regionIds.has(operation.params.regionId)) {
      issues.push(issue("operation.missingRegion", `Unknown region target: ${operation.params.regionId}`, `${base}/params/regionId`));
    }
    if (operation.op === "asset.import" && operation.params.sourcePath && !isSafeRelativePath(operation.params.destinationPath || `assets/source/${operation.params.sourcePath.split(/[\\/]/).at(-1)}`)) {
      issues.push(issue("operation.unsafeDestination", "asset.import destination escapes the project.", `${base}/params/destinationPath`));
    }
  });

  if (project) {
    if (plan.projectId !== project.projectId) issues.push(issue("plan.projectMismatch", "Plan projectId does not match the project.", "/projectId"));
    if (plan.baseRevision.number !== project.revision.number || plan.baseRevision.hash !== project.revision.hash) {
      issues.push(issue("plan.stale", "Plan base revision does not match the current project revision.", "/baseRevision", { expected: project.revision, actual: plan.baseRevision }));
    }
  }
  if (plan.ambiguities.length && plan.status !== "ambiguous") issues.push(issue("plan.ambiguityState", "A plan with ambiguities must be in ambiguous state.", "/status"));
  if (plan.ambiguities.length && !plan.requiredApproval) issues.push(issue("plan.ambiguityApproval", "A plan with ambiguities requires approval.", "/requiredApproval"));
  return issues;
}

function semanticReceiptIssues(receipt) {
  const issues = [];
  if (receipt.status === "succeeded") {
    if (!receipt.validationResult.ok) issues.push(issue("receipt.invalidSuccess", "A succeeded receipt requires a successful validation result.", "/validationResult/ok"));
    if (receipt.newRevision.number <= receipt.oldRevision.number) issues.push(issue("receipt.revisionNotAdvanced", "A succeeded receipt must advance the revision.", "/newRevision"));
  }
  if (receipt.status !== "succeeded" && receipt.newRevision.number !== receipt.oldRevision.number) {
    issues.push(issue("receipt.failedRevisionChanged", "A non-success receipt cannot advance the revision.", "/newRevision"));
  }
  return issues;
}

function validateDocument(kind, document, options = {}) {
  const validate = validators[kind];
  if (!validate) throw new Error(`Unknown ImageSpec document kind: ${kind}`);
  const structurallyValid = validate(document);
  const issues = structurallyValid ? [] : schemaIssues(validate.errors);
  if (structurallyValid && options.semantic !== false) {
    if (kind === "project") issues.push(...semanticProjectIssues(document));
    if (kind === "plan") issues.push(...semanticPlanIssues(document, options.project));
    if (kind === "receipt") issues.push(...semanticReceiptIssues(document));
  }
  return {
    ok: !issues.some((entry) => entry.severity === "error"),
    issues,
  };
}

function assertValidDocument(kind, document, options = {}) {
  const result = validateDocument(kind, document, options);
  if (!result.ok) {
    const error = new Error(`Invalid ImageSpec ${kind}.`);
    error.code = "IMAGESPEC_VALIDATION_FAILED";
    error.details = result;
    throw error;
  }
  return document;
}

module.exports = {
  validateDocument,
  assertValidDocument,
  semanticProjectIssues,
  semanticPlanIssues,
  semanticReceiptIssues,
  collectProjectPaths,
};
