const { parseNumber, parseBoolean, presetToColor, contentTypeForImageFormat } = require("../lib/common");
const { requireFile, pngResponse, binaryResponse } = require("../lib/http");
const {
  chromaKey,
  convertImage,
  resizeImage,
  edgeFixImage,
  stylizeImage,
  normalMapImage,
  maskMapImage,
  trimTransparent,
  pixelScaleImage,
  truePixelImage,
  pixelJsonImage,
  interpolateImages,
} = require("../tools/image");

function registerImageRoutes(app, upload) {
  app.post("/api/image/chroma-key", upload.single("image"), async (req, res, next) => {
    try {
      const file = requireFile(req);
      const color = presetToColor(req.body.preset, req.body.color);
      const output = await chromaKey(file.buffer, {
        color,
        tolerance: parseNumber(req.body.tolerance, 72, 0, 441),
        softness: parseNumber(req.body.softness, 18, 0, 441),
        spill: parseNumber(req.body.spill ?? req.body.spillStrength, 85, 0, 100),
        edgeCleanup: parseNumber(req.body.edgeCleanup, 18, 0, 100),
        matting: parseBoolean(req.body.matting ?? req.body.autoTrimap, true),
        mattingRadius: parseNumber(req.body.mattingRadius, 4, 1, 32),
        mattingStrength: parseNumber(req.body.mattingStrength, 70, 0, 100),
      });
      pngResponse(res, output, "chroma-key-result.png");
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/image/convert", upload.single("image"), async (req, res, next) => {
    try {
      const { output, format, metadata } = await convertImage(requireFile(req).buffer, req.body);
      res.setHeader("X-GameAssetForge-Metadata", Buffer.from(JSON.stringify(metadata)).toString("base64"));
      binaryResponse(res, output, `converted.${format === "jpeg" ? "jpg" : format}`, contentTypeForImageFormat(format));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/image/resize", upload.single("image"), async (req, res, next) => {
    try {
      pngResponse(res, await resizeImage(requireFile(req).buffer, req.body), "resized-image.png");
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/image/edge-fix", upload.single("image"), async (req, res, next) => {
    try {
      pngResponse(res, await edgeFixImage(requireFile(req).buffer, req.body), "edge-fixed.png");
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/image/stylize", upload.single("image"), async (req, res, next) => {
    try {
      pngResponse(res, await stylizeImage(requireFile(req).buffer, req.body), "stylized.png");
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/image/normal-map", upload.single("image"), async (req, res, next) => {
    try {
      pngResponse(res, await normalMapImage(requireFile(req).buffer, req.body), "normal-map.png");
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/image/mask-map", upload.single("image"), async (req, res, next) => {
    try {
      pngResponse(res, await maskMapImage(requireFile(req).buffer, req.body), "mask-map.png");
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/image/trim-transparent", upload.single("image"), async (req, res, next) => {
    try {
      const { output, metadata } = await trimTransparent(requireFile(req).buffer, req.body);
      res.setHeader("X-GameAssetForge-Metadata", Buffer.from(JSON.stringify(metadata)).toString("base64"));
      pngResponse(res, output, "trimmed-image.png");
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/image/pixel-scale", upload.single("image"), async (req, res, next) => {
    try {
      const { output, metadata } = await pixelScaleImage(requireFile(req).buffer, req.body);
      res.setHeader("X-GameAssetForge-Metadata", Buffer.from(JSON.stringify(metadata)).toString("base64"));
      pngResponse(res, output, "pixel-scaled-image.png");
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/image/true-pixel", upload.single("image"), async (req, res, next) => {
    try {
      const { output, metadata } = await truePixelImage(requireFile(req).buffer, req.body);
      res.setHeader("X-GameAssetForge-Metadata", Buffer.from(JSON.stringify(metadata)).toString("base64"));
      pngResponse(res, output, "true-pixel-image.png");
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/image/pixel-json", upload.single("image"), async (req, res, next) => {
    try {
      const data = await pixelJsonImage(requireFile(req).buffer, req.body);
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Content-Disposition", 'attachment; filename="pixel-image.json"');
      res.json(data);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/image/interpolate", upload.fields([{ name: "frameA", maxCount: 1 }, { name: "frameB", maxCount: 1 }]), async (req, res, next) => {
    try {
      pngResponse(res, await interpolateImages(requireFile(req, "frameA").buffer, requireFile(req, "frameB").buffer, req.body), "interpolated-frame.png");
    } catch (error) {
      next(error);
    }
  });
}

module.exports = { registerImageRoutes };
