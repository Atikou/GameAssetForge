"use strict";

const sharp = require("sharp");

const imageTools = require("../../server/tools/image");
const { presetToColor } = require("../../server/lib/common");
const packageJson = require("../../package.json");
const { ImageSpecError } = require("../core/errors");

function mimeForFormat(format) {
  const normalized = format === "jpeg" ? "jpg" : format;
  return {
    png: "image/png",
    webp: "image/webp",
    jpg: "image/jpeg",
    avif: "image/avif",
    json: "application/json",
  }[normalized] || "application/octet-stream";
}

async function normalizeImageResult(result, fallback = {}) {
  const output = Buffer.isBuffer(result) ? result : result?.output || result?.buffer;
  if (!Buffer.isBuffer(output)) throw new ImageSpecError("IMAGESPEC_RUNNER_OUTPUT_INVALID", "GameAssetForge image tool returned no Buffer output.");
  const imageMetadata = await sharp(output, { animated: false }).metadata();
  const format = fallback.format || result?.format || imageMetadata.format || "png";
  return {
    output,
    extension: format === "jpeg" ? "jpg" : format,
    mimeType: mimeForFormat(format),
    metadata: {
      ...(result?.metadata || {}),
      width: imageMetadata.width || result?.metadata?.width || 0,
      height: imageMetadata.height || result?.metadata?.height || 0,
      format,
      hasAlpha: Boolean(imageMetadata.hasAlpha),
    },
  };
}

function imageCapability(id, title, execute, options = {}) {
  return {
    id,
    version: packageJson.version,
    title,
    description: options.description || title,
    deterministic: options.deterministic !== false,
    inputKinds: ["image"],
    outputKinds: ["image"],
    requiresApproval: Boolean(options.requiresApproval),
    parameterSchema: options.parameterSchema || { type: "object" },
    async execute(context) {
      if (!Buffer.isBuffer(context.sourceBuffer)) {
        throw new ImageSpecError("IMAGESPEC_SOURCE_BUFFER_REQUIRED", `${id} requires sourceBuffer.`);
      }
      return normalizeImageResult(await execute(context.sourceBuffer, context.params || {}, context), options);
    },
  };
}

function registerGameAssetForgeCapabilities(registry) {
  registry.register(
    imageCapability("image.convert", "Image format conversion", (buffer, params) => imageTools.convertImage(buffer, params), {
      parameterSchema: { format: ["png", "webp", "jpeg", "avif"], quality: "number", maxSide: "number" },
    }),
  );
  registry.register(imageCapability("image.resize", "Image resize", (buffer, params) => imageTools.resizeImage(buffer, params), { format: "png" }));
  registry.register(imageCapability("image.trim", "Trim transparent edges", (buffer, params) => imageTools.trimTransparent(buffer, params), { format: "png" }));
  registry.register(
    imageCapability(
      "image.chromaKey",
      "Chroma key background removal",
      (buffer, params) =>
        imageTools.chromaKey(buffer, {
          ...params,
          color: params.preset === "auto" ? "auto" : presetToColor(params.preset, params.color),
        }),
      { format: "png", requiresApproval: true },
    ),
  );
  registry.register(imageCapability("image.pixelScale", "Nearest-neighbor pixel scaling", (buffer, params) => imageTools.pixelScaleImage(buffer, params), { format: "png" }));
  registry.register(imageCapability("image.truePixel", "AI pseudo-pixel cleanup", (buffer, params) => imageTools.truePixelImage(buffer, params), { format: "png", requiresApproval: true }));
  registry.register(imageCapability("image.edgeFix", "Transparent edge color repair", (buffer, params) => imageTools.edgeFixImage(buffer, params), { format: "png" }));
  registry.register(imageCapability("image.stylize", "Sprite stylization", (buffer, params) => imageTools.stylizeImage(buffer, params), { format: "png", requiresApproval: true }));
  registry.register(imageCapability("image.normalMap", "Normal map generation", (buffer, params) => imageTools.normalMapImage(buffer, params), { format: "png" }));
  registry.register(imageCapability("image.maskMap", "Mask map generation", (buffer, params) => imageTools.maskMapImage(buffer, params), { format: "png" }));
  registry.register(imageCapability("image.colorAdjust", "Color adjustment", (buffer, params) => imageTools.colorAdjustImage(buffer, params), { format: "png", requiresApproval: true }));
  return registry;
}

module.exports = {
  registerGameAssetForgeCapabilities,
  normalizeImageResult,
  mimeForFormat,
};
