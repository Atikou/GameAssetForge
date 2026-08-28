"use strict";

const os = require("os");

const packageJson = require("../../package.json");
const { SCHEMA_VERSION, RECEIPT_SCHEMA_ID, createId } = require("../protocol");

function defaultProvenance(adapters = []) {
  let sharpVersion = null;
  try {
    sharpVersion = require("sharp/package.json").version;
  } catch {
    // Sharp is optional for pure protocol/repository consumers.
  }
  return {
    application: "GameAssetForge",
    applicationVersion: packageJson.version,
    nodeVersion: process.version,
    platform: `${process.platform}-${process.arch}`,
    sharpVersion,
    adapters,
  };
}

function createReceipt(options) {
  const status = options.status || "succeeded";
  const oldRevision = structuredClone(options.oldRevision);
  const newRevision = structuredClone(options.newRevision || oldRevision);
  return {
    $schema: RECEIPT_SCHEMA_ID,
    schemaVersion: SCHEMA_VERSION,
    receiptId: options.receiptId || createId("receipt"),
    planId: options.plan.planId,
    projectId: options.plan.projectId,
    status,
    startedAt: options.startedAt || new Date().toISOString(),
    finishedAt: options.finishedAt || new Date().toISOString(),
    oldRevision,
    newRevision,
    changedAssets: [...new Set(options.changedAssets || [])],
    generatedFiles: structuredClone(options.generatedFiles || []),
    validationResult: structuredClone(options.validationResult || { ok: status === "succeeded", issues: [] }),
    warnings: [...new Set(options.warnings || [])],
    error: options.error || null,
    provenance: {
      ...defaultProvenance(options.adapters || []),
      ...(options.provenance || {}),
    },
  };
}

module.exports = {
  defaultProvenance,
  createReceipt,
};
