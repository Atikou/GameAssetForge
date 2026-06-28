const { zipResponse } = require("../lib/http");
const { buildBatchZip, buildBatchColorZip } = require("../tools/batch");

function registerBatchRoutes(app, upload) {
  app.post("/api/batch/process", upload.array("images", 512), async (req, res, next) => {
    try {
      await zipResponse(res, await buildBatchZip(req.files || [], req.body), "batch-results.zip");
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/batch/color", upload.array("images", 512), async (req, res, next) => {
    try {
      await zipResponse(res, await buildBatchColorZip(req.files || [], req.body), "batch-color.zip");
    } catch (error) {
      next(error);
    }
  });
}

module.exports = { registerBatchRoutes };
