"use strict";

const fs = require("fs/promises");
const path = require("path");
const sharp = require("sharp");

const {
  assertSafeRelativePath,
  assertValidDocument,
  canonicalJson,
  createDefaultAsset,
  sha256,
  toProtocolPath,
} = require("../protocol");
const { ImageSpecError } = require("./errors");

function findAsset(project, assetId) {
  const asset = project.assetGraph.nodes.find((candidate) => candidate.id === assetId);
  if (!asset) throw new ImageSpecError("IMAGESPEC_ASSET_NOT_FOUND", `ImageSpec asset was not found: ${assetId}`, { assetId }, { statusCode: 404 });
  return asset;
}

function findRegion(project, regionId) {
  const region = project.regions.find((candidate) => candidate.id === regionId);
  if (!region) throw new ImageSpecError("IMAGESPEC_REGION_NOT_FOUND", `ImageSpec region was not found: ${regionId}`, { regionId }, { statusCode: 404 });
  return region;
}

function findPreset(project, presetId) {
  const preset = project.exportPresets.find((candidate) => candidate.id === presetId);
  if (!preset) throw new ImageSpecError("IMAGESPEC_PRESET_NOT_FOUND", `ImageSpec export preset was not found: ${presetId}`, { presetId }, { statusCode: 404 });
  return preset;
}

function mergeObject(target, patch) {
  const result = structuredClone(target || {});
  for (const [key, value] of Object.entries(patch || {})) {
    if (value && typeof value === "object" && !Array.isArray(value) && result[key] && typeof result[key] === "object" && !Array.isArray(result[key])) {
      result[key] = mergeObject(result[key], value);
    } else {
      result[key] = structuredClone(value);
    }
  }
  return result;
}

function mimeFromPath(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return {
    ".png": "image/png",
    ".webp": "image/webp",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".avif": "image/avif",
    ".json": "application/json",
  }[extension] || "application/octet-stream";
}

function safeFileName(value, fallback = "asset.png") {
  const cleaned = String(value || fallback).replace(/[<>:"/\\|?*\x00-\x1f]/g, "-").replace(/\s+/g, "-");
  return cleaned || fallback;
}

function changePathMatches(pattern, changePath) {
  if (pattern === "*") return true;
  const normalized = String(pattern).replaceAll("\\", "/");
  const aliases = [changePath];
  if (changePath.startsWith("asset.")) aliases.push(`assetGraph.${changePath.slice("asset.".length)}`, "assetGraph");
  if (changePath.startsWith("region.")) aliases.push(`regions.${changePath.slice("region.".length)}`, "regions");
  if (changePath.startsWith("preset.")) aliases.push(`exportPresets.${changePath.slice("preset.".length)}`, "exportPresets");
  if (changePath.startsWith("file:")) aliases.push(changePath.slice(5));
  return aliases.some((candidate) => {
    if (normalized.endsWith(".*")) return candidate.startsWith(normalized.slice(0, -1));
    return candidate === normalized || candidate.startsWith(`${normalized}.`) || candidate.startsWith(`${normalized}/`) || candidate.endsWith(`.${normalized}`);
  });
}

function enforceChangeContract(operation, changes) {
  for (const change of changes) {
    if (operation.deniedChanges.some((pattern) => changePathMatches(pattern, change.path))) {
      throw new ImageSpecError("IMAGESPEC_CHANGE_DENIED", `Operation ${operation.operationId} changed denied path ${change.path}.`, { operationId: operation.operationId, change });
    }
    if (!operation.allowedChanges.some((pattern) => changePathMatches(pattern, change.path))) {
      throw new ImageSpecError("IMAGESPEC_CHANGE_NOT_ALLOWED", `Operation ${operation.operationId} changed undeclared path ${change.path}.`, { operationId: operation.operationId, change, allowedChanges: operation.allowedChanges });
    }
  }
}

function recordChange(changes, pathName, before, after) {
  if (canonicalJson(before) !== canonicalJson(after)) changes.push({ path: pathName, before: structuredClone(before), after: structuredClone(after) });
}

function assertAssetOperationAllowed(asset, operation) {
  const allowed = asset.editPolicy?.allowedOperations || [];
  if (allowed.length && !allowed.includes(operation.op)) {
    throw new ImageSpecError("IMAGESPEC_EDIT_POLICY_DENIED", `Asset ${asset.id} does not allow ${operation.op}.`, { assetId: asset.id, operation: operation.op });
  }
}

function wouldCreateCycle(project, assetId, parentId) {
  if (!parentId) return false;
  let current = parentId;
  const visited = new Set([assetId]);
  while (current) {
    if (visited.has(current)) return true;
    visited.add(current);
    current = project.assetGraph.nodes.find((asset) => asset.id === current)?.parentId || null;
  }
  return false;
}

function alignedPosition(target, reference, axis, alignment, offset = 0) {
  const dimension = axis === "x" ? "width" : "height";
  const start = axis === "x" ? "x" : "y";
  if (alignment === "start") return reference[start] + offset;
  if (alignment === "end") return reference[start] + reference[dimension] - target[dimension] + offset;
  return reference[start] + (reference[dimension] - target[dimension]) / 2 + offset;
}

async function imageInfo(buffer) {
  try {
    const metadata = await sharp(buffer, { animated: false }).metadata();
    return { width: metadata.width || 1, height: metadata.height || 1, mimeType: `image/${metadata.format === "jpeg" ? "jpeg" : metadata.format || "png"}` };
  } catch {
    return { width: 1, height: 1, mimeType: "application/octet-stream" };
  }
}

async function stageSourceFile(operation, context, options = {}) {
  const sourcePath = path.resolve(operation.params.sourcePath);
  const destinationPath = assertSafeRelativePath(
    operation.params.destinationPath || `${options.directory || "assets/source"}/${safeFileName(path.basename(sourcePath), `${operation.targetId}.png`)}`,
  );
  if (context.dryRun) {
    return {
      destinationPath,
      buffer: null,
      hash: null,
      info: {
        width: Number(operation.params.width) || 1,
        height: Number(operation.params.height) || 1,
        mimeType: mimeFromPath(destinationPath),
      },
    };
  }
  let buffer;
  try {
    buffer = await fs.readFile(sourcePath);
  } catch (error) {
    throw new ImageSpecError("IMAGESPEC_IMPORT_SOURCE_UNREADABLE", `Cannot read import source: ${sourcePath}`, { sourcePath }, { cause: error });
  }
  const info = await imageInfo(buffer);
  context.transaction.stageWrite(destinationPath, buffer);
  return { destinationPath, buffer, hash: sha256(buffer), info };
}

function outputPathFor(asset, capability, extension, directory = "assets/generated") {
  return `${directory}/${safeFileName(`${asset.id.replaceAll(".", "-")}-${capability.replaceAll(".", "-")}.${extension}`)}`;
}

async function executeRunnerOperation(project, operation, context, mode) {
  const existing = project.assetGraph.nodes.find((asset) => asset.id === operation.targetId) || null;
  let asset = existing;
  if (!asset && mode === "generate") {
    asset = createDefaultAsset({
      id: operation.targetId,
      name: operation.params.name || operation.targetId,
      type: operation.params.type || "atomic",
      bounds: operation.params.bounds || { x: 0, y: 0, width: 1, height: 1 },
      generationRule: {
        adapter: operation.params.capability,
        prompt: operation.params.prompt || "",
        negativePrompt: operation.params.negativePrompt || "",
        referenceIds: operation.params.referenceIds || [],
        mustBeSeparate: operation.params.mustBeSeparate !== false,
        parameters: operation.params.parameters || {},
      },
      state: "planned",
    });
    project.assetGraph.nodes.push(asset);
  }
  if (!asset) asset = findAsset(project, operation.targetId);
  if (existing) assertAssetOperationAllowed(asset, operation);

  const capability = operation.params.capability;
  const definition = context.runner?.get(capability);
  if (!definition) throw new ImageSpecError("IMAGESPEC_CAPABILITY_UNAVAILABLE", `Runner capability is not available: ${capability}`, { capability }, { statusCode: 424 });
  const sourceBuffer = asset.source.path && !context.dryRun ? await context.readFile(asset.source.path) : null;
  const directory = mode === "reconstruct" ? "assets/reconstructed" : "assets/generated";
  const beforeSource = structuredClone(asset.source);
  if (context.dryRun) {
    asset.state = "planned";
    return {
      asset,
      path: assertSafeRelativePath(operation.params.outputPath || outputPathFor(asset, capability, operation.params.extension || "png", directory)),
      fileRecord: null,
      adapter: { id: capability, version: definition.version },
      snapshot: null,
    };
  }
  const result = await context.runner.execute(capability, {
    project,
    projectDir: context.projectDir,
    asset: structuredClone(asset),
    sourceBuffer,
    params: {
      ...operation.params,
      prompt: operation.params.prompt ?? asset.generationRule.prompt,
      negativePrompt: operation.params.negativePrompt ?? asset.generationRule.negativePrompt,
    },
    masks: asset.masks,
    signal: context.signal,
  });
  const output = result.output || result.outputs?.[0]?.buffer;
  const extension = result.extension || result.outputs?.[0]?.extension || "png";
  const outputPath = assertSafeRelativePath(operation.params.outputPath || outputPathFor(asset, capability, extension, directory));
  context.transaction.stageWrite(outputPath, output);
  const hash = sha256(output);
  asset.source = {
    kind: "generated",
    path: outputPath,
    sha256: hash,
    mimeType: result.mimeType || mimeFromPath(outputPath),
    generator: capability,
  };
  if (result.metadata?.width && result.metadata?.height) {
    asset.bounds.width = result.metadata.width;
    asset.bounds.height = result.metadata.height;
  }
  asset.state = "rendered";
  return {
    asset,
    path: outputPath,
    beforeSource,
    fileRecord: { path: outputPath, sha256: hash, size: output.length, mimeType: asset.source.mimeType, role: mode },
    adapter: result.capability,
    warnings: result.warnings || [],
    snapshot: sourceBuffer ? { assetId: asset.id, before: sourceBuffer, after: output } : null,
  };
}

async function executeOperation(project, operation, context) {
  const changes = [];
  const generatedFiles = [];
  const adapters = [];
  const warnings = [];
  const snapshots = [];
  const validationResults = [];
  const affectedAssets = new Set();

  if (operation.op === "asset.import") {
    if (project.assetGraph.nodes.some((asset) => asset.id === operation.targetId)) throw new ImageSpecError("IMAGESPEC_ASSET_EXISTS", `Asset already exists: ${operation.targetId}`);
    const staged = await stageSourceFile(operation, context);
    const asset = createDefaultAsset({
      id: operation.targetId,
      name: operation.params.name,
      type: operation.params.type,
      parentId: operation.params.parentId ?? null,
      bounds: operation.params.bounds || { x: 0, y: 0, width: staged.info.width, height: staged.info.height },
      zIndex: operation.params.zIndex,
      source: context.dryRun
        ? { kind: "missing" }
        : { kind: "file", path: staged.destinationPath, sha256: staged.hash, mimeType: staged.info.mimeType },
      exportPolicy: operation.params.exportPolicy,
      editPolicy: operation.params.editPolicy,
      generationRule: operation.params.generationRule,
      state: context.dryRun ? "planned" : "draft",
      tags: operation.params.tags || [],
    });
    project.assetGraph.nodes.push(asset);
    recordChange(changes, `asset.${asset.id}`, null, asset);
    recordChange(changes, `file:${staged.destinationPath}`, null, context.dryRun ? "planned" : staged.hash);
    affectedAssets.add(asset.id);
    if (!context.dryRun) generatedFiles.push({ path: staged.destinationPath, sha256: staged.hash, size: staged.buffer.length, mimeType: staged.info.mimeType, role: "source" });
  } else if (operation.op === "asset.rename") {
    const asset = findAsset(project, operation.targetId);
    assertAssetOperationAllowed(asset, operation);
    const before = asset.name;
    asset.name = String(operation.params.name).trim();
    recordChange(changes, `asset.${asset.id}.name`, before, asset.name);
    affectedAssets.add(asset.id);
  } else if (operation.op === "asset.move") {
    const asset = findAsset(project, operation.targetId);
    assertAssetOperationAllowed(asset, operation);
    if (operation.params.parentId !== undefined) {
      if (operation.params.parentId && !project.assetGraph.nodes.some((candidate) => candidate.id === operation.params.parentId)) throw new ImageSpecError("IMAGESPEC_PARENT_NOT_FOUND", `Parent asset not found: ${operation.params.parentId}`);
      if (wouldCreateCycle(project, asset.id, operation.params.parentId)) throw new ImageSpecError("IMAGESPEC_GRAPH_CYCLE", "Asset move would create a graph cycle.", { assetId: asset.id, parentId: operation.params.parentId });
      const before = asset.parentId;
      asset.parentId = operation.params.parentId;
      recordChange(changes, `asset.${asset.id}.parentId`, before, asset.parentId);
    }
    if (operation.params.zIndex !== undefined) {
      const before = asset.zIndex;
      asset.zIndex = Math.trunc(operation.params.zIndex);
      recordChange(changes, `asset.${asset.id}.zIndex`, before, asset.zIndex);
    }
    for (const axis of ["x", "y"]) {
      const before = asset.bounds[axis];
      if (operation.params[axis] !== undefined) asset.bounds[axis] = Number(operation.params[axis]);
      if (operation.params[`delta${axis.toUpperCase()}`] !== undefined) asset.bounds[axis] += Number(operation.params[`delta${axis.toUpperCase()}`]);
      recordChange(changes, `asset.${asset.id}.bounds.${axis}`, before, asset.bounds[axis]);
    }
    affectedAssets.add(asset.id);
  } else if (operation.op === "asset.align") {
    const asset = findAsset(project, operation.targetId);
    assertAssetOperationAllowed(asset, operation);
    const reference = operation.params.relativeTo === "$canvas" ? { x: 0, y: 0, width: project.canvas.width, height: project.canvas.height } : findAsset(project, operation.params.relativeTo).bounds;
    const axes = operation.params.axis === "both" ? ["x", "y"] : [operation.params.axis];
    axes.forEach((axis) => {
      if (!['x', 'y'].includes(axis)) throw new ImageSpecError("IMAGESPEC_ALIGNMENT_AXIS_INVALID", `Invalid alignment axis: ${axis}`);
      const before = asset.bounds[axis];
      asset.bounds[axis] = alignedPosition(asset.bounds, reference, axis, operation.params.alignment, Number(operation.params.offset || 0));
      recordChange(changes, `asset.${asset.id}.bounds.${axis}`, before, asset.bounds[axis]);
    });
    affectedAssets.add(asset.id);
  } else if (operation.op === "asset.resize") {
    const asset = findAsset(project, operation.targetId);
    assertAssetOperationAllowed(asset, operation);
    const before = structuredClone(asset.bounds);
    const aspect = before.width / before.height;
    if (operation.params.width !== undefined) asset.bounds.width = Number(operation.params.width);
    if (operation.params.height !== undefined) asset.bounds.height = Number(operation.params.height);
    if (operation.params.preserveAspect && operation.params.width !== undefined && operation.params.height === undefined) asset.bounds.height = asset.bounds.width / aspect;
    if (operation.params.preserveAspect && operation.params.height !== undefined && operation.params.width === undefined) asset.bounds.width = asset.bounds.height * aspect;
    recordChange(changes, `asset.${asset.id}.bounds.width`, before.width, asset.bounds.width);
    recordChange(changes, `asset.${asset.id}.bounds.height`, before.height, asset.bounds.height);
    affectedAssets.add(asset.id);
  } else if (operation.op === "asset.setPolicy") {
    const asset = findAsset(project, operation.targetId);
    assertAssetOperationAllowed(asset, operation);
    for (const key of ["editPolicy", "exportPolicy", "generationRule"]) {
      if (operation.params[key]) {
        const before = structuredClone(asset[key]);
        asset[key] = mergeObject(asset[key], operation.params[key]);
        recordChange(changes, `asset.${asset.id}.${key}`, before, asset[key]);
      }
    }
    if (operation.params.state) {
      if (["validated", "exportable"].includes(operation.params.state)) {
        throw new ImageSpecError("IMAGESPEC_STATE_TRANSITION_RESERVED", `${operation.params.state} state is reserved for project validation/build actions.`, { assetId: asset.id, state: operation.params.state });
      }
      const before = asset.state;
      asset.state = operation.params.state;
      recordChange(changes, `asset.${asset.id}.state`, before, asset.state);
    }
    affectedAssets.add(asset.id);
  } else if (operation.op === "asset.replaceSource") {
    const asset = findAsset(project, operation.targetId);
    assertAssetOperationAllowed(asset, operation);
    const staged = await stageSourceFile(operation, context, { directory: "assets/source" });
    const before = structuredClone(asset.source);
    const beforeBounds = structuredClone(asset.bounds);
    asset.source = context.dryRun ? before : { kind: "file", path: staged.destinationPath, sha256: staged.hash, mimeType: staged.info.mimeType };
    if (!context.dryRun) {
      asset.bounds.width = staged.info.width;
      asset.bounds.height = staged.info.height;
      asset.state = "rendered";
      generatedFiles.push({ path: staged.destinationPath, sha256: staged.hash, size: staged.buffer.length, mimeType: staged.info.mimeType, role: "source" });
      snapshots.push(before.path ? { assetId: asset.id, before: await context.readFile(before.path), after: staged.buffer } : null);
    }
    recordChange(changes, `asset.${asset.id}.source`, before, asset.source);
    recordChange(changes, `asset.${asset.id}.bounds.width`, beforeBounds.width, asset.bounds.width);
    recordChange(changes, `asset.${asset.id}.bounds.height`, beforeBounds.height, asset.bounds.height);
    recordChange(changes, `file:${staged.destinationPath}`, null, context.dryRun ? "planned" : staged.hash);
    affectedAssets.add(asset.id);
  } else if (["asset.process", "asset.generate", "asset.reconstruct"].includes(operation.op)) {
    const mode = operation.op.split(".")[1];
    const before = project.assetGraph.nodes.find((asset) => asset.id === operation.targetId);
    const beforeAsset = before ? structuredClone(before) : null;
    const result = await executeRunnerOperation(project, operation, context, mode);
    recordChange(changes, `asset.${result.asset.id}`, beforeAsset, result.asset);
    recordChange(changes, `file:${result.path}`, null, context.dryRun ? "planned" : result.fileRecord.sha256);
    affectedAssets.add(result.asset.id);
    if (result.fileRecord) generatedFiles.push(result.fileRecord);
    if (result.adapter) adapters.push(result.adapter);
    warnings.push(...(result.warnings || []));
    if (result.validation) validationResults.push(result.validation);
    if (result.snapshot) snapshots.push(result.snapshot);
  } else if (operation.op === "asset.delete") {
    const asset = findAsset(project, operation.targetId);
    assertAssetOperationAllowed(asset, operation);
    const descendants = project.assetGraph.nodes.filter((candidate) => candidate.parentId === asset.id);
    if (descendants.length && !operation.params.cascade) throw new ImageSpecError("IMAGESPEC_ASSET_HAS_CHILDREN", `Asset ${asset.id} has children; cascade approval is required.`, { childIds: descendants.map((child) => child.id) });
    const deleteIds = new Set([asset.id]);
    if (operation.params.cascade) {
      let changed = true;
      while (changed) {
        changed = false;
        for (const candidate of project.assetGraph.nodes) {
          if (candidate.parentId && deleteIds.has(candidate.parentId) && !deleteIds.has(candidate.id)) {
            deleteIds.add(candidate.id);
            changed = true;
          }
        }
      }
    }
    const removed = project.assetGraph.nodes.filter((candidate) => deleteIds.has(candidate.id));
    project.assetGraph.nodes = project.assetGraph.nodes.filter((candidate) => !deleteIds.has(candidate.id));
    project.regions.forEach((region) => {
      const beforeAssociations = structuredClone(region.associatedAssetIds);
      region.associatedAssetIds = region.associatedAssetIds.filter((id) => !deleteIds.has(id));
      recordChange(changes, `region.${region.id}.associatedAssetIds`, beforeAssociations, region.associatedAssetIds);
    });
    removed.forEach((candidate) => {
      recordChange(changes, `asset.${candidate.id}`, candidate, null);
      affectedAssets.add(candidate.id);
    });
    warnings.push("Deleted asset source files were retained for history and possible shared references.");
  } else if (operation.op === "region.create") {
    const region = structuredClone(operation.params.region);
    if (project.regions.some((candidate) => candidate.id === region.id)) throw new ImageSpecError("IMAGESPEC_REGION_EXISTS", `Region already exists: ${region.id}`);
    project.regions.push(region);
    recordChange(changes, `region.${region.id}`, null, region);
    region.associatedAssetIds.forEach((id) => affectedAssets.add(id));
  } else if (operation.op === "region.associate") {
    const region = findRegion(project, operation.params.regionId);
    operation.params.assetIds.forEach((assetId) => findAsset(project, assetId));
    const before = structuredClone(region.associatedAssetIds);
    region.associatedAssetIds = [...new Set(operation.params.assetIds)];
    recordChange(changes, `region.${region.id}.associatedAssetIds`, before, region.associatedAssetIds);
    region.associatedAssetIds.forEach((id) => affectedAssets.add(id));
  } else if (operation.op === "region.update") {
    const region = findRegion(project, operation.params.regionId);
    const before = structuredClone(region);
    const allowedPatch = {};
    for (const key of ["name", "geometry", "instruction", "acceptance"]) {
      if (operation.params.patch[key] !== undefined) allowedPatch[key] = operation.params.patch[key];
    }
    Object.assign(region, mergeObject(region, allowedPatch));
    recordChange(changes, `region.${region.id}`, before, region);
    region.associatedAssetIds.forEach((id) => affectedAssets.add(id));
  } else if (operation.op === "region.setMasks") {
    const region = findRegion(project, operation.params.regionId);
    const before = structuredClone(region.masks);
    region.masks = mergeObject(region.masks, operation.params.masks);
    recordChange(changes, `region.${region.id}.masks`, before, region.masks);
    region.associatedAssetIds.forEach((id) => affectedAssets.add(id));
  } else if (operation.op === "region.delete") {
    const region = findRegion(project, operation.params.regionId);
    project.regions = project.regions.filter((candidate) => candidate.id !== region.id);
    recordChange(changes, `region.${region.id}`, region, null);
    region.associatedAssetIds.forEach((id) => affectedAssets.add(id));
  } else if (operation.op === "exportPreset.update") {
    const preset = structuredClone(operation.params.preset);
    const existingIndex = project.exportPresets.findIndex((candidate) => candidate.id === preset.id);
    const before = existingIndex >= 0 ? structuredClone(project.exportPresets[existingIndex]) : null;
    if (existingIndex >= 0) project.exportPresets[existingIndex] = mergeObject(project.exportPresets[existingIndex], preset);
    else project.exportPresets.push(preset);
    recordChange(changes, `preset.${preset.id}`, before, existingIndex >= 0 ? project.exportPresets[existingIndex] : preset);
  } else if (["project.validate", "project.build", "project.export"].includes(operation.op)) {
    if (!context.projectActions?.[operation.op]) throw new ImageSpecError("IMAGESPEC_PROJECT_ACTION_UNAVAILABLE", `Project action is unavailable: ${operation.op}`);
    const result = await context.projectActions[operation.op]({ project, operation, context });
    (result.generatedFiles || []).forEach((file) => generatedFiles.push(file));
    (result.adapters || []).forEach((adapter) => adapters.push(adapter));
    warnings.push(...(result.warnings || []));
    const changePath =
      operation.op === "project.validate"
        ? "validation-report.json"
        : operation.op === "project.build"
          ? `build:${operation.params.presetId}`
          : `export:${operation.params.destinationPath}`;
    recordChange(changes, changePath, null, result.summary || "planned");
    for (const change of result.changes || []) recordChange(changes, change.path, change.before, change.after);
    for (const assetId of result.affectedAssets || []) affectedAssets.add(assetId);
  } else {
    throw new ImageSpecError("IMAGESPEC_OPERATION_UNSUPPORTED", `Unsupported ImageSpec operation: ${operation.op}`);
  }

  enforceChangeContract(operation, changes);
  return { changes, generatedFiles, adapters, warnings, snapshots: snapshots.filter(Boolean), validationResults, affectedAssets: [...affectedAssets] };
}

async function applyOperations(project, plan, context) {
  const draft = structuredClone(project);
  const aggregate = { changes: [], generatedFiles: [], adapters: [], warnings: [], snapshots: [], validationResults: [], affectedAssets: [] };
  for (const operation of plan.operations) {
    const result = await executeOperation(draft, operation, context);
    aggregate.changes.push(...result.changes.map((change) => ({ operationId: operation.operationId, ...change })));
    aggregate.generatedFiles.push(...result.generatedFiles);
    aggregate.adapters.push(...result.adapters);
    aggregate.warnings.push(...result.warnings);
    aggregate.snapshots.push(...result.snapshots);
    aggregate.validationResults.push(...result.validationResults);
    aggregate.affectedAssets.push(...result.affectedAssets);
  }
  aggregate.affectedAssets = [...new Set(aggregate.affectedAssets)];
  aggregate.adapters = [...new Map(aggregate.adapters.map((adapter) => [`${adapter.id}@${adapter.version}`, adapter])).values()];
  aggregate.warnings = [...new Set(aggregate.warnings)];
  const undeclared = aggregate.affectedAssets.filter((assetId) => !plan.affectedAssets.includes(assetId));
  if (undeclared.length) throw new ImageSpecError("IMAGESPEC_UNDECLARED_ASSET_CHANGE", "Plan changed assets outside affectedAssets.", { undeclared, affectedAssets: plan.affectedAssets });
  assertValidDocument("project", draft);
  return { project: draft, ...aggregate };
}

async function previewOperations(project, plan, context = {}) {
  assertValidDocument("plan", plan, { project });
  const result = await applyOperations(project, plan, { ...context, dryRun: true });
  return {
    ...structuredClone(plan),
    preview: {
      summary: `${plan.operations.length} operation(s), ${result.affectedAssets.length} affected asset(s).`,
      changes: result.changes.map((change) => {
        const assetId = plan.affectedAssets.find((id) => change.path === `asset.${id}` || change.path.startsWith(`asset.${id}.`));
        return {
          operationId: change.operationId,
          ...(assetId ? { assetId } : {}),
          description: `${change.path} will change.`,
          before: change.before,
          after: change.after,
        };
      }),
      warnings: result.warnings,
      previewFiles: result.generatedFiles.map((file) => file.path),
    },
  };
}

module.exports = {
  findAsset,
  findRegion,
  findPreset,
  mergeObject,
  changePathMatches,
  enforceChangeContract,
  applyOperations,
  previewOperations,
};
