const sharp = require("sharp");
const { parseNumber } = require("../../lib/common");

async function pixelScaleImage(buffer, body = {}) {
  const metadata = await sharp(buffer).metadata();
  const factor = parseNumber(body.factor ?? body.scale, 2, 0.1, 16);
  const width = Math.max(1, Math.min(16384, Math.round((metadata.width || 1) * factor)));
  const height = Math.max(1, Math.min(16384, Math.round((metadata.height || 1) * factor)));
  const output = await sharp(buffer)
    .resize(width, height, { fit: "fill", kernel: sharp.kernel.nearest })
    .png()
    .toBuffer();

  return {
    output,
    metadata: {
      originalWidth: metadata.width || 0,
      originalHeight: metadata.height || 0,
      width,
      height,
      factor,
    },
  };
}

async function truePixelImage(buffer, body = {}) {
  const metadata = await sharp(buffer, { animated: false }).rotate().metadata();
  const sourceWidth = metadata.width || 1;
  const sourceHeight = metadata.height || 1;
  const cellSize = Math.round(parseNumber(body.cellSize ?? body.pixelSize, 4, 1, 64));
  const outputScale = Math.round(parseNumber(body.outputScale ?? body.scale, cellSize, 1, 32));
  const colors = Math.round(parseNumber(body.colors, 192, 2, 256));
  const dither = parseNumber(body.dither, 0, 0, 1);
  const sharpen = parseNumber(body.sharpen, 25, 0, 100) / 100;
  const sampleKernel = body.sampleKernel === "nearest" ? sharp.kernel.nearest : sharp.kernel.cubic;
  const lowWidth = Math.max(1, Math.ceil(sourceWidth / cellSize));
  const lowHeight = Math.max(1, Math.ceil(sourceHeight / cellSize));
  const width = Math.max(1, Math.min(16384, lowWidth * outputScale));
  const height = Math.max(1, Math.min(16384, lowHeight * outputScale));

  let lowImage = sharp(buffer, { animated: false })
    .rotate()
    .ensureAlpha()
    .resize(lowWidth, lowHeight, { fit: "fill", kernel: sampleKernel });
  if (sharpen > 0) {
    lowImage = lowImage.sharpen({
      sigma: 0.65,
      m1: 0.4 + sharpen * 1.4,
      m2: 0.15 + sharpen * 0.8,
      x1: 2,
      y2: 10,
      y3: 20,
    });
  }

  const lowPng = await lowImage
    .png({
      palette: true,
      colors,
      dither,
      compressionLevel: 9,
    })
    .toBuffer();

  const output = await sharp(lowPng)
    .resize(width, height, { fit: "fill", kernel: sharp.kernel.nearest })
    .png({
      palette: true,
      colors,
      dither: 0,
      compressionLevel: 9,
    })
    .toBuffer();

  return {
    output,
    metadata: {
      originalWidth: sourceWidth,
      originalHeight: sourceHeight,
      cellSize,
      lowWidth,
      lowHeight,
      outputScale,
      width,
      height,
      colors,
      dither,
      sharpen: Math.round(sharpen * 100),
      sampleKernel: body.sampleKernel === "nearest" ? "nearest" : "cubic",
    },
  };
}

async function pixelJsonImage(buffer, body = {}) {
  const includeTransparent = String(body.includeTransparent || "false").toLowerCase() === "true" || body.includeTransparent === true;
  const { data, info } = await sharp(buffer, { animated: false }).rotate().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const colors = [];
  const colorIndex = new Map();
  const pixels = [];

  function indexForColor(color) {
    let index = colorIndex.get(color);
    if (index === undefined) {
      index = colors.length;
      colorIndex.set(color, index);
      colors.push(color);
    }
    return index;
  }

  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const offset = (y * info.width + x) * 4;
      const alpha = data[offset + 3];
      if (!includeTransparent && alpha === 0) continue;
      const color = `#${data[offset].toString(16).padStart(2, "0")}${data[offset + 1].toString(16).padStart(2, "0")}${data[offset + 2].toString(16).padStart(2, "0")}${alpha.toString(16).padStart(2, "0")}`;
      pixels.push([x, y, indexForColor(color)]);
    }
  }

  return {
    w: info.width,
    h: info.height,
    c: colors,
    p: pixels,
  };
}

module.exports = {
  pixelScaleImage,
  truePixelImage,
  pixelJsonImage,
};
