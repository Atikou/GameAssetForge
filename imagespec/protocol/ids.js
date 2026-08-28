"use strict";

const { randomUUID } = require("crypto");

const STABLE_ID_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;

function createId(prefix = "id") {
  const safePrefix = normalizeStableId(prefix, "id");
  return `${safePrefix}.${randomUUID().replaceAll("-", "")}`;
}

function normalizeStableId(value, fallback = "asset") {
  let normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, ".")
    .replace(/[._-]+/g, ".")
    .replace(/^\.+|\.+$/g, "");
  if (!normalized || !/^[a-z]/.test(normalized)) normalized = `${fallback}.${normalized || "item"}`;
  return normalized.slice(0, 160).replace(/[._-]+$/g, "") || fallback;
}

function assertStableId(value, label = "id") {
  if (!STABLE_ID_PATTERN.test(String(value || ""))) {
    const error = new Error(`${label} must be a stable ImageSpec id.`);
    error.code = "IMAGESPEC_INVALID_ID";
    error.details = { label, value };
    throw error;
  }
  return value;
}

module.exports = {
  STABLE_ID_PATTERN,
  createId,
  normalizeStableId,
  assertStableId,
};
