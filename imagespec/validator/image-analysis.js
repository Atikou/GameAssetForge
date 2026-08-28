"use strict";

const sharp = require("sharp");

async function analyzeImage(buffer) {
  const image = sharp(buffer, { animated: false }).ensureAlpha();
  const metadata = await image.metadata();
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
  let transparentPixels = 0;
  let opaquePixels = 0;
  let semiTransparentPixels = 0;
  let matteWhitePixels = 0;
  let matteBlackPixels = 0;
  for (let index = 0; index < data.length; index += info.channels) {
    const alpha = data[index + 3];
    if (alpha === 0) transparentPixels += 1;
    else if (alpha === 255) opaquePixels += 1;
    else {
      semiTransparentPixels += 1;
      const red = data[index];
      const green = data[index + 1];
      const blue = data[index + 2];
      if (red >= 245 && green >= 245 && blue >= 245) matteWhitePixels += 1;
      if (red <= 10 && green <= 10 && blue <= 10) matteBlackPixels += 1;
    }
  }
  return {
    width: info.width,
    height: info.height,
    format: metadata.format,
    channels: info.channels,
    hasAlpha: Boolean(metadata.hasAlpha),
    totalPixels: info.width * info.height,
    transparentPixels,
    opaquePixels,
    semiTransparentPixels,
    matteWhitePixels,
    matteBlackPixels,
  };
}

function pointInPolygon(x, y, points) {
  let inside = false;
  for (let index = 0, previous = points.length - 1; index < points.length; previous = index, index += 1) {
    const currentPoint = points[index];
    const previousPoint = points[previous];
    const intersects =
      currentPoint.y > y !== previousPoint.y > y &&
      x < ((previousPoint.x - currentPoint.x) * (y - currentPoint.y)) / (previousPoint.y - currentPoint.y || Number.EPSILON) + currentPoint.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointInRegion(x, y, region) {
  const geometry = region.geometry;
  const bounds = geometry.bounds;
  if (geometry.type === "ellipse") {
    const radiusX = bounds.width / 2;
    const radiusY = bounds.height / 2;
    const dx = x - (bounds.x + radiusX);
    const dy = y - (bounds.y + radiusY);
    return radiusX > 0 && radiusY > 0 && (dx * dx) / (radiusX * radiusX) + (dy * dy) / (radiusY * radiusY) <= 1;
  }
  if ((geometry.type === "polygon" || geometry.type === "brush") && geometry.points?.length >= 3) return pointInPolygon(x, y, geometry.points);
  return x >= bounds.x && x < bounds.x + bounds.width && y >= bounds.y && y < bounds.y + bounds.height;
}

async function compareImagePixels(beforeBuffer, afterBuffer, allowedRegions = []) {
  const beforeImage = sharp(beforeBuffer, { animated: false }).ensureAlpha();
  const afterImage = sharp(afterBuffer, { animated: false }).ensureAlpha();
  const [beforeMetadata, afterMetadata] = await Promise.all([beforeImage.metadata(), afterImage.metadata()]);
  const beforeSize = { width: beforeMetadata.width || 0, height: beforeMetadata.height || 0 };
  const afterSize = { width: afterMetadata.width || 0, height: afterMetadata.height || 0 };
  if (beforeSize.width !== afterSize.width || beforeSize.height !== afterSize.height) {
    return { sameSize: false, beforeSize, afterSize, changedPixels: null, outsideChangedPixels: null };
  }
  const [before, after] = await Promise.all([beforeImage.raw().toBuffer(), afterImage.raw().toBuffer()]);
  let changedPixels = 0;
  let outsideChangedPixels = 0;
  for (let pixel = 0; pixel < beforeSize.width * beforeSize.height; pixel += 1) {
    const offset = pixel * 4;
    if (
      before[offset] === after[offset] &&
      before[offset + 1] === after[offset + 1] &&
      before[offset + 2] === after[offset + 2] &&
      before[offset + 3] === after[offset + 3]
    ) {
      continue;
    }
    changedPixels += 1;
    const x = pixel % beforeSize.width;
    const y = Math.floor(pixel / beforeSize.width);
    if (!allowedRegions.some((region) => pointInRegion(x, y, region))) outsideChangedPixels += 1;
  }
  return { sameSize: true, beforeSize, afterSize, changedPixels, outsideChangedPixels };
}

module.exports = {
  analyzeImage,
  compareImagePixels,
  pointInRegion,
  pointInPolygon,
};
