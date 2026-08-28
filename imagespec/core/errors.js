"use strict";

class ImageSpecError extends Error {
  constructor(code, message, details = {}, options = {}) {
    super(message, options);
    this.name = "ImageSpecError";
    this.code = code;
    this.details = details;
    this.statusCode = options.statusCode || 400;
  }
}

function asImageSpecError(error, fallbackCode = "IMAGESPEC_INTERNAL_ERROR") {
  if (error instanceof ImageSpecError || error?.code?.startsWith?.("IMAGESPEC_")) return error;
  return new ImageSpecError(fallbackCode, error?.message || "ImageSpec operation failed.", {}, { cause: error, statusCode: 500 });
}

module.exports = { ImageSpecError, asImageSpecError };
