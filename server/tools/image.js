const sharp = require("sharp");
const { parseNumber, parseBoolean, normalizeHexColor, hexToRgb, clampByte, smoothStep } = require("../lib/common");

function estimateRawBackgroundColor(data, width, height) {
  const samples = [];
  const radius = Math.max(1, Math.min(4, Math.floor(Math.min(width, height) / 24)));
  const anchors = [
    [0, 0],
    [width - 1, 0],
    [0, height - 1],
    [width - 1, height - 1],
  ];

  anchors.forEach(([anchorX, anchorY]) => {
    for (let oy = -radius; oy <= radius; oy += 1) {
      for (let ox = -radius; ox <= radius; ox += 1) {
        const x = Math.max(0, Math.min(width - 1, anchorX + ox));
        const y = Math.max(0, Math.min(height - 1, anchorY + oy));
        const index = (y * width + x) * 4;
        samples.push([data[index], data[index + 1], data[index + 2]]);
      }
    }
  });

  const median = (channel) => {
    const values = samples.map((sample) => sample[channel]).sort((a, b) => a - b);
    return values[Math.floor(values.length / 2)] || 0;
  };

  return { r: median(0), g: median(1), b: median(2) };
}

function suppressDominantSpill(r, g, b, key, strength, mask) {
  if (strength <= 0 || mask <= 0) return { r, g, b };
  const channels = [r, g, b];
  const keyChannels = [key.r, key.g, key.b];
  const dominant = keyChannels.indexOf(Math.max(...keyChannels));
  const sortedKey = [...keyChannels].sort((a, b) => b - a);
  if (sortedKey[0] - sortedKey[1] < 36) return { r, g, b };

  const otherIndices = [0, 1, 2].filter((index) => index !== dominant);
  const otherMax = Math.max(channels[otherIndices[0]], channels[otherIndices[1]]);
  const excess = Math.max(0, channels[dominant] - otherMax);
  channels[dominant] -= excess * strength * mask;
  return { r: clampByte(channels[0]), g: clampByte(channels[1]), b: clampByte(channels[2]) };
}

function boxFilterFloat(values, width, height, radius) {
  const integral = new Float64Array((width + 1) * (height + 1));
  for (let y = 0; y < height; y += 1) {
    let rowSum = 0;
    const integralRow = (y + 1) * (width + 1);
    const previousRow = y * (width + 1);
    for (let x = 0; x < width; x += 1) {
      rowSum += values[y * width + x];
      integral[integralRow + x + 1] = integral[previousRow + x + 1] + rowSum;
    }
  }

  const output = new Float32Array(values.length);
  for (let y = 0; y < height; y += 1) {
    const y0 = Math.max(0, y - radius);
    const y1 = Math.min(height - 1, y + radius);
    for (let x = 0; x < width; x += 1) {
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(width - 1, x + radius);
      const area = (x1 - x0 + 1) * (y1 - y0 + 1);
      const a = y0 * (width + 1) + x0;
      const b = y0 * (width + 1) + x1 + 1;
      const c = (y1 + 1) * (width + 1) + x0;
      const d = (y1 + 1) * (width + 1) + x1 + 1;
      output[y * width + x] = (integral[d] - integral[b] - integral[c] + integral[a]) / area;
    }
  }
  return output;
}

function guidedFilterAlpha(data, width, height, alpha, radius, epsilon) {
  const count = width * height;
  const guide = new Float32Array(count);
  const guideAlpha = new Float32Array(count);
  const guideGuide = new Float32Array(count);
  for (let pixel = 0; pixel < count; pixel += 1) {
    const i = pixel * 4;
    const luminance = (data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722) / 255;
    guide[pixel] = luminance;
    guideAlpha[pixel] = luminance * alpha[pixel];
    guideGuide[pixel] = luminance * luminance;
  }

  const meanGuide = boxFilterFloat(guide, width, height, radius);
  const meanAlpha = boxFilterFloat(alpha, width, height, radius);
  const meanGuideAlpha = boxFilterFloat(guideAlpha, width, height, radius);
  const meanGuideGuide = boxFilterFloat(guideGuide, width, height, radius);
  const a = new Float32Array(count);
  const b = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    const covariance = meanGuideAlpha[i] - meanGuide[i] * meanAlpha[i];
    const variance = meanGuideGuide[i] - meanGuide[i] * meanGuide[i];
    a[i] = covariance / (variance + epsilon);
    b[i] = meanAlpha[i] - a[i] * meanGuide[i];
  }

  const meanA = boxFilterFloat(a, width, height, radius);
  const meanB = boxFilterFloat(b, width, height, radius);
  const output = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    output[i] = Math.max(0, Math.min(1, meanA[i] * guide[i] + meanB[i]));
  }
  return output;
}

function refineAlphaWithAutoTrimap(data, width, height, alpha, distance, options) {
  const enabled = parseBoolean(options.matting ?? options.autoTrimap, true);
  const strength = parseNumber(options.mattingStrength, 70, 0, 100) / 100;
  if (!enabled || strength <= 0) return alpha;

  const radius = Math.round(parseNumber(options.mattingRadius, 4, 1, 32));
  const epsilon = parseNumber(options.mattingEpsilon, 0.0008, 0.000001, 0.1);
  const refined = guidedFilterAlpha(data, width, height, alpha, radius, epsilon);
  const output = new Float32Array(alpha.length);
  const fadeStart = options.fadeStart;
  const tolerance = options.tolerance;
  const softness = options.softness;
  const foregroundLock = tolerance + softness * 1.35;
  const backgroundLock = Math.max(0, fadeStart * 0.72);

  for (let i = 0; i < alpha.length; i += 1) {
    if (alpha[i] <= 0.015 || distance[i] <= backgroundLock) {
      output[i] = 0;
    } else if (alpha[i] >= 0.985 && distance[i] >= foregroundLock) {
      output[i] = 1;
    } else {
      output[i] = Math.max(0, Math.min(1, alpha[i] * (1 - strength) + refined[i] * strength));
    }
  }

  return output;
}

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

async function chromaKey(buffer, options) {
  const source = sharp(buffer).ensureAlpha();
  const metadata = await source.metadata();
  const { data, info } = await source.raw().toBuffer({ resolveWithObject: true });
  const key = options.color === "auto" ? estimateRawBackgroundColor(data, info.width, info.height) : hexToRgb(options.color);
  const tolerance = options.tolerance;
  const softness = options.softness;
  const fadeStart = Math.max(0, tolerance - softness);
  const fadeRange = Math.max(1, tolerance - fadeStart);
  const spill = parseNumber(options.spill ?? options.spillStrength, 85, 0, 100) / 100;
  const edgeCleanup = parseNumber(options.edgeCleanup, 18, 0, 100) / 100;
  const spillRange = tolerance + softness * 2 + 24;
  const edgeFloor = edgeCleanup * 0.22;
  const pixelCount = (info.width || metadata.width) * (info.height || metadata.height);
  const alpha = new Float32Array(pixelCount);
  const distanceMap = new Float32Array(pixelCount);

  for (let i = 0, pixel = 0; i < data.length; i += 4, pixel += 1) {
    const dr = data[i] - key.r;
    const dg = data[i + 1] - key.g;
    const db = data[i + 2] - key.b;
    const distance = Math.sqrt(dr * dr + dg * dg + db * db);
    distanceMap[pixel] = distance;
    let matte = 1;
    if (distance <= fadeStart) {
      matte = 0;
    } else if (distance < tolerance) {
      matte = smoothStep(fadeStart, tolerance, distance);
    }

    if (edgeCleanup > 0 && matte > 0 && matte < 1) {
      matte = matte <= edgeFloor ? 0 : (matte - edgeFloor) / (1 - edgeFloor);
    }

    const originalAlpha = data[i + 3] / 255;
    const finalAlpha = Math.max(0, Math.min(1, originalAlpha * matte));

    if (finalAlpha > 0 && spill > 0) {
      const decontaminateMask = Math.max(1 - matte, Math.max(0, 1 - distance / Math.max(1, spillRange)));
      if (decontaminateMask > 0) {
        const safeAlpha = Math.max(0.06, finalAlpha);
        const recoveredR = (data[i] - key.r * (1 - safeAlpha)) / safeAlpha;
        const recoveredG = (data[i + 1] - key.g * (1 - safeAlpha)) / safeAlpha;
        const recoveredB = (data[i + 2] - key.b * (1 - safeAlpha)) / safeAlpha;
        const blend = spill * decontaminateMask;
        data[i] = clampByte(data[i] * (1 - blend) + recoveredR * blend);
        data[i + 1] = clampByte(data[i + 1] * (1 - blend) + recoveredG * blend);
        data[i + 2] = clampByte(data[i + 2] * (1 - blend) + recoveredB * blend);
      }
      const nearKey = Math.max(0, 1 - distance / Math.max(1, spillRange));
      const dominantMask = distance < spillRange ? 1 : 0;
      const suppressed = suppressDominantSpill(data[i], data[i + 1], data[i + 2], key, spill, dominantMask);
      data[i] = suppressed.r;
      data[i + 1] = suppressed.g;
      data[i + 2] = suppressed.b;
    }
    alpha[pixel] = finalAlpha;
  }

  const refinedAlpha = refineAlphaWithAutoTrimap(data, info.width || metadata.width, info.height || metadata.height, alpha, distanceMap, {
    ...options,
    fadeStart,
    tolerance,
    softness,
  });

  for (let i = 3, pixel = 0; i < data.length; i += 4, pixel += 1) {
    data[i] = clampByte(refinedAlpha[pixel] * 255);
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

function parseRgbColor(value, fallback = "#000000") {
  const rgb = hexToRgb(normalizeHexColor(value, fallback));
  return { r: rgb.r, g: rgb.g, b: rgb.b, alpha: 1 };
}

async function edgeFixImage(buffer, body = {}) {
  const iterations = Math.round(parseNumber(body.iterations, 8, 1, 64));
  const alphaThreshold = parseNumber(body.alphaThreshold, 8, 0, 255);
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const output = Buffer.from(data);
  const width = info.width;
  const height = info.height;

  for (let pass = 0; pass < iterations; pass += 1) {
    const previous = Buffer.from(output);
    let changed = false;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = (y * width + x) * 4;
        if (previous[index + 3] > alphaThreshold) continue;
        let count = 0;
        const sum = [0, 0, 0];
        for (let oy = -1; oy <= 1; oy += 1) {
          for (let ox = -1; ox <= 1; ox += 1) {
            if (!ox && !oy) continue;
            const nx = x + ox;
            const ny = y + oy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            const neighbor = (ny * width + nx) * 4;
            if (previous[neighbor + 3] <= alphaThreshold) continue;
            sum[0] += previous[neighbor];
            sum[1] += previous[neighbor + 1];
            sum[2] += previous[neighbor + 2];
            count += 1;
          }
        }
        if (!count) continue;
        output[index] = Math.round(sum[0] / count);
        output[index + 1] = Math.round(sum[1] / count);
        output[index + 2] = Math.round(sum[2] / count);
        changed = true;
      }
    }
    if (!changed) break;
  }

  return sharp(output, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

async function outlineImage(buffer, body = {}) {
  const color = parseRgbColor(body.color, "#ffffff");
  const thickness = Math.round(parseNumber(body.thickness, 2, 1, 64));
  const source = sharp(buffer).ensureAlpha();
  const metadata = await source.metadata();
  const width = metadata.width || 1;
  const height = metadata.height || 1;
  const { data } = await source.raw().toBuffer({ resolveWithObject: true });
  const outline = Buffer.alloc(width * height * 4);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      if (data[index + 3] > 0) continue;
      let hit = false;
      for (let oy = -thickness; oy <= thickness && !hit; oy += 1) {
        for (let ox = -thickness; ox <= thickness; ox += 1) {
          if (ox * ox + oy * oy > thickness * thickness) continue;
          const nx = x + ox;
          const ny = y + oy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          if (data[(ny * width + nx) * 4 + 3] > 8) {
            hit = true;
            break;
          }
        }
      }
      if (!hit) continue;
      outline[index] = color.r;
      outline[index + 1] = color.g;
      outline[index + 2] = color.b;
      outline[index + 3] = 255;
    }
  }

  const outlinePng = await sharp(outline, { raw: { width, height, channels: 4 } }).png().toBuffer();
  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: outlinePng }, { input: buffer }])
    .png()
    .toBuffer();
}

async function shadowImage(buffer, body = {}) {
  const metadata = await sharp(buffer).metadata();
  const offsetX = Math.round(parseNumber(body.offsetX, 4, -512, 512));
  const offsetY = Math.round(parseNumber(body.offsetY, 4, -512, 512));
  const blur = parseNumber(body.blur, 4, 0, 128);
  const opacity = parseNumber(body.opacity, 0.55, 0, 1);
  const color = parseRgbColor(body.color, "#000000");
  const width = (metadata.width || 1) + Math.abs(offsetX) + Math.ceil(blur * 4);
  const height = (metadata.height || 1) + Math.abs(offsetY) + Math.ceil(blur * 4);
  const baseLeft = Math.max(0, -offsetX) + Math.ceil(blur * 2);
  const baseTop = Math.max(0, -offsetY) + Math.ceil(blur * 2);
  const alpha = await sharp(buffer).ensureAlpha().extractChannel("alpha").toBuffer();
  const shadow = await sharp(alpha, { raw: { width: metadata.width || 1, height: metadata.height || 1, channels: 1 } })
    .blur(blur || 0.3)
    .tint({ r: color.r, g: color.g, b: color.b })
    .ensureAlpha(opacity)
    .png()
    .toBuffer();
  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      { input: shadow, left: baseLeft + offsetX, top: baseTop + offsetY, blend: "over" },
      { input: buffer, left: baseLeft, top: baseTop, blend: "over" },
    ])
    .png()
    .toBuffer();
}

async function colorAdjustImage(buffer, body = {}) {
  const brightness = parseNumber(body.brightness, 1, 0, 5);
  const saturation = parseNumber(body.saturation, 1, 0, 5);
  const hue = parseNumber(body.hue, 0, -360, 360);
  const grayscale = parseBoolean(body.grayscale, false);
  let image = sharp(buffer).ensureAlpha().modulate({ brightness, saturation, hue });
  if (grayscale) image = image.grayscale().ensureAlpha();
  return image.png().toBuffer();
}

async function paletteImage(buffer, body = {}) {
  const colors = Math.round(parseNumber(body.colors, 32, 2, 256));
  const dither = parseNumber(body.dither, 1, 0, 1);
  return sharp(buffer).png({ palette: true, colors, dither }).toBuffer();
}

async function stylizeImage(buffer, body = {}) {
  const operation = body.operation || "outline";
  if (operation === "shadow") return shadowImage(buffer, body);
  if (operation === "palette") return paletteImage(buffer, body);
  if (operation === "color") return colorAdjustImage(buffer, body);
  return outlineImage(buffer, body);
}

async function normalMapImage(buffer, body = {}) {
  const strength = parseNumber(body.strength, 2, 0.1, 16);
  const { data, info } = await sharp(buffer).greyscale().raw().toBuffer({ resolveWithObject: true });
  const width = info.width;
  const height = info.height;
  const output = Buffer.alloc(width * height * 4);
  const sample = (x, y) => data[Math.max(0, Math.min(height - 1, y)) * width + Math.max(0, Math.min(width - 1, x))] / 255;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = (sample(x + 1, y) - sample(x - 1, y)) * strength;
      const dy = (sample(x, y + 1) - sample(x, y - 1)) * strength;
      const dz = 1;
      const length = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      const index = (y * width + x) * 4;
      output[index] = Math.round((-dx / length) * 127.5 + 127.5);
      output[index + 1] = Math.round((-dy / length) * 127.5 + 127.5);
      output[index + 2] = Math.round((dz / length) * 127.5 + 127.5);
      output[index + 3] = 255;
    }
  }

  return sharp(output, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

async function maskMapImage(buffer, body = {}) {
  const channel = ["alpha", "luma"].includes(body.channel) ? body.channel : "alpha";
  const invert = parseBoolean(body.invert, false);
  let image = channel === "alpha" ? sharp(buffer).ensureAlpha().extractChannel("alpha") : sharp(buffer).greyscale();
  if (invert) image = image.negate();
  return image.png().toBuffer();
}

module.exports = {
  convertImage,
  chromaKey,
  resizeImage,
  interpolateImages,
  trimTransparent,
  pixelScaleImage,
  edgeFixImage,
  stylizeImage,
  normalMapImage,
  maskMapImage,
  colorAdjustImage,
};
