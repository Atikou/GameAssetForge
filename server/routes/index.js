const { registerHealthRoutes } = require("./health.routes");
const { registerImageRoutes } = require("./image.routes");
const { registerAtlasRoutes } = require("./atlas.routes");
const { registerBatchRoutes } = require("./batch.routes");
const { registerSequenceRoutes } = require("./sequence.routes");
const { registerMediaRoutes } = require("./media.routes");
const { registerQualityRoutes } = require("./quality.routes");
const { registerUnityRoutes } = require("./unity.routes");
const { registerRankingRoutes } = require("./rankings.routes");

function registerRoutes(app, upload) {
  registerHealthRoutes(app);
  registerImageRoutes(app, upload);
  registerAtlasRoutes(app, upload);
  registerBatchRoutes(app, upload);
  registerSequenceRoutes(app, upload);
  registerMediaRoutes(app, upload);
  registerQualityRoutes(app, upload);
  registerUnityRoutes(app, upload);
  registerRankingRoutes(app);
}

module.exports = { registerRoutes };
