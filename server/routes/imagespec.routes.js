"use strict";

const { ImageSpecService } = require("../../imagespec/core");
const protocol = require("../../imagespec/protocol");
const { createImageSpecAccess } = require("../imagespec/access");

function registerImageSpecRoutes(app, options = {}) {
  const service = options.imagespecService || new ImageSpecService();
  const access = options.imagespecAccess || createImageSpecAccess(options.imagespecAccessOptions);
  const projectPath = (req, pathOptions) => access.resolveProjectPath(req.body?.projectPath, pathOptions);

  app.get("/api/imagespec/capabilities", (req, res) => {
    res.json({ capabilities: service.listCapabilities(), projectRoots: access.roots });
  });

  app.get("/api/imagespec/schema/:name", (req, res, next) => {
    try {
      const schema = protocol.schemas[req.params.name];
      if (!schema) {
        const error = new Error(`Unknown ImageSpec schema: ${req.params.name}`);
        error.statusCode = 404;
        throw error;
      }
      res.json(schema);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/imagespec/project/create", async (req, res, next) => {
    try {
      const resolved = projectPath(req, { appendSuffix: true });
      res.status(201).json(await service.createProject(resolved, req.body.project || req.body));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/imagespec/project/inspect", async (req, res, next) => {
    try {
      res.json(await service.inspectProject(projectPath(req)));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/imagespec/project/read", async (req, res, next) => {
    try {
      res.json(await service.readProject(projectPath(req)));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/imagespec/asset/find", async (req, res, next) => {
    try {
      res.json({ assets: await service.findAssets(projectPath(req), req.body.query || "") });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/imagespec/plan/create", async (req, res, next) => {
    try {
      res.status(201).json(await service.createPlan(projectPath(req), req.body.plan || req.body.input || {}));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/imagespec/plan/list", async (req, res, next) => {
    try {
      res.json({ plans: await service.listPlans(projectPath(req)) });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/imagespec/receipt/list", async (req, res, next) => {
    try {
      res.json({ receipts: await service.listReceipts(projectPath(req)) });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/imagespec/file/read", async (req, res, next) => {
    try {
      const relativePath = req.body.relativePath || req.body.path;
      const buffer = await service.readProjectFile(projectPath(req), relativePath);
      const extension = String(relativePath || "").split(".").at(-1).toLowerCase();
      const contentTypes = { png: "image/png", webp: "image/webp", jpg: "image/jpeg", jpeg: "image/jpeg", json: "application/json", zip: "application/zip" };
      res.setHeader("Content-Type", contentTypes[extension] || "application/octet-stream");
      res.send(buffer);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/imagespec/plan/preview", async (req, res, next) => {
    try {
      res.json(await service.previewPlan(projectPath(req), req.body.plan || req.body.planId));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/imagespec/plan/apply", async (req, res, next) => {
    try {
      res.json(
        await service.applyPlan(projectPath(req), req.body.plan || req.body.planId, {
          approved: Boolean(req.body.approved),
          approval: req.body.approval || (req.body.approved ? { id: `http.${Date.now()}` } : null),
        }),
      );
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/imagespec/validate", async (req, res, next) => {
    try {
      const resolved = projectPath(req);
      if (!req.body.apply) return res.json(await service.validateProject(resolved, { forBuild: Boolean(req.body.forBuild) }));
      const plan = await service.createValidationPlan(resolved);
      return res.json(await service.applyPlan(resolved, plan.planId));
    } catch (error) {
      return next(error);
    }
  });

  app.post("/api/imagespec/build", async (req, res, next) => {
    try {
      const resolved = projectPath(req);
      const plan = await service.createBuildPlan(resolved, req.body.presetId);
      res.json(await service.applyPlan(resolved, plan.planId));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/imagespec/export", async (req, res, next) => {
    try {
      const resolved = projectPath(req);
      const plan = await service.createExportPlan(resolved, req.body.presetId, req.body.outputPath);
      res.json(await service.applyPlan(resolved, plan.planId));
    } catch (error) {
      next(error);
    }
  });
}

module.exports = { registerImageSpecRoutes };
