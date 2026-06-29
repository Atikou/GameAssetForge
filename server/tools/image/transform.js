const sharp = require("sharp");
const { parseNumber, parseBoolean, normalizeHexColor } = require("../../lib/common");

function encodeImage(image, format, options = {}) {
  const quality = parseNumber(options.quality, 82, 1, 100);
  if (format === "webp") return image.webp({ quality, effort: 4 }).toBuffer();
  if (format === "jpeg" || format === "jpg") return image.jpeg({ quality, mozjpeg: true }).toBuffer();
  if (format === "avif") return image.avif({ quality, effort: 4 }).toBuffer();
  return image.png({ compressionLevel: 9, palette: parseBoolean(options.palette, false) }).toBuffer();
}

async function convertImage(buffer, body = {}) {
  const format = ["png", "webp", "jpeg", "jpg", "avif"].includes(body.format) ? body.format : "png";
  const maxSide = parseNumber(body.maxSide, 0, 0, 16384);
  const background = normalizeHexColor(body.background, "#000000");
  let image = sharp(buffer, { animated: false }).rotate();
  if (maxSide > 0) image = image.resize({ width: maxSide, height: maxSide, fit: "inside", withoutEnlargement: true });
  if (format === "jpeg" || format === "jpg") {
    image = image.flatten({ background });
  }
  const output = await encodeImage(image, format, body);
  const metadata = await sharp(output).metadata();
  return {
    output,
    format,
    metadata: {
      width: metadata.width || 0,
      height: metadata.height || 0,
      format,
      quality: parseNumber(body.quality, 82, 1, 100),
      maxSide,
    },
  };
}

async function resizeImage(buffer, body) {
  const metadata = await sharp(buffer).metadata();
  const mode = body.mode || "exact";
  let width = parseNumber(body.width, metadata.width || 1, 1, 16384);
  let height = parseNumber(body.height, metadata.height || 1, 1, 16384);

  if (mode === "scale") {
    const scale = parseNumber(body.scale, 50, 1, 1000) / 100;
    width = Math.max(1, Math.round((metadata.width || 1) * scale));
    height = Math.max(1, Math.round((metadata.height || 1) * scale));
  }

  if (mode === "maxSide") {
    const maxSide = parseNumber(body.maxSide, 1024, 1, 16384);
    const ratio = Math.min(1, maxSide / Math.max(metadata.width || 1, metadata.height || 1));
    width = Math.max(1, Math.round((metadata.width || 1) * ratio));
    height = Math.max(1, Math.round((metadata.height || 1) * ratio));
  }

  return sharp(buffer).resize(width, height, { fit: "fill" }).png().toBuffer();
}

async function rawRgba(buffer, width, height) {
  const image = sharp(buffer).ensureAlpha();
  if (width && height) {
    return image.resize(width, height, { fit: "fill" }).raw().toBuffer({ resolveWithObject: true });
  }
  return image.raw().toBuffer({ resolveWithObject: true });
}

async function interpolateImages(frameABuffer, frameBBuffer, body) {
  const t = parseNumber(body.t, 0.5, 0, 1);
  const mode = body.mode === "nearest" ? "nearest" : "alphaBlend";
  const frameA = await rawRgba(frameABuffer);
  const frameB = await rawRgba(frameBBuffer, frameA.info.width, frameA.info.height);
  const output = Buffer.alloc(frameA.data.length);
  const weightA = mode === "nearest" ? (t < 0.5 ? 1 : 0) : 1 - t;
  const weightB = mode === "nearest" ? (t >= 0.5 ? 1 : 0) : t;

  for (let i = 0; i < output.length; i += 4) {
    const alphaA = frameA.data[i + 3] / 255;
    const alphaB = frameB.data[i + 3] / 255;
    const alpha = alphaA * weightA + alphaB * weightB;

    if (alpha <= 0.0001) {
      output[i] = 0;
      output[i + 1] = 0;
      output[i + 2] = 0;
      output[i + 3] = 0;
      continue;
    }

    output[i] = Math.round((frameA.data[i] * alphaA * weightA + frameB.data[i] * alphaB * weightB) / alpha);
    output[i + 1] = Math.round(
      (frameA.data[i + 1] * alphaA * weightA + frameB.data[i + 1] * alphaB * weightB) / alpha,
    );
    output[i + 2] = Math.round(
      (frameA.data[i + 2] * alphaA * weightA + frameB.data[i + 2] * alphaB * weightB) / alpha,
    );
    output[i + 3] = Math.round(alpha * 255);
  }

  return sharp(output, {
    raw: {
      width: frameA.info.width,
      height: frameA.info.height,
      channels: 4,
    },
  })
    .png()
    .toBuffer();
}

async function trimTransparent(buffer, body = {}) {
  const alphaThreshold = parseNumber(body.alphaThreshold ?? body.threshold, 8, 0, 255);
  const padding = parseNumber(body.padding, 0, 0, 4096);
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let minX = info.width;
  let minY = info.height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const alpha = data[(y * info.width + x) * info.channels + 3];
      if (alpha <= alphaThreshold) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  const hasContent = maxX >= minX && maxY >= minY;
  const left = hasContent ? Math.max(0, minX - padding) : 0;
  const top = hasContent ? Math.max(0, minY - padding) : 0;
  const right = hasContent ? Math.min(info.width - 1, maxX + padding) : 0;
  const bottom = hasContent ? Math.min(info.height - 1, maxY + padding) : 0;
  const width = Math.max(1, right - left + 1);
  const height = Math.max(1, bottom - top + 1);
  const output = await sharp(buffer)
    .ensureAlpha()
    .extract({ left, top, width, height })
    .png()
    .toBuffer();

  return {
    output,
    metadata: {
      originalWidth: info.width,
      originalHeight: info.height,
      x: left,
      y: top,
      width,
      height,
      empty: !hasContent,
      alphaThreshold,
      padding,
    },
  };
}

module.exports = {
  convertImage,
  resizeImage,
  interpolateImages,
  trimTransparent,
};
