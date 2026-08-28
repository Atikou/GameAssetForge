"use strict";

const path = require("path");

function toProtocolPath(value) {
  return String(value || "").replaceAll("\\", "/");
}

function isSafeRelativePath(value) {
  if (typeof value !== "string" || !value || value.includes("\0")) return false;
  if (path.isAbsolute(value) || path.win32.isAbsolute(value) || path.posix.isAbsolute(value)) return false;
  const normalized = toProtocolPath(value);
  const segments = normalized.split("/");
  return !segments.some((segment) => segment === ".." || segment === "");
}

function assertSafeRelativePath(value, label = "path") {
  if (!isSafeRelativePath(value)) {
    const error = new Error(`${label} must stay inside the ImageSpec project.`);
    error.code = "IMAGESPEC_UNSAFE_PATH";
    error.details = { label, value };
    throw error;
  }
  return toProtocolPath(value);
}

function resolveProjectPath(projectDir, relativePath) {
  const protocolPath = assertSafeRelativePath(relativePath);
  const root = path.resolve(projectDir);
  const resolved = path.resolve(root, ...protocolPath.split("/"));
  const relative = path.relative(root, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    if (relative === "") return resolved;
    const error = new Error("Resolved path escaped the ImageSpec project.");
    error.code = "IMAGESPEC_UNSAFE_PATH";
    error.details = { projectDir: root, relativePath };
    throw error;
  }
  return resolved;
}

module.exports = {
  toProtocolPath,
  isSafeRelativePath,
  assertSafeRelativePath,
  resolveProjectPath,
};
