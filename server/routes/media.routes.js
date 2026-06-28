const JSZip = require("jszip");
const { requireFile, binaryResponse, zipResponse } = require("../lib/http");
const { extractVideoFrames, videoChromaKey, processAudio } = require("../tools/media");

function registerMediaRoutes(app, upload) {
  app.post("/api/video/extract-frames", upload.single("video"), async (req, res, next) => {
    try {
      const { interval, frames } = await extractVideoFrames(requireFile(req, "video"), req.body);
      const manifest = { interval, count: frames.length, frames: frames.map((frame) => ({ name: frame.name, time: frame.time, width: frame.width, height: frame.height })) };
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
      const result = await videoChromaKey(requireFile(req, "video"), req.body);
      const manifest = {
        interval: result.interval,
        count: result.frames.length,
        chromaKey: {
          color: result.color,
          tolerance: result.tolerance,
          softness: result.softness,
          spill: result.spill,
          edgeCleanup: result.edgeCleanup,
          matting: result.matting,
          mattingRadius: result.mattingRadius,
          mattingStrength: result.mattingStrength,
        },
        frames: result.frames.map((frame) => ({ name: frame.name, time: frame.time, width: frame.width, height: frame.height })),
      };
      const zip = new JSZip();
      zip.file("manifest.json", JSON.stringify(manifest, null, 2));
      result.frames.forEach((frame) => zip.file(frame.name, frame.buffer));
      await zipResponse(res, zip, "video-transparent-frames.zip");
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/audio/process", upload.single("audio"), async (req, res, next) => {
    try {
      const result = await processAudio(requireFile(req, "audio"), req.body);
      const types = { ogg: "audio/ogg", mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4" };
      binaryResponse(res, result.buffer, `audio.${result.format}`, types[result.format]);
    } catch (error) {
      next(error);
    }
  });
}

module.exports = { registerMediaRoutes };
