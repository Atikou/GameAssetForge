"use strict";

const crypto = require("crypto");

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object" || Buffer.isBuffer(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalize(value[key])]),
  );
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function sha256(value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(String(value));
  return `sha256:${crypto.createHash("sha256").update(buffer).digest("hex")}`;
}

function hashDocument(value, omittedPaths = []) {
  const clone = structuredClone(value);
  for (const dottedPath of omittedPaths) {
    const parts = dottedPath.split(".");
    let current = clone;
    for (const part of parts.slice(0, -1)) current = current?.[part];
    if (current && typeof current === "object") delete current[parts.at(-1)];
  }
  return sha256(canonicalJson(clone));
}

function hashProject(project) {
  return hashDocument(project, ["revision.hash"]);
}

module.exports = {
  canonicalize,
  canonicalJson,
  sha256,
  hashDocument,
  hashProject,
};
