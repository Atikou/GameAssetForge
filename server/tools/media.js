const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const sharp = require("sharp");
const { ffmpegPath, withTempDir, runFfmpeg } = require("../lib/process");
const { parseNumber, parseBoolean, presetToColor } = require("../lib/common");
const { chromaKey } = require("./image");

async function processAudio(file, body = {}) {
  if (!ffmpegPath) {
    const error = new Error("ffmpeg-static is not available.");
    error.statusCode = 500;
    throw error;
  }

  const operation = body.operation === "normalize" ? "normalize" : "convert";
  const format = ["ogg", "mp3", "wav", "m4a"].includes(body.format) ? body.format : "ogg";
  const bitrate = String(body.bitrate || "160k");
  return withTempDir(async (dir) => {
    const inputExt = path.extname(file.originalname || "") || ".wav";
    const inputPath = path.join(dir, `input${inputExt}`);
    const outputPath = path.join(dir, `audio.${format}`);
    await fs.writeFile(inputPath, file.buffer);
    const args = ["-hide_banner", "-loglevel", "error", "-i", inputPath];
    if (operation === "normalize") args.push("-af", "loudnorm=I=-16:LRA=11:TP=-1.5");
    if (format === "ogg") args.push("-c:a", "libvorbis", "-ar", "44100");
    if (format === "mp3") args.push("-ar", "44100");
    if (format !== "wav") args.push("-b:a", bitrate);
    args.push(outputPath);
    await runFfmpeg(args);
    return {
      buffer: await fs.readFile(outputPath),
      format,
      operation,
    };
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
    spill: parseNumber(body.spill ?? body.spillStrength, 85, 0, 100),
    edgeCleanup: parseNumber(body.edgeCleanup, 18, 0, 100),
    matting: parseBoolean(body.matting ?? body.autoTrimap, true),
    mattingRadius: parseNumber(body.mattingRadius, 4, 1, 32),
    mattingStrength: parseNumber(body.mattingStrength, 70, 0, 100),
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

  return {
    interval,
    frames: processedFrames,
    color,
    tolerance: options.tolerance,
    softness: options.softness,
    spill: options.spill,
    edgeCleanup: options.edgeCleanup,
    matting: options.matting,
    mattingRadius: options.mattingRadius,
    mattingStrength: options.mattingStrength,
  };
}

module.exports = {
  processAudio,
  extractVideoFrames,
  videoChromaKey,
};
