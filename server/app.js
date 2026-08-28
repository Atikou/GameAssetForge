"use strict";

const path = require("path");
const express = require("express");
const multer = require("multer");

const { registerRoutes } = require("./routes");

function createApp(options = {}) {
  const app = express();
  const upload = options.upload || multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: 500 * 1024 * 1024,
      files: 512,
    },
  });
  const root = options.root || path.resolve(__dirname, "..");
  app.use(express.json({ limit: "2mb" }));
  app.use(express.static(root, { extensions: ["html"] }));
  registerRoutes(app, upload, options);
  app.use((error, req, res, next) => {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      error: {
        code: error.code || "GAME_ASSET_FORGE_ERROR",
        message: error.message || "Internal server error",
        details: error.details || {},
        ...(error.receipt ? { receipt: error.receipt } : {}),
      },
    });
  });
  return app;
}

module.exports = { createApp };
