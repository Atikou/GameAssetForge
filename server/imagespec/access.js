"use strict";

const path = require("path");

const { PROJECT_SUFFIX } = require("../../imagespec/core");
const { ImageSpecError } = require("../../imagespec/core/errors");

function isInside(root, target) {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function configuredRoots(options = {}) {
  if (options.roots?.length) return options.roots.map((entry) => path.resolve(entry));
  const configured = process.env.GAF_IMAGESPEC_ROOTS;
  if (configured) return configured.split(path.delimiter).filter(Boolean).map((entry) => path.resolve(entry));
  return [path.resolve(__dirname, "..", "..", "imagespec-projects")];
}

function createImageSpecAccess(options = {}) {
  const roots = configuredRoots(options);
  const primaryRoot = roots[0];
  return {
    roots,
    primaryRoot,
    resolveProjectPath(value, resolveOptions = {}) {
      if (!value || typeof value !== "string") throw new ImageSpecError("IMAGESPEC_PROJECT_PATH_REQUIRED", "projectPath is required.");
      let resolved = path.isAbsolute(value) ? path.resolve(value) : path.resolve(primaryRoot, value);
      if (resolveOptions.appendSuffix && !resolved.toLowerCase().endsWith(PROJECT_SUFFIX)) resolved += PROJECT_SUFFIX;
      if (!roots.some((root) => isInside(root, resolved))) {
        throw new ImageSpecError("IMAGESPEC_PROJECT_ROOT_DENIED", "ImageSpec project path is outside configured HTTP roots.", { projectPath: resolved, allowedRoots: roots }, { statusCode: 403 });
      }
      return resolved;
    },
  };
}

module.exports = {
  createImageSpecAccess,
  configuredRoots,
  isInside,
};
