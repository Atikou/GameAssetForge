const fs = require("fs/promises");
const path = require("path");
const JSZip = require("jszip");
const sharp = require("sharp");
const { ffmpegPath, withTempDir, runFfmpeg } = require("../lib/process");
const { parseNumber, naturalCompare, safeExtension } = require("../lib/common");

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

async function buildSequenceAnimation(files, body = {}) {
  if (!files.length) {
    const error = new Error("Missing multipart file field: frames");
    error.statusCode = 400;
    throw error;
  }
  if (!ffmpegPath) {
    const error = new Error("ffmpeg-static is not available.");
    error.statusCode = 500;
    throw error;
  }

  const fps = parseNumber(body.fps, 12, 1, 60);
  const format = ["gif", "webp", "mp4"].includes(body.format) ? body.format : "gif";
  const sorted = sortUploadedFiles(files, body.sort);
  return withTempDir(async (dir) => {
    for (const [index, file] of sorted.entries()) {
      const png = await sharp(file.buffer).png().toBuffer();
      await fs.writeFile(path.join(dir, `frame_${String(index + 1).padStart(5, "0")}.png`), png);
    }

    const outputPath = path.join(dir, `animation.${format}`);
    const inputPattern = path.join(dir, "frame_%05d.png");
    const args =
      format === "gif"
        ? ["-hide_banner", "-loglevel", "error", "-framerate", String(fps), "-i", inputPattern, "-vf", "split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse", "-loop", "0", outputPath]
        : format === "webp"
          ? ["-hide_banner", "-loglevel", "error", "-framerate", String(fps), "-i", inputPattern, "-loop", "0", "-lossless", "0", "-q:v", String(parseNumber(body.quality, 80, 1, 100)), outputPath]
          : ["-hide_banner", "-loglevel", "error", "-framerate", String(fps), "-i", inputPattern, "-pix_fmt", "yuv420p", "-movflags", "+faststart", outputPath];
    await runFfmpeg(args);
    return {
      buffer: await fs.readFile(outputPath),
      format,
      fps,
      count: sorted.length,
    };
  });
}

module.exports = {
  sortUploadedFiles,
  buildSequenceRenameZip,
  buildSequenceAnimation,
};
