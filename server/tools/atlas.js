const crypto = require("crypto");
const path = require("path");
const JSZip = require("jszip");
const sharp = require("sharp");
const { parseNumber, parseBoolean, nextPowerOfTwo } = require("../lib/common");
const { trimTransparent } = require("./image");

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

async function addExtrudeBorder(buffer, size) {
  const extrude = Math.round(parseNumber(size, 0, 0, 32));
  if (!extrude) return buffer;
  const metadata = await sharp(buffer).metadata();
  const width = metadata.width || 1;
  const height = metadata.height || 1;
  const edge = async (left, top, w, h, outW, outH) =>
    sharp(buffer).extract({ left, top, width: w, height: h }).resize(outW, outH, { kernel: sharp.kernel.nearest }).png().toBuffer();
  const composites = [
    { input: await edge(0, 0, 1, 1, extrude, extrude), left: 0, top: 0 },
    { input: await edge(width - 1, 0, 1, 1, extrude, extrude), left: width + extrude, top: 0 },
    { input: await edge(0, height - 1, 1, 1, extrude, extrude), left: 0, top: height + extrude },
    { input: await edge(width - 1, height - 1, 1, 1, extrude, extrude), left: width + extrude, top: height + extrude },
    { input: await edge(0, 0, width, 1, width, extrude), left: extrude, top: 0 },
    { input: await edge(0, height - 1, width, 1, width, extrude), left: extrude, top: height + extrude },
    { input: await edge(0, 0, 1, height, extrude, height), left: 0, top: extrude },
    { input: await edge(width - 1, 0, 1, height, extrude, height), left: width + extrude, top: extrude },
    { input: buffer, left: extrude, top: extrude },
  ];

  return sharp({
    create: {
      width: width + extrude * 2,
      height: height + extrude * 2,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(composites)
    .png()
    .toBuffer();
}

function shelfPack(frames, maxWidth, padding) {
  let x = padding;
  let y = padding;
  let rowHeight = 0;
  let usedWidth = 0;

  for (const frame of frames) {
    if (frame.width + padding * 2 > maxWidth) {
      const error = new Error(`Frame ${frame.name} is wider than max atlas size.`);
      error.statusCode = 400;
      throw error;
    }
    if (x + frame.width + padding > maxWidth) {
      x = padding;
      y += rowHeight + padding;
      rowHeight = 0;
    }
    frame.x = x;
    frame.y = y;
    x += frame.width + padding;
    rowHeight = Math.max(rowHeight, frame.height);
    usedWidth = Math.max(usedWidth, x);
  }

  return {
    width: Math.max(1, usedWidth + padding),
    height: Math.max(1, y + rowHeight + padding),
  };
}

function engineManifest(engine, metadata) {
  if (engine === "unity") {
    return {
      texture: metadata.image,
      sprites: metadata.frames.map((frame) => ({
        name: frame.name,
        rect: { x: frame.x, y: frame.y, width: frame.w, height: frame.h },
        pivot: { x: 0.5, y: 0.5 },
      })),
    };
  }
  if (engine === "godot") {
    return {
      texture: metadata.image,
      frames: metadata.frames.map((frame) => ({
        name: frame.name,
        region: [frame.x, frame.y, frame.w, frame.h],
        sourceSize: [frame.sourceW, frame.sourceH],
      })),
    };
  }
  if (engine === "cocos" || engine === "pixi") {
    return {
      frames: Object.fromEntries(
        metadata.frames.map((frame) => [
          frame.name,
          {
            frame: { x: frame.x, y: frame.y, w: frame.w, h: frame.h },
            rotated: false,
            trimmed: Boolean(frame.trimmed),
            spriteSourceSize: { x: frame.offsetX || 0, y: frame.offsetY || 0, w: frame.w, h: frame.h },
            sourceSize: { w: frame.sourceW, h: frame.sourceH },
          },
        ]),
      ),
      meta: {
        image: metadata.image,
        size: { w: metadata.width, h: metadata.height },
        scale: "1",
      },
    };
  }
  return metadata;
}

async function buildPackedAtlasZip(files, body = {}) {
  if (!files.length) {
    const error = new Error("Missing multipart file field: frames");
    error.statusCode = 400;
    throw error;
  }

  const padding = Math.round(parseNumber(body.padding, 2, 0, 256));
  const extrude = Math.round(parseNumber(body.extrude, 1, 0, 32));
  const trim = parseBoolean(body.trim, true);
  const powerOfTwo = parseBoolean(body.powerOfTwo, false);
  const maxSize = Math.round(parseNumber(body.maxSize, 2048, 64, 16384));
  const engine = ["generic", "unity", "godot", "cocos", "pixi"].includes(body.engine) ? body.engine : "generic";

  const frames = [];
  for (const [index, file] of files.entries()) {
    const sourceMetadata = await sharp(file.buffer).metadata();
    const sourceW = sourceMetadata.width || 1;
    const sourceH = sourceMetadata.height || 1;
    const trimmed = trim ? await trimTransparent(file.buffer, { alphaThreshold: 1, padding: 0 }) : null;
    const prepared = trim ? trimmed.output : await sharp(file.buffer).png().toBuffer();
    const extruded = await addExtrudeBorder(prepared, extrude);
    const metadata = await sharp(extruded).metadata();
    frames.push({
      name: path.parse(file.originalname || `frame_${index + 1}`).name,
      buffer: extruded,
      width: metadata.width || 1,
      height: metadata.height || 1,
      sourceW,
      sourceH,
      offsetX: trimmed?.metadata?.x || 0,
      offsetY: trimmed?.metadata?.y || 0,
      trimW: trimmed?.metadata?.width || sourceW,
      trimH: trimmed?.metadata?.height || sourceH,
      trimmed: trim,
      extrude,
    });
  }

  frames.sort((a, b) => b.height - a.height || b.width - a.width);
  const packed = shelfPack(frames, maxSize, padding);
  const atlasWidth = powerOfTwo ? nextPowerOfTwo(packed.width) : packed.width;
  const atlasHeight = powerOfTwo ? nextPowerOfTwo(packed.height) : packed.height;
  if (atlasWidth > maxSize || atlasHeight > maxSize) {
    const error = new Error(`Packed atlas exceeds maxSize ${maxSize}.`);
    error.statusCode = 400;
    throw error;
  }

  const composites = frames.map((frame) => ({ input: frame.buffer, left: frame.x, top: frame.y }));
  const atlas = await sharp({
    create: {
      width: atlasWidth,
      height: atlasHeight,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(composites)
    .png()
    .toBuffer();

  const metadata = {
    image: "atlas.png",
    width: atlasWidth,
    height: atlasHeight,
    padding,
    extrude,
    trim,
    powerOfTwo,
    maxSize,
    engine,
    frames: frames.map((frame, index) => ({
      index,
      name: frame.name,
      x: frame.x + extrude,
      y: frame.y + extrude,
      w: Math.max(1, frame.width - extrude * 2),
      h: Math.max(1, frame.height - extrude * 2),
      packedX: frame.x,
      packedY: frame.y,
      packedW: frame.width,
      packedH: frame.height,
      sourceW: frame.sourceW,
      sourceH: frame.sourceH,
      offsetX: frame.offsetX,
      offsetY: frame.offsetY,
      trimmed: frame.trimmed,
    })),
  };

  const zip = new JSZip();
  zip.file("atlas.png", atlas);
  zip.file("atlas.json", JSON.stringify(metadata, null, 2));
  zip.file(`${engine}.json`, JSON.stringify(engineManifest(engine, metadata), null, 2));
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

async function buildNineSliceZip(file, body = {}) {
  if (!file) {
    const error = new Error("Missing multipart file field: image");
    error.statusCode = 400;
    throw error;
  }

  const png = await sharp(file.buffer).png().toBuffer();
  const metadata = await sharp(png).metadata();
  const width = metadata.width || 1;
  const height = metadata.height || 1;
  const left = Math.round(parseNumber(body.left, Math.floor(width / 3), 0, width - 1));
  const right = Math.round(parseNumber(body.right, Math.floor(width / 3), 0, width - left - 1));
  const top = Math.round(parseNumber(body.top, Math.floor(height / 3), 0, height - 1));
  const bottom = Math.round(parseNumber(body.bottom, Math.floor(height / 3), 0, height - top - 1));
  const xs = [0, left, width - right, width];
  const ys = [0, top, height - bottom, height];
  const names = [
    ["top_left", "top", "top_right"],
    ["left", "center", "right"],
    ["bottom_left", "bottom", "bottom_right"],
  ];
  const zip = new JSZip();
  const slices = [];

  zip.file("source.png", png);
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      const x = xs[column];
      const y = ys[row];
      const w = Math.max(1, xs[column + 1] - x);
      const h = Math.max(1, ys[row + 1] - y);
      const name = `${names[row][column]}.png`;
      const output = await sharp(png).extract({ left: x, top: y, width: w, height: h }).png().toBuffer();
      zip.file(name, output);
      slices.push({ name, x, y, w, h });
    }
  }

  zip.file(
    "nine-slice.json",
    JSON.stringify(
      {
        image: "source.png",
        width,
        height,
        border: { left, right, top, bottom },
        slices,
      },
      null,
      2,
    ),
  );
  return zip;
}

async function buildTilesetZip(file, body = {}) {
  if (!file) {
    const error = new Error("Missing multipart file field: image");
    error.statusCode = 400;
    throw error;
  }

  const metadata = await sharp(file.buffer).metadata();
  const imageWidth = metadata.width || 1;
  const imageHeight = metadata.height || 1;
  const tileWidth = Math.round(parseNumber(body.tileWidth, 16, 1, imageWidth));
  const tileHeight = Math.round(parseNumber(body.tileHeight, 16, 1, imageHeight));
  const marginX = Math.round(parseNumber(body.marginX, 0, 0, imageWidth));
  const marginY = Math.round(parseNumber(body.marginY, 0, 0, imageHeight));
  const gapX = Math.round(parseNumber(body.gapX, 0, 0, imageWidth));
  const gapY = Math.round(parseNumber(body.gapY, 0, 0, imageHeight));
  const dedupe = parseBoolean(body.dedupe, true);
  const zip = new JSZip();
  const hashToId = new Map();
  const manifest = {
    image: file.originalname,
    tileWidth,
    tileHeight,
    marginX,
    marginY,
    gapX,
    gapY,
    dedupe,
    tiles: [],
    map: [],
  };
  let tileId = 0;

  for (let y = marginY, row = 0; y + tileHeight <= imageHeight; y += tileHeight + gapY, row += 1) {
    const mapRow = [];
    for (let x = marginX, column = 0; x + tileWidth <= imageWidth; x += tileWidth + gapX, column += 1) {
      const output = await sharp(file.buffer).extract({ left: x, top: y, width: tileWidth, height: tileHeight }).png().toBuffer();
      const hash = crypto.createHash("sha1").update(output).digest("hex");
      let id = hashToId.get(hash);
      if (!dedupe || id === undefined) {
        id = tileId;
        tileId += 1;
        hashToId.set(hash, id);
        const name = `tile_${String(id).padStart(4, "0")}.png`;
        zip.file(name, output);
        manifest.tiles.push({ id, name, hash, x, y, w: tileWidth, h: tileHeight });
      }
      mapRow.push(id);
      manifest.map.push({ row, column, tileId: id, sourceX: x, sourceY: y });
    }
  }

  zip.file("tileset.json", JSON.stringify(manifest, null, 2));
  return zip;
}

module.exports = {
  buildAtlas,
  buildPackedAtlasZip,
  buildAtlasSliceZip,
  buildAtlasSliceBoxesZip,
  buildAutoAtlasSliceZip,
  buildNineSliceZip,
  buildTilesetZip,
};
