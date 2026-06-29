const JSZip = require("jszip");
const sharp = require("sharp");
const { parseNumber, parseBoolean, safeBaseName } = require("../lib/common");
const { trimTransparent, pixelScaleImage, colorAdjustImage } = require("./image");

async function buildBatchZip(files, body = {}) {
  if (!files.length) {
    const error = new Error("Missing multipart file field: images");
    error.statusCode = 400;
    throw error;
  }

  const operation = body.operation === "pixelScale" ? "pixelScale" : "trim";
  const zip = new JSZip();
  const manifest = {
    operation,
    count: files.length,
    files: [],
  };

  for (const [index, file] of files.entries()) {
    const base = safeBaseName(file.originalname, `image_${index + 1}`);
    const result =
      operation === "pixelScale"
        ? await pixelScaleImage(file.buffer, body)
        : await trimTransparent(file.buffer, body);
    const suffix = operation === "pixelScale" ? `x${result.metadata.factor}` : "trim";
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
