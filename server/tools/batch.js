const JSZip = require("jszip");
const sharp = require("sharp");
const { parseNumber, parseBoolean, safeBaseName, normalizeHexColor } = require("../lib/common");
const { trimTransparent, pixelScaleImage, truePixelImage, chromaKey, colorAdjustImage } = require("./image");

function normalizeBatchOperation(value) {
  return ["trim", "pixelScale", "chromaKey", "truePixel"].includes(value) ? value : "trim";
}

function batchChromaColor(body = {}) {
  if (body.preset === "auto" || body.color === "auto") return "auto";
  if (body.preset === "custom") return normalizeHexColor(body.color, "#00ff00");
  return normalizeHexColor(body.preset || body.color, "#00ff00");
}

async function processBatchImage(file, operation, body = {}) {
  if (operation === "pixelScale") return pixelScaleImage(file.buffer, body);
  if (operation === "truePixel") return truePixelImage(file.buffer, body);
  if (operation === "chromaKey") {
    const output = await chromaKey(file.buffer, {
      color: batchChromaColor(body),
      tolerance: parseNumber(body.tolerance, 72, 0, 441),
      softness: parseNumber(body.softness, 18, 0, 441),
      spill: parseNumber(body.spill ?? body.spillStrength, 85, 0, 100),
      edgeCleanup: parseNumber(body.edgeCleanup, 18, 0, 100),
      matting: parseBoolean(body.matting ?? body.autoTrimap, true),
      mattingRadius: parseNumber(body.mattingRadius, 4, 1, 32),
      mattingStrength: parseNumber(body.mattingStrength, 70, 0, 100),
    });
    const metadata = await sharp(output).metadata();
    return {
      output,
      metadata: {
        width: metadata.width || 0,
        height: metadata.height || 0,
        tolerance: parseNumber(body.tolerance, 72, 0, 441),
        softness: parseNumber(body.softness, 18, 0, 441),
      },
    };
  }
  return trimTransparent(file.buffer, body);
}

function batchSuffix(operation, metadata = {}) {
  if (operation === "pixelScale") return `x${metadata.factor || 2}`;
  if (operation === "chromaKey") return "keyed";
  if (operation === "truePixel") return "true-pixel";
  return "trim";
}

async function buildBatchZip(files, body = {}) {
  if (!files.length) {
    const error = new Error("Missing multipart file field: images");
    error.statusCode = 400;
    throw error;
  }

  const operation = normalizeBatchOperation(body.operation);
  const zip = new JSZip();
  const manifest = {
    operation,
    count: files.length,
    files: [],
  };

  for (const [index, file] of files.entries()) {
    const base = safeBaseName(file.originalname, `image_${index + 1}`);
    const result = await processBatchImage(file, operation, body);
    const suffix = batchSuffix(operation, result.metadata);
    const name = `${base}-${suffix}.png`;
    zip.file(name, result.output);
    manifest.files.push({
      index,
      source: file.originalname,
      name,
      metadata: result.metadata,
    });
  }

  zip.file("manifest.json", JSON.stringify(manifest, null, 2));
  return zip;
}

async function buildBatchColorZip(files, body = {}) {
  if (!files.length) {
    const error = new Error("Missing multipart file field: images");
    error.statusCode = 400;
    throw error;
  }

  const zip = new JSZip();
  const manifest = {
    operation: "color",
    count: files.length,
    options: {
      brightness: parseNumber(body.brightness, 1, 0, 5),
      saturation: parseNumber(body.saturation, 1, 0, 5),
      hue: parseNumber(body.hue, 0, -360, 360),
      grayscale: parseBoolean(body.grayscale, false),
    },
    files: [],
  };

  for (const [index, file] of files.entries()) {
    const base = safeBaseName(file.originalname, `image_${index + 1}`);
    const output = await colorAdjustImage(file.buffer, body);
    const name = `${base}-color.png`;
    zip.file(name, output);
    manifest.files.push({ index, source: file.originalname, name });
  }

  zip.file("manifest.json", JSON.stringify(manifest, null, 2));
  return zip;
}

async function buildQualityReport(files) {
  if (!files.length) {
    const error = new Error("Missing multipart file field: images");
    error.statusCode = 400;
    throw error;
  }

  const report = {
    count: files.length,
    common: {},
    issues: [],
    files: [],
  };
  const dimensions = new Map();

  for (const [index, file] of files.entries()) {
    const image = sharp(file.buffer).ensureAlpha();
    const metadata = await image.metadata();
    const width = metadata.width || 0;
    const height = metadata.height || 0;
    const { data } = await image.raw().toBuffer({ resolveWithObject: true });
    let opaquePixels = 0;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] > 0) opaquePixels += 1;
    }
    const hasAlpha = Boolean(metadata.hasAlpha);
    const powerOfTwo = width > 0 && height > 0 && (width & (width - 1)) === 0 && (height & (height - 1)) === 0;
    const item = {
      index,
      name: file.originalname,
      width,
      height,
      format: metadata.format,
      hasAlpha,
      opaquePixels,
      empty: opaquePixels === 0,
      powerOfTwo,
      sizeBytes: file.size,
      issues: [],
    };
    if (item.empty) item.issues.push("empty-alpha");
    if (!powerOfTwo) item.issues.push("not-power-of-two");
    if (width > 4096 || height > 4096) item.issues.push("large-texture");
    dimensions.set(`${width}x${height}`, (dimensions.get(`${width}x${height}`) || 0) + 1);
    item.issues.forEach((issue) => report.issues.push({ file: file.originalname, issue }));
    report.files.push(item);
  }

  report.common.dimensions = Object.fromEntries(dimensions);
  report.common.consistentSize = dimensions.size === 1;
  return report;
}

module.exports = {
  buildBatchZip,
  buildBatchColorZip,
  buildQualityReport,
};
