const { buildQualityReport } = require("../tools/batch");

function registerQualityRoutes(app, upload) {
  app.post("/api/quality/report", upload.array("images", 512), async (req, res, next) => {
    try {
      res.json(await buildQualityReport(req.files || []));
    } catch (error) {
      next(error);
    }
  });
}

module.exports = { registerQualityRoutes };
