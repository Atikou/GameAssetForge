"use strict";

const fs = require("fs/promises");

const { validateDocument, resolveProjectPath, sha256 } = require("../protocol");
const { analyzeImage, compareImagePixels } = require("./image-analysis");

function validationIssue(code, message, options = {}) {
  return {
    code,
    severity: options.severity || "error",
    message,
    ...(options.path ? { path: options.path } : {}),
    ...(options.assetId ? { assetId: options.assetId } : {}),
    ...(options.details ? { details: options.details } : {}),
  };
}

function isImageAsset(asset) {
  return !["composite", "text"].includes(asset.type) && asset.source.path && asset.source.mimeType?.startsWith("image/");
}

function ruleEnabled(project, type) {
  const rule = project.validationRules.find((candidate) => candidate.type === type);
  return rule ? rule.enabled : true;
}

function ruleSeverity(project, type, fallback = "error") {
  return project.validationRules.find((candidate) => candidate.type === type)?.severity || fallback;
}

async function defaultReadFile(projectDir, relativePath) {
  return fs.readFile(resolveProjectPath(projectDir, relativePath));
}

async function validateProjectFiles(projectDir, project, options = {}) {
  const issues = [];
  const files = [];
  const readFile = options.readFile || ((relativePath) => defaultReadFile(projectDir, relativePath));
  const schemaResult = validateDocument("project", project);
  issues.push(...schemaResult.issues);
  if (!schemaResult.ok) return { ok: false, issues, files };

  for (const asset of project.assetGraph.nodes) {
    if (!asset.source.path) continue;
    let buffer;
    try {
      buffer = await readFile(asset.source.path);
    } catch (error) {
      issues.push(validationIssue("files.missing", `Missing source file: ${asset.source.path}`, { assetId: asset.id, path: asset.source.path, details: { error: error.message } }));
      continue;
    }
    const actualHash = sha256(buffer);
    files.push({ path: asset.source.path, sha256: actualHash, size: buffer.length, mimeType: asset.source.mimeType || "application/octet-stream", role: "source" });
    if (asset.source.sha256 !== actualHash) {
      issues.push(validationIssue("files.hashMismatch", `Source hash mismatch for ${asset.id}.`, { assetId: asset.id, path: asset.source.path, details: { expected: asset.source.sha256, actual: actualHash } }));
    }
    if (!isImageAsset(asset)) continue;
    let analysis;
    try {
      analysis = await analyzeImage(buffer);
    } catch (error) {
      issues.push(validationIssue("image.unreadable", `Source image is unreadable for ${asset.id}.`, { assetId: asset.id, path: asset.source.path, details: { error: error.message } }));
      continue;
    }
    if (analysis.opaquePixels + analysis.semiTransparentPixels === 0) {
      issues.push(validationIssue("alpha.empty", `Image asset ${asset.id} contains no visible pixels.`, { assetId: asset.id, path: asset.source.path }));
    }
    if (ruleEnabled(project, "alpha.valid") && !["background", "baked"].includes(asset.type)) {
      if (!analysis.hasAlpha) issues.push(validationIssue("alpha.missing", `Transparent asset ${asset.id} has no alpha channel.`, { assetId: asset.id, path: asset.source.path, severity: ruleSeverity(project, "alpha.valid") }));
      else if (analysis.transparentPixels === 0) issues.push(validationIssue("alpha.opaque", `Transparent asset ${asset.id} has an alpha channel but no transparent pixels.`, { assetId: asset.id, path: asset.source.path, severity: "warning" }));
    }
    if (ruleEnabled(project, "edges.clean") && analysis.semiTransparentPixels > 0) {
      const contaminated = analysis.matteWhitePixels + analysis.matteBlackPixels;
      const ratio = contaminated / analysis.semiTransparentPixels;
      if (ratio > 0.25) issues.push(validationIssue("edges.matteContamination", `Asset ${asset.id} has likely white/black matte contamination on semi-transparent edges.`, { assetId: asset.id, path: asset.source.path, severity: ruleSeverity(project, "edges.clean", "warning"), details: { ratio, ...analysis } }));
    }
    if (asset.exportPolicy.nineSlice) {
      const border = asset.exportPolicy.nineSlice;
      if (border.left + border.right >= analysis.width || border.top + border.bottom >= analysis.height) {
        issues.push(validationIssue("nineSlice.outOfBounds", `nineSlice border is outside source bounds for ${asset.id}.`, { assetId: asset.id, path: asset.source.path, severity: ruleSeverity(project, "nineslice.valid"), details: { border, width: analysis.width, height: analysis.height } }));
      }
    }
    if (options.forBuild && asset.exportPolicy.enabled && !["validated", "exportable"].includes(asset.state)) {
      issues.push(validationIssue("state.notValidated", `Asset ${asset.id} is not validated for build.`, { assetId: asset.id, path: asset.source.path }));
    }
  }

  for (const reference of project.designSystem.references) {
    try {
      const buffer = await readFile(reference.path);
      files.push({ path: reference.path, sha256: sha256(buffer), size: buffer.length, mimeType: "application/octet-stream", role: "reference" });
    } catch (error) {
      issues.push(validationIssue("files.referenceMissing", `Missing design reference: ${reference.path}`, { path: reference.path, details: { error: error.message } }));
    }
  }

  const maskEntries = [];
  project.assetGraph.nodes.forEach((asset) => {
    Object.entries(asset.masks || {}).forEach(([kind, maskPath]) => maskEntries.push({ kind, path: maskPath, assetId: asset.id }));
  });
  project.regions.forEach((region) => {
    Object.entries(region.masks || {}).forEach(([kind, maskPath]) => maskEntries.push({ kind, path: maskPath, regionId: region.id }));
  });
  for (const mask of maskEntries) {
    try {
      const buffer = await readFile(mask.path);
      const analysis = await analyzeImage(buffer);
      files.push({ path: mask.path, sha256: sha256(buffer), size: buffer.length, mimeType: "image/png", role: `mask.${mask.kind}` });
      if (analysis.width < 1 || analysis.height < 1) throw new Error("Mask has no pixels.");
    } catch (error) {
      issues.push(validationIssue("files.maskMissing", `Missing or unreadable ${mask.kind} mask: ${mask.path}`, { assetId: mask.assetId, path: mask.path, details: { regionId: mask.regionId, error: error.message } }));
    }
  }

  return { ok: !issues.some((entry) => entry.severity === "error"), issues, files };
}

function changedAssetIds(beforeProject, afterProject) {
  const before = new Map(beforeProject.assetGraph.nodes.map((asset) => [asset.id, asset]));
  const after = new Map(afterProject.assetGraph.nodes.map((asset) => [asset.id, asset]));
  const ids = new Set([...before.keys(), ...after.keys()]);
  return [...ids].filter((id) => JSON.stringify(before.get(id)) !== JSON.stringify(after.get(id)));
}

async function validatePlanMutation(beforeProject, afterProject, plan, options = {}) {
  const issues = [];
  const changedAssets = changedAssetIds(beforeProject, afterProject);
  const undeclared = changedAssets.filter((id) => !plan.affectedAssets.includes(id));
  if (undeclared.length) issues.push(validationIssue("mutation.undeclaredAssets", "Assets outside affectedAssets changed.", { details: { undeclared } }));
  if (plan.constraints.canvasSizeUnchanged && (beforeProject.canvas.width !== afterProject.canvas.width || beforeProject.canvas.height !== afterProject.canvas.height)) {
    issues.push(validationIssue("mutation.canvasSizeChanged", "Canvas size changed despite canvasSizeUnchanged constraint.", { details: { before: beforeProject.canvas, after: afterProject.canvas } }));
  }
  const preserveIds = new Set(plan.constraints.mustPreserveAssetIds || []);
  if (plan.constraints.protectedAssetHashUnchanged) {
    beforeProject.assetGraph.nodes.filter((asset) => !plan.affectedAssets.includes(asset.id) || preserveIds.has(asset.id)).forEach((beforeAsset) => {
      const afterAsset = afterProject.assetGraph.nodes.find((asset) => asset.id === beforeAsset.id);
      if (!afterAsset || beforeAsset.source.sha256 !== afterAsset.source.sha256) {
        issues.push(validationIssue("mutation.protectedAssetChanged", `Protected asset changed: ${beforeAsset.id}`, { assetId: beforeAsset.id, details: { beforeHash: beforeAsset.source.sha256, afterHash: afterAsset?.source?.sha256 } }));
      }
    });
  }

  const allowedRegionIds = new Set(plan.constraints.allowedRegionIds || []);
  const regions = afterProject.regions.filter((region) => allowedRegionIds.has(region.id));
  for (const snapshot of options.snapshots || []) {
    const comparison = await compareImagePixels(snapshot.before, snapshot.after, regions);
    if (!comparison.sameSize && (plan.constraints.maxChangedPixels !== undefined || plan.constraints.outsideChangedPixels !== undefined)) {
      issues.push(validationIssue("mutation.pixelComparisonSizeMismatch", `Pixel constraints cannot be evaluated after an image size change for ${snapshot.assetId}.`, { assetId: snapshot.assetId, details: comparison }));
      continue;
    }
    if (plan.constraints.maxChangedPixels !== undefined && comparison.changedPixels > plan.constraints.maxChangedPixels) {
      issues.push(validationIssue("mutation.changedPixelsExceeded", `Changed pixels exceed the plan limit for ${snapshot.assetId}.`, { assetId: snapshot.assetId, details: comparison }));
    }
    if (plan.constraints.outsideChangedPixels !== undefined && comparison.outsideChangedPixels > plan.constraints.outsideChangedPixels) {
      issues.push(validationIssue("mutation.outsideChangedPixelsExceeded", `Pixels outside allowed regions changed for ${snapshot.assetId}.`, { assetId: snapshot.assetId, details: comparison }));
    }
    const target = afterProject.assetGraph.nodes.find((asset) => asset.id === snapshot.assetId);
    if (target?.editPolicy.preserveOutside && !allowedRegionIds.size) {
      issues.push(validationIssue("mutation.noAllowedRegion", `Asset ${snapshot.assetId} requires preserveOutside but the plan declares no allowed region.`, { assetId: snapshot.assetId, severity: "warning" }));
    }
  }
  return { ok: !issues.some((entry) => entry.severity === "error"), issues, changedAssets };
}

module.exports = {
  validationIssue,
  validateProjectFiles,
  validatePlanMutation,
  changedAssetIds,
  ruleEnabled,
};
