const JSZip = require("jszip");
const { requireFile, zipResponse } = require("../lib/http");
const {
  buildAtlas,
  buildPackedAtlasZip,
  buildAtlasSliceZip,
  buildAtlasSliceBoxesZip,
  buildAutoAtlasSliceZip,
  buildNineSliceZip,
  buildTilesetZip,
} = require("../tools/atlas");

function registerAtlasRoutes(app, upload) {
  app.post("/api/atlas", upload.array("frames", 256), async (req, res, next) => {
    try {
      const { atlas, metadata } = await buildAtlas(req.files || [], req.body);
      const zip = new JSZip();
      zip.file("atlas.png", atlas);
      zip.file("atlas.json", JSON.stringify(metadata, null, 2));
      await zipResponse(res, zip, "atlas.zip");
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/atlas/pack", upload.array("frames", 512), async (req, res, next) => {
    try {
      await zipResponse(res, await buildPackedAtlasZip(req.files || [], req.body), "packed-atlas.zip");
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/atlas/slice", upload.single("image"), async (req, res, next) => {
    try {
      await zipResponse(res, await buildAtlasSliceZip(requireFile(req), req.body), "atlas-slices.zip");
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/ui/nine-slice", upload.single("image"), async (req, res, next) => {
    try {
      await zipResponse(res, await buildNineSliceZip(requireFile(req), req.body), "nine-slice.zip");
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/tileset/slice", upload.single("image"), async (req, res, next) => {
    try {
      await zipResponse(res, await buildTilesetZip(requireFile(req), req.body), "tileset.zip");
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/atlas/slice-boxes", upload.single("image"), async (req, res, next) => {
    try {
      await zipResponse(res, await buildAtlasSliceBoxesZip(requireFile(req), req.body), "atlas-box-slices.zip");
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/atlas/auto-slice", upload.single("image"), async (req, res, next) => {
    try {
      await zipResponse(res, await buildAutoAtlasSliceZip(requireFile(req), req.body), "atlas-auto-slices.zip");
    } catch (error) {
      next(error);
    }
  });
}

module.exports = { registerAtlasRoutes };
