const sharp = require("sharp");
const { parseNumber, parseBoolean, normalizeHexColor, hexToRgb } = require("../../lib/common");

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
  edgeFixImage,
  stylizeImage,
  normalMapImage,
  maskMapImage,
  colorAdjustImage,
};
