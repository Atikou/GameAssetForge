const sharp = require("sharp");
const { parseNumber, parseBoolean, hexToRgb, clampByte, smoothStep } = require("../../lib/common");

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

function guidedFilterAlphaSingleChannel(data, width, height, alpha, radius, epsilon, guideSelector) {
  const count = width * height;
  const guide = new Float32Array(count);
  const guideAlpha = new Float32Array(count);
  const guideGuide = new Float32Array(count);
  for (let pixel = 0; pixel < count; pixel += 1) {
    const i = pixel * 4;
    const guideValue = guideSelector(data[i], data[i + 1], data[i + 2]);
    guide[pixel] = guideValue;
    guideAlpha[pixel] = guideValue * alpha[pixel];
    guideGuide[pixel] = guideValue * guideValue;
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

function guidedFilterAlpha(data, width, height, alpha, radius, epsilon) {
  const luma = guidedFilterAlphaSingleChannel(
    data,
    width,
    height,
    alpha,
    radius,
    epsilon,
    (r, g, b) => (r * 0.2126 + g * 0.7152 + b * 0.0722) / 255,
  );
  const red = guidedFilterAlphaSingleChannel(data, width, height, alpha, radius, epsilon, (r) => r / 255);
  const green = guidedFilterAlphaSingleChannel(data, width, height, alpha, radius, epsilon, (r, g) => g / 255);
  const blue = guidedFilterAlphaSingleChannel(data, width, height, alpha, radius, epsilon, (r, g, b) => b / 255);
  const output = new Float32Array(alpha.length);
  for (let i = 0; i < output.length; i += 1) {
    output[i] = Math.max(0, Math.min(1, luma[i] * 0.52 + red[i] * 0.16 + green[i] * 0.16 + blue[i] * 0.16));
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

function decontaminateEdgeColors(data, key, refinedAlpha, distance, options) {
  const spill = parseNumber(options.spill ?? options.spillStrength, 85, 0, 100) / 100;
  if (spill <= 0) return;
  const spillRange = Math.max(1, options.tolerance + options.softness * 2 + 24);

  for (let i = 0, pixel = 0; i < data.length; i += 4, pixel += 1) {
    const alpha = refinedAlpha[pixel];
    if (alpha <= 0.01) continue;
    const nearKey = Math.max(0, 1 - distance[pixel] / spillRange);
    const edgeMask = Math.max(1 - alpha, nearKey * 0.6);
    const blend = Math.min(0.92, spill * edgeMask);
    if (blend <= 0) continue;

    const safeAlpha = Math.max(0.08, alpha);
    const recoveredR = (data[i] - key.r * (1 - safeAlpha)) / safeAlpha;
    const recoveredG = (data[i + 1] - key.g * (1 - safeAlpha)) / safeAlpha;
    const recoveredB = (data[i + 2] - key.b * (1 - safeAlpha)) / safeAlpha;
    data[i] = clampByte(data[i] * (1 - blend) + recoveredR * blend);
    data[i + 1] = clampByte(data[i + 1] * (1 - blend) + recoveredG * blend);
    data[i + 2] = clampByte(data[i + 2] * (1 - blend) + recoveredB * blend);

    const suppressed = suppressDominantSpill(data[i], data[i + 1], data[i + 2], key, spill, nearKey);
    data[i] = suppressed.r;
    data[i + 1] = suppressed.g;
    data[i + 2] = suppressed.b;
  }
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
  decontaminateEdgeColors(data, key, refinedAlpha, distanceMap, {
    ...options,
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


module.exports = { chromaKey };
