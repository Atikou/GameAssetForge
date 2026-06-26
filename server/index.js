const crypto = require("crypto");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const express = require("express");
const ffmpegPath = require("ffmpeg-static");
const JSZip = require("jszip");
const multer = require("multer");
const sharp = require("sharp");

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 500 * 1024 * 1024,
    files: 512,
  },
});

const root = path.resolve(__dirname, "..");
const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 5180);

app.use(express.json({ limit: "2mb" }));
app.use(express.static(root, { extensions: ["html"] }));

function parseNumber(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function normalizeHexColor(value, fallback = "#00ff00") {
  const color = typeof value === "string" ? value.trim() : "";
  if (/^#[0-9a-fA-F]{6}$/.test(color)) return color;
  if (/^[0-9a-fA-F]{6}$/.test(color)) return `#${color}`;
  return fallback;
}

function hexToRgb(hex) {
  const clean = hex.replace("#", "");
  const value = Number.parseInt(clean, 16);
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  };
}

function presetToColor(preset, customColor) {
  const presets = {
    green: "#00ff00",
    magenta: "#ff00ff",
    blue: "#006bff",
  };
  if (preset === "custom") return normalizeHexColor(customColor);
  return presets[preset] || normalizeHexColor(customColor, presets.green);
}

function naturalCompare(a, b) {
  return String(a).localeCompare(String(b), "zh-Hans-CN", {
    numeric: true,
    sensitivity: "base",
  });
}

function safeBaseName(filename, fallback) {
  const parsed = path.parse(filename || "");
  return (parsed.name || fallback).replace(/[<>:"/\\|?*\x00-\x1f]/g, "_");
}

function safeExtension(filename, fallback = ".png") {
  const extension = path.extname(filename || "").toLowerCase();
  return extension && extension.length <= 12 ? extension : fallback;
}

function requireFile(req, fieldName = "image") {
  const file = req.file || req.files?.[fieldName]?.[0];
  if (!file) {
    const error = new Error(`Missing multipart file field: ${fieldName}`);
    error.statusCode = 400;
    throw error;
  }
  return file;
}

function pngResponse(res, buffer, filename) {
  res.setHeader("Content-Type", "image/png");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(buffer);
}

async function zipResponse(res, zip, filename) {
  const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(buffer);
}

async function chromaKey(buffer, options) {
  const source = sharp(buffer).ensureAlpha();
  const metadata = await source.metadata();
  const { data, info } = await source.raw().toBuffer({ resolveWithObject: true });
  const key = hexToRgb(options.color);
  const tolerance = options.tolerance;
  const softness = options.softness;
  const fadeStart = Math.max(0, tolerance - softness);
  const fadeRange = Math.max(1, tolerance - fadeStart);

  for (let i = 0; i < data.length; i += 4) {
    const dr = data[i] - key.r;
    const dg = data[i + 1] - key.g;
    const db = data[i + 2] - key.b;
    const distance = Math.sqrt(dr * dr + dg * dg + db * db);
    if (distance <= fadeStart) {
      data[i + 3] = 0;
    } else if (distance < tolerance) {
      const alphaFactor = (distance - fadeStart) / fadeRange;
      data[i + 3] = Math.round(data[i + 3] * alphaFactor);
    }
  }

  return sharp(data, {
    raw: {
      width: info.width || metadata.width,
      height: info.height || metadata.height,
      channels: 4,
    },
  })
    .png()
    .toBuffer();
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

async function buildAtlas(files, body) {
  if (!files.length) {
    const error = new Error("Missing multipart file field: frames");
    error.statusCode = 400;
    throw error;
  }

  const frames = await Promise.all(
    files.map(async (file, index) => {
      const png = await sharp(file.buffer).png().toBuffer();
      const metadata = await sharp(png).metadata();
      return {
        name: file.originalname || `frame_${String(index + 1).padStart(4, "0")}.png`,
        buffer: png,
        width: metadata.width || 1,
        height: metadata.height || 1,
      };
    }),
  );

  const maxFrameWidth = Math.max(...frames.map((frame) => frame.width));
  const maxFrameHeight = Math.max(...frames.map((frame) => frame.height));
  const columns = parseNumber(body.columns, Math.ceil(Math.sqrt(frames.length)), 1, frames.length);
  const rows = Math.ceil(frames.length / columns);
  const composites = [];
  const metadata = {
    image: "atlas.png",
    width: columns * maxFrameWidth,
    height: rows * maxFrameHeight,
    frames: [],
  };

  frames.forEach((frame, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const left = column * maxFrameWidth;
    const top = row * maxFrameHeight;
    composites.push({ input: frame.buffer, left, top });
    metadata.frames.push({
      name: path.parse(frame.name).name || `frame_${index + 1}`,
      x: left,
      y: top,
      w: frame.width,
      h: frame.height,
    });
  });

  const atlas = await sharp({
    create: {
      width: metadata.width,
      height: metadata.height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(composites)
    .png()
    .toBuffer();

  return { atlas, metadata };
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

function sortUploadedFiles(files, mode = "natural") {
  const sorted = [...files].sort((a, b) => naturalCompare(a.originalname, b.originalname));
  if (mode === "reverse") sorted.reverse();
  if (mode === "mtime") return [...files];
  return sorted;
}

async function buildSequenceRenameZip(files, body = {}) {
  if (!files.length) {
    const error = new Error("Missing multipart file field: frames");
    error.statusCode = 400;
    throw error;
  }

  const prefix = String(body.prefix || "frame").trim() || "frame";
  const start = parseNumber(body.start, 0, 0, 999999);
  const padding = parseNumber(body.padding, 4, 1, 8);
  const format = body.format === "png" ? "png" : "original";
  const sorted = sortUploadedFiles(files, body.sort);
  const zip = new JSZip();
  const manifest = {
    count: sorted.length,
    prefix,
    start,
    padding,
    sort: body.sort || "natural",
    format,
    frames: [],
  };

  for (const [index, file] of sorted.entries()) {
    const number = String(start + index).padStart(padding, "0");
    const extension = format === "png" ? ".png" : safeExtension(file.originalname);
    const name = `${prefix}_${number}${extension}`;
    const buffer = format === "png" ? await sharp(file.buffer).png().toBuffer() : file.buffer;
    zip.file(name, buffer);
    manifest.frames.push({
      index,
      source: file.originalname,
      name,
    });
  }

  zip.file("manifest.json", JSON.stringify(manifest, null, 2));
  return zip;
}

async function buildAtlasSliceZip(file, body = {}) {
  if (!file) {
    const error = new Error("Missing multipart file field: image");
    error.statusCode = 400;
    throw error;
  }

  const metadata = await sharp(file.buffer).metadata();
  const imageWidth = metadata.width || 1;
  const imageHeight = metadata.height || 1;
  const columns = parseNumber(body.columns, 1, 1, 512);
  const rows = parseNumber(body.rows, 1, 1, 512);
  const marginX = parseNumber(body.marginX, 0, 0, imageWidth);
  const marginY = parseNumber(body.marginY, 0, 0, imageHeight);
  const gapX = parseNumber(body.gapX, 0, 0, imageWidth);
  const gapY = parseNumber(body.gapY, 0, 0, imageHeight);
  const cellWidth = parseNumber(
    body.cellWidth,
    Math.max(1, Math.floor((imageWidth - marginX * 2 - gapX * (columns - 1)) / columns)),
    1,
    imageWidth,
  );
  const cellHeight = parseNumber(
    body.cellHeight,
    Math.max(1, Math.floor((imageHeight - marginY * 2 - gapY * (rows - 1)) / rows)),
    1,
    imageHeight,
  );
  const prefix = String(body.prefix || "slice").trim() || "slice";
  const zip = new JSZip();
  const manifest = {
    image: file.originalname,
    width: imageWidth,
    height: imageHeight,
    columns,
    rows,
    cellWidth,
    cellHeight,
    marginX,
    marginY,
    gapX,
    gapY,
    frames: [],
  };

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const left = marginX + column * (cellWidth + gapX);
      const top = marginY + row * (cellHeight + gapY);
      if (left + cellWidth > imageWidth || top + cellHeight > imageHeight) continue;
      const index = manifest.frames.length;
      const name = `${prefix}_${String(index + 1).padStart(4, "0")}.png`;
      const output = await sharp(file.buffer)
        .extract({ left, top, width: cellWidth, height: cellHeight })
        .png()
        .toBuffer();
      zip.file(name, output);
      manifest.frames.push({
        index,
        name,
        x: left,
        y: top,
        w: cellWidth,
        h: cellHeight,
      });
    }
  }

  zip.file("manifest.json", JSON.stringify(manifest, null, 2));
  return zip;
}

function parseSliceBoxes(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function buildAtlasSliceBoxesZip(file, body = {}) {
  if (!file) {
    const error = new Error("Missing multipart file field: image");
    error.statusCode = 400;
    throw error;
  }

  const metadata = await sharp(file.buffer).metadata();
  const imageWidth = metadata.width || 1;
  const imageHeight = metadata.height || 1;
  const prefix = String(body.prefix || "slice").trim().replace(/[<>:"/\\|?*\x00-\x1f]/g, "_") || "slice";
  const boxes = parseSliceBoxes(body.boxes);
  if (!boxes.length) {
    const error = new Error('Missing "boxes" JSON array.');
    error.statusCode = 400;
    throw error;
  }

  const zip = new JSZip();
  const manifest = {
    image: file.originalname,
    width: imageWidth,
    height: imageHeight,
    source: "boxes",
    prefix,
    frames: [],
  };

  for (const [rawIndex, box] of boxes.entries()) {
    const x = parseNumber(box.x, 0, 0, imageWidth - 1);
    const y = parseNumber(box.y, 0, 0, imageHeight - 1);
    const w = parseNumber(box.w ?? box.width, 1, 1, imageWidth - x);
    const h = parseNumber(box.h ?? box.height, 1, 1, imageHeight - y);
    const index = manifest.frames.length;
    const fallbackName = `${prefix}_${String(index + 1).padStart(4, "0")}.png`;
    const name = String(box.name || fallbackName).replace(/[<>:"/\\|?*\x00-\x1f]/g, "_");
    const fileName = name.endsWith(".png") ? name : `${name}.png`;
    const output = await sharp(file.buffer).extract({ left: x, top: y, width: w, height: h }).png().toBuffer();
    zip.file(fileName, output);
    manifest.frames.push({ index, sourceIndex: rawIndex, name: fileName, x, y, w, h });
  }

  zip.file("manifest.json", JSON.stringify(manifest, null, 2));
  return zip;
}

function getRawPixel(data, width, x, y) {
  const index = (y * width + x) * 4;
  return {
    r: data[index],
    g: data[index + 1],
    b: data[index + 2],
    a: data[index + 3],
  };
}

function getRawCornerBackground(data, width, height) {
  const points = [
    [0, 0],
    [width - 1, 0],
    [0, height - 1],
    [width - 1, height - 1],
  ];
  const sum = points.reduce(
    (acc, [x, y]) => {
      const pixel = getRawPixel(data, width, x, y);
      acc.r += pixel.r;
      acc.g += pixel.g;
      acc.b += pixel.b;
      acc.a += pixel.a;
      return acc;
    },
    { r: 0, g: 0, b: 0, a: 0 },
  );
  return {
    r: Math.round(sum.r / points.length),
    g: Math.round(sum.g / points.length),
    b: Math.round(sum.b / points.length),
    a: Math.round(sum.a / points.length),
  };
}

function buildRawAtlasMask(raw, mode, threshold) {
  const { data, info } = raw;
  const width = info.width;
  const height = info.height;
  const mask = new Uint8Array(width * height);
  const background = getRawCornerBackground(data, width, height);
  let transparentCount = 0;
  let foregroundCount = 0;

  for (let pixelIndex = 0; pixelIndex < mask.length; pixelIndex += 1) {
    const index = pixelIndex * 4;
    const alpha = data[index + 3];
    if (alpha <= threshold) transparentCount += 1;
    const dr = data[index] - background.r;
    const dg = data[index + 1] - background.g;
    const db = data[index + 2] - background.b;
    const da = alpha - background.a;
    const colorDistance = Math.sqrt(dr * dr + dg * dg + db * db + da * da);
    const isForeground = mode === "alpha" ? alpha > threshold : colorDistance > threshold;
    if (isForeground) {
      mask[pixelIndex] = 1;
      foregroundCount += 1;
    }
  }

  return { mask, width, height, background, transparentCount, foregroundCount };
}

function connectedBoxesFromRawMask(mask, width, height, minArea, padding) {
  const visited = new Uint8Array(mask.length);
  const stack = new Int32Array(mask.length);
  const boxes = [];

  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || visited[start]) continue;
    let stackLength = 1;
    let area = 0;
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    stack[0] = start;
    visited[start] = 1;

    while (stackLength) {
      const current = stack[--stackLength];
      const x = current % width;
      const y = Math.floor(current / width);
      area += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);

      const neighbors = [current - 1, current + 1, current - width, current + width];
      if (x === 0) neighbors[0] = -1;
      if (x === width - 1) neighbors[1] = -1;
      for (const next of neighbors) {
        if (next < 0 || next >= mask.length || !mask[next] || visited[next]) continue;
        visited[next] = 1;
        stack[stackLength] = next;
        stackLength += 1;
      }
    }

    if (area < minArea) continue;
    const x = Math.max(0, minX - padding);
    const y = Math.max(0, minY - padding);
    const right = Math.min(width - 1, maxX + padding);
    const bottom = Math.min(height - 1, maxY + padding);
    boxes.push({ x, y, w: right - x + 1, h: bottom - y + 1, area });
  }

  return boxes;
}

function runsFromRawProjection(projection, blankLimit) {
  const runs = [];
  let start = -1;
  projection.forEach((count, index) => {
    const filled = count > blankLimit;
    if (filled && start < 0) start = index;
    if ((!filled || index === projection.length - 1) && start >= 0) {
      const end = filled && index === projection.length - 1 ? index : index - 1;
      if (end >= start) runs.push([start, end]);
      start = -1;
    }
  });
  return runs;
}

function gridBoxesFromRawMask(mask, width, height, minArea, padding) {
  const columnProjection = Array.from({ length: width }, () => 0);
  const rowProjection = Array.from({ length: height }, () => 0);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!mask[y * width + x]) continue;
      columnProjection[x] += 1;
      rowProjection[y] += 1;
    }
  }
  const columnRuns = runsFromRawProjection(columnProjection, Math.max(0, Math.floor(height * 0.01)));
  const rowRuns = runsFromRawProjection(rowProjection, Math.max(0, Math.floor(width * 0.01)));
  const boxes = [];
  rowRuns.forEach(([top, bottom]) => {
    columnRuns.forEach(([left, right]) => {
      const w = right - left + 1;
      const h = bottom - top + 1;
      if (w * h < minArea) return;
      const x = Math.max(0, left - padding);
      const y = Math.max(0, top - padding);
      boxes.push({
        x,
        y,
        w: Math.min(width - x, w + padding * 2),
        h: Math.min(height - y, h + padding * 2),
      });
    });
  });
  return { boxes, columnRuns, rowRuns };
}

async function buildAutoAtlasSliceZip(file, body = {}) {
  if (!file) {
    const error = new Error("Missing multipart file field: image");
    error.statusCode = 400;
    throw error;
  }

  const mode = ["auto", "alpha", "solid", "grid"].includes(body.mode) ? body.mode : "auto";
  const threshold = parseNumber(body.threshold, 16, 0, 255);
  const minArea = parseNumber(body.minArea, 8, 1, 999999999);
  const padding = parseNumber(body.padding, 0, 0, 4096);
  const prefix = String(body.prefix || "slice").trim().replace(/[<>:"/\\|?*\x00-\x1f]/g, "_") || "slice";
  const raw = await sharp(file.buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const alphaMask = buildRawAtlasMask(raw, "alpha", threshold);
  const solidMask = buildRawAtlasMask(raw, "solid", threshold);
  const alphaBoxes = connectedBoxesFromRawMask(alphaMask.mask, alphaMask.width, alphaMask.height, minArea, padding);
  const solidBoxes = connectedBoxesFromRawMask(solidMask.mask, solidMask.width, solidMask.height, minArea, padding);
  const alphaRatio = alphaMask.transparentCount / alphaMask.mask.length;
  const sourceMask = alphaRatio > 0.01 ? alphaMask : solidMask;
  const grid = gridBoxesFromRawMask(sourceMask.mask, sourceMask.width, sourceMask.height, minArea, padding);
  let boxes = [];
  let detectedMode = "auto";

  if (mode === "alpha") {
    boxes = alphaBoxes;
    detectedMode = "alpha";
  } else if (mode === "solid") {
    boxes = solidBoxes;
    detectedMode = "solid";
  } else if (mode === "grid") {
    boxes = grid.boxes;
    detectedMode = "grid";
  } else if (alphaRatio > 0.01 && alphaBoxes.length) {
    boxes = alphaBoxes;
    detectedMode = "alpha";
  } else if (grid.boxes.length > 1) {
    boxes = grid.boxes;
    detectedMode = "grid";
  } else {
    boxes = solidBoxes;
    detectedMode = "solid";
  }

  boxes = [...boxes].sort((a, b) => (a.y === b.y ? a.x - b.x : a.y - b.y));
  const zip = new JSZip();
  const manifest = {
    image: file.originalname,
    width: raw.info.width,
    height: raw.info.height,
    detection: {
      requestedMode: mode,
      detectedMode,
      threshold,
      minArea,
      padding,
      prefix,
      alphaRatio,
      background: solidMask.background,
    },
    frames: [],
  };

  for (const [index, box] of boxes.entries()) {
    const name = `${prefix}_${String(index + 1).padStart(4, "0")}.png`;
    const output = await sharp(file.buffer)
      .extract({ left: box.x, top: box.y, width: box.w, height: box.h })
      .png()
      .toBuffer();
    zip.file(name, output);
    manifest.frames.push({ index, name, x: box.x, y: box.y, w: box.w, h: box.h, area: box.area });
  }

  zip.file("manifest.json", JSON.stringify(manifest, null, 2));
  return zip;
}

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

async function withTempDir(callback) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "game-asset-forge-"));
  try {
    return await callback(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { windowsHide: true });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr || `ffmpeg exited with code ${code}`));
    });
  });
}

async function extractVideoFrames(file, body) {
  if (!ffmpegPath) {
    const error = new Error("ffmpeg-static is not available.");
    error.statusCode = 500;
    throw error;
  }

  const interval = parseNumber(body.interval, 0.5, 0.05, 60);
  const maxFrames = parseNumber(body.maxFrames, 240, 1, 2000);

  return withTempDir(async (dir) => {
    const extension = path.extname(file.originalname || "") || ".mp4";
    const inputPath = path.join(dir, `input-${crypto.randomUUID()}${extension}`);
    const outputPattern = path.join(dir, "frame_%04d.png");
    await fs.writeFile(inputPath, file.buffer);

    await runFfmpeg([
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      inputPath,
      "-vf",
      `fps=1/${interval}`,
      "-frames:v",
      String(maxFrames),
      outputPattern,
    ]);

    const names = (await fs.readdir(dir))
      .filter((name) => /^frame_\d+\.png$/.test(name))
      .sort();
    const frames = await Promise.all(
      names.map(async (name, index) => {
        const buffer = await fs.readFile(path.join(dir, name));
        const metadata = await sharp(buffer).metadata();
        return {
          name,
          buffer,
          time: Number((index * interval).toFixed(4)),
          width: metadata.width || 0,
          height: metadata.height || 0,
        };
      }),
    );
    return { interval, frames };
  });
}

async function videoChromaKey(file, body) {
  const { interval, frames } = await extractVideoFrames(file, body);
  const color = presetToColor(body.preset, body.color);
  const options = {
    color,
    tolerance: parseNumber(body.tolerance, 72, 0, 441),
    softness: parseNumber(body.softness, 18, 0, 441),
  };

  const processedFrames = await Promise.all(
    frames.map(async (frame) => {
      const buffer = await chromaKey(frame.buffer, options);
      const metadata = await sharp(buffer).metadata();
      return {
        ...frame,
        buffer,
        width: metadata.width || frame.width,
        height: metadata.height || frame.height,
      };
    }),
  );

  return { interval, frames: processedFrames, color, tolerance: options.tolerance, softness: options.softness };
}

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    name: "GameAssetForge",
    version: "0.1.0",
  });
});

app.post("/api/image/chroma-key", upload.single("image"), async (req, res, next) => {
  try {
    const file = requireFile(req);
    const color = presetToColor(req.body.preset, req.body.color);
    const output = await chromaKey(file.buffer, {
      color,
      tolerance: parseNumber(req.body.tolerance, 72, 0, 441),
      softness: parseNumber(req.body.softness, 18, 0, 441),
    });
    pngResponse(res, output, "chroma-key-result.png");
  } catch (error) {
    next(error);
  }
});

app.post("/api/image/resize", upload.single("image"), async (req, res, next) => {
  try {
    const file = requireFile(req);
    const output = await resizeImage(file.buffer, req.body);
    pngResponse(res, output, "resized-image.png");
  } catch (error) {
    next(error);
  }
});

app.post("/api/image/trim-transparent", upload.single("image"), async (req, res, next) => {
  try {
    const file = requireFile(req);
    const { output, metadata } = await trimTransparent(file.buffer, req.body);
    res.setHeader("X-GameAssetForge-Metadata", Buffer.from(JSON.stringify(metadata)).toString("base64"));
    pngResponse(res, output, "trimmed-image.png");
  } catch (error) {
    next(error);
  }
});

app.post("/api/image/pixel-scale", upload.single("image"), async (req, res, next) => {
  try {
    const file = requireFile(req);
    const { output, metadata } = await pixelScaleImage(file.buffer, req.body);
    res.setHeader("X-GameAssetForge-Metadata", Buffer.from(JSON.stringify(metadata)).toString("base64"));
    pngResponse(res, output, "pixel-scaled-image.png");
  } catch (error) {
    next(error);
  }
});

app.post(
  "/api/image/interpolate",
  upload.fields([
    { name: "frameA", maxCount: 1 },
    { name: "frameB", maxCount: 1 },
  ]),
  async (req, res, next) => {
    try {
      const frameA = requireFile(req, "frameA");
      const frameB = requireFile(req, "frameB");
      const output = await interpolateImages(frameA.buffer, frameB.buffer, req.body);
      pngResponse(res, output, "interpolated-frame.png");
    } catch (error) {
      next(error);
    }
  },
);

app.post("/api/atlas", upload.array("frames", 256), async (req, res, next) => {
  try {
    const { atlas, metadata } = await buildAtlas(req.files || [], req.body);
    const zip = new JSZip();
    zip.file("atlas.png", atlas);
    zip.file("atlas.json", JSON.stringify(metadata, null, 2));
    await zipResponse(res, zip, "atlas.zip");
  } catch (error) {
    next(error);
  }
});

app.post("/api/batch/process", upload.array("images", 512), async (req, res, next) => {
  try {
    const zip = await buildBatchZip(req.files || [], req.body);
    await zipResponse(res, zip, "batch-results.zip");
  } catch (error) {
    next(error);
  }
});

app.post("/api/sequence/rename", upload.array("frames", 512), async (req, res, next) => {
  try {
    const zip = await buildSequenceRenameZip(req.files || [], req.body);
    await zipResponse(res, zip, "renamed-sequence.zip");
  } catch (error) {
    next(error);
  }
});

app.post("/api/atlas/slice", upload.single("image"), async (req, res, next) => {
  try {
    const zip = await buildAtlasSliceZip(requireFile(req), req.body);
    await zipResponse(res, zip, "atlas-slices.zip");
  } catch (error) {
    next(error);
  }
});

app.post("/api/atlas/slice-boxes", upload.single("image"), async (req, res, next) => {
  try {
    const zip = await buildAtlasSliceBoxesZip(requireFile(req), req.body);
    await zipResponse(res, zip, "atlas-box-slices.zip");
  } catch (error) {
    next(error);
  }
});

app.post("/api/atlas/auto-slice", upload.single("image"), async (req, res, next) => {
  try {
    const zip = await buildAutoAtlasSliceZip(requireFile(req), req.body);
    await zipResponse(res, zip, "atlas-auto-slices.zip");
  } catch (error) {
    next(error);
  }
});

app.post("/api/video/extract-frames", upload.single("video"), async (req, res, next) => {
  try {
    const file = requireFile(req, "video");
    const { interval, frames } = await extractVideoFrames(file, req.body);
    const manifest = {
      interval,
      count: frames.length,
      frames: frames.map((frame) => ({
        name: frame.name,
        time: frame.time,
        width: frame.width,
        height: frame.height,
      })),
    };
    const zip = new JSZip();
    zip.file("manifest.json", JSON.stringify(manifest, null, 2));
    frames.forEach((frame) => zip.file(frame.name, frame.buffer));
    await zipResponse(res, zip, "video-frames.zip");
  } catch (error) {
    next(error);
  }
});

app.post("/api/video/chroma-key", upload.single("video"), async (req, res, next) => {
  try {
    const file = requireFile(req, "video");
    const { interval, frames, color, tolerance, softness } = await videoChromaKey(file, req.body);
    const manifest = {
      interval,
      count: frames.length,
      chromaKey: {
        color,
        tolerance,
        softness,
      },
      frames: frames.map((frame) => ({
        name: frame.name,
        time: frame.time,
        width: frame.width,
        height: frame.height,
      })),
    };
    const zip = new JSZip();
    zip.file("manifest.json", JSON.stringify(manifest, null, 2));
    frames.forEach((frame) => zip.file(frame.name, frame.buffer));
    await zipResponse(res, zip, "video-transparent-frames.zip");
  } catch (error) {
    next(error);
  }
});

app.use((error, req, res, next) => {
  const statusCode = error.statusCode || 500;
  res.status(statusCode).json({
    error: {
      message: error.message || "Internal server error",
    },
  });
});

app.listen(port, host, () => {
  console.log(`GameAssetForge API 已启动：http://${host}:${port}`);
  console.log(`API 文档：docs/API.md`);
});
