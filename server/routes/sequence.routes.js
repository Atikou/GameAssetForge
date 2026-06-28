const { binaryResponse, zipResponse } = require("../lib/http");
const { buildSequenceRenameZip, buildSequenceAnimation } = require("../tools/sequence");

function registerSequenceRoutes(app, upload) {
  app.post("/api/sequence/rename", upload.array("frames", 512), async (req, res, next) => {
    try {
      await zipResponse(res, await buildSequenceRenameZip(req.files || [], req.body), "renamed-sequence.zip");
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/sequence/animation", upload.array("frames", 512), async (req, res, next) => {
    try {
      const result = await buildSequenceAnimation(req.files || [], req.body);
      const contentTypes = { gif: "image/gif", webp: "image/webp", mp4: "video/mp4" };
      res.setHeader("X-GameAssetForge-Metadata", Buffer.from(JSON.stringify({ fps: result.fps, count: result.count, format: result.format })).toString("base64"));
      binaryResponse(res, result.buffer, `animation.${result.format}`, contentTypes[result.format]);
    } catch (error) {
      next(error);
    }
  });
}

module.exports = { registerSequenceRoutes };
