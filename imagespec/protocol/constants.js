"use strict";

const SCHEMA_VERSION = "2.0";
const PROJECT_SCHEMA_ID = "https://gameassetforge.local/imagespec/project.schema.json";
const PLAN_SCHEMA_ID = "https://gameassetforge.local/imagespec/operation-plan.schema.json";
const RECEIPT_SCHEMA_ID = "https://gameassetforge.local/imagespec/receipt.schema.json";

const ASSET_TYPES = [
  "atomic",
  "composite",
  "nineSlice",
  "text",
  "progress",
  "background",
  "effect",
  "baked",
  "reconstruct",
  "legacyFlattened",
];

const ASSET_STATES = [
  "draft",
  "planned",
  "needs_confirmation",
  "approved",
  "executing",
  "rendered",
  "validated",
  "exportable",
  "ambiguous",
  "blocked",
  "failed",
  "stale",
  "rejected",
];

const OPERATION_TYPES = [
  "asset.import",
  "asset.rename",
  "asset.move",
  "asset.align",
  "asset.resize",
  "asset.setPolicy",
  "asset.process",
  "asset.replaceSource",
  "asset.generate",
  "asset.reconstruct",
  "asset.delete",
  "region.create",
  "region.associate",
  "region.update",
  "region.setMasks",
  "region.delete",
  "exportPreset.update",
  "project.validate",
  "project.build",
  "project.export",
];

const PLAN_STATES = [
  "draft",
  "planned",
  "needs_confirmation",
  "approved",
  "executing",
  "applied",
  "validated",
  "rejected",
  "ambiguous",
  "blocked",
  "failed",
  "stale",
];

module.exports = {
  SCHEMA_VERSION,
  PROJECT_SCHEMA_ID,
  PLAN_SCHEMA_ID,
  RECEIPT_SCHEMA_ID,
  ASSET_TYPES,
  ASSET_STATES,
  OPERATION_TYPES,
  PLAN_STATES,
};
