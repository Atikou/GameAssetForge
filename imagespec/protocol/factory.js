"use strict";

const {
  SCHEMA_VERSION,
  PROJECT_SCHEMA_ID,
  PLAN_SCHEMA_ID,
} = require("./constants");
const { createId, normalizeStableId } = require("./ids");

function nowIso() {
  return new Date().toISOString();
}

function createDefaultProject(options = {}) {
  const createdAt = options.createdAt || nowIso();
  return {
    $schema: PROJECT_SCHEMA_ID,
    schemaVersion: SCHEMA_VERSION,
    projectId: normalizeStableId(options.projectId || options.name || "project.default", "project"),
    name: options.name || "Untitled ImageSpec Project",
    metadata: {
      createdAt,
      updatedAt: createdAt,
      description: options.description || "",
      author: options.author || "",
      tags: [],
    },
    canvas: {
      width: Number(options.width) || 1024,
      height: Number(options.height) || 1024,
      colorSpace: "srgb",
      alphaMode: options.alphaMode === "opaque" ? "opaque" : "straight",
      background: options.background ?? null,
      orientation: options.orientation || "free",
    },
    designSystem: {
      styleDescription: options.styleDescription || "",
      palette: [],
      lighting: "",
      camera: "",
      perspective: "",
      compositionFocus: "",
      safeAreas: [],
      hitAreas: [],
      forbiddenContent: [],
      references: [],
    },
    assetGraph: { nodes: [] },
    regions: [],
    operationHistory: [],
    exportPresets: [createExportPreset("generic.default", "Generic", "generic")],
    validationRules: createDefaultValidationRules(),
    revision: { number: 0, hash: null },
  };
}

function createDefaultAsset(options = {}) {
  const id = normalizeStableId(options.id || options.name || createId("asset"), "asset");
  const type = options.type || "atomic";
  const fileName = options.fileName || `${id.replaceAll(".", "-")}.png`;
  return {
    id,
    name: options.name || id,
    type,
    parentId: options.parentId ?? null,
    bounds: options.bounds || { x: 0, y: 0, width: 1, height: 1 },
    transform: options.transform || { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, anchor: { x: 0.5, y: 0.5 } },
    zIndex: Number.isInteger(options.zIndex) ? options.zIndex : 0,
    source: options.source || { kind: type === "composite" ? "composite" : type === "text" ? "text" : "missing" },
    masks: options.masks || {},
    generationRule: options.generationRule || {
      adapter: null,
      prompt: "",
      negativePrompt: "",
      referenceIds: [],
      mustBeSeparate: type !== "composite" && type !== "baked",
      parameters: {},
    },
    editPolicy: options.editPolicy || {
      allowedOperations: [],
      protectedProperties: [],
      preserveOutside: true,
      requiresApproval: false,
    },
    exportPolicy: options.exportPolicy || {
      enabled: type !== "composite" && type !== "text",
      fileName,
      format: "png",
      pivot: { x: 0.5, y: 0.5 },
      padding: 0,
      scales: [1],
      trimTransparent: type !== "background",
      nineSlice: type === "nineSlice" ? { left: 0, right: 0, top: 0, bottom: 0 } : null,
      atlasGroup: null,
      preserveTransparentPadding: type === "effect",
    },
    state: options.state || "draft",
    tags: options.tags || [],
  };
}

function createExportPreset(id, name, engine, overrides = {}) {
  return {
    id: normalizeStableId(id, "preset"),
    name,
    engine,
    outputDir: `build/${engine}`,
    format: "png",
    scales: [1],
    atlas: {
      enabled: false,
      maxSize: 2048,
      padding: 2,
      extrude: 1,
      powerOfTwo: false,
    },
    options: {},
    ...overrides,
  };
}

function createDefaultValidationRules() {
  return [
    ["schema.valid", "schema.valid", "error"],
    ["graph.acyclic", "graph.acyclic", "error"],
    ["files.present", "files.present", "error"],
    ["alpha.valid", "alpha.valid", "error"],
    ["edges.clean", "edges.clean", "warning"],
    ["pivot.valid", "pivot.valid", "error"],
    ["nineslice.valid", "nineslice.valid", "error"],
  ].map(([id, type, severity]) => ({ id, type, enabled: true, severity, parameters: {} }));
}

function createOperationPlan(project, options = {}) {
  const operations = structuredClone(options.operations || []);
  const affectedAssets = options.affectedAssets || [
    ...new Set(operations.map((operation) => operation.targetId).filter(Boolean)),
  ];
  const ambiguities = structuredClone(options.ambiguities || []);
  const requiredApproval =
    options.requiredApproval !== undefined
      ? Boolean(options.requiredApproval)
      : ambiguities.length > 0 || operations.some((operation) => operation.requiresApproval);
  return {
    $schema: PLAN_SCHEMA_ID,
    schemaVersion: SCHEMA_VERSION,
    planId: options.planId || createId("plan"),
    projectId: project.projectId,
    baseRevision: structuredClone(project.revision),
    sourceUserRequest: options.sourceUserRequest || "",
    createdAt: options.createdAt || nowIso(),
    operations,
    affectedAssets,
    constraints: {
      canvasSizeUnchanged: true,
      protectedAssetHashUnchanged: true,
      ...(options.constraints || {}),
    },
    ambiguities,
    preview: options.preview || { summary: "", changes: [], warnings: [], previewFiles: [] },
    requiredApproval,
    expectedOutputs: structuredClone(options.expectedOutputs || []),
    status: options.status || (ambiguities.length ? "ambiguous" : requiredApproval ? "needs_confirmation" : "planned"),
  };
}

module.exports = {
  nowIso,
  createDefaultProject,
  createDefaultAsset,
  createExportPreset,
  createDefaultValidationRules,
  createOperationPlan,
};
