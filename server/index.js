const path = require("path");

const express = require("express");
const multer = require("multer");

const { registerRoutes } = require("./routes");

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 500 * 1024 * 1024,
    files: 512,
  },
});

const root = path.resolve(__dirname, "..");
const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 5180);

app.use(express.json({ limit: "2mb" }));
app.use(express.static(root, { extensions: ["html"] }));

registerRoutes(app, upload);

app.use((error, req, res, next) => {
  const statusCode = error.statusCode || 500;
  res.status(statusCode).json({
    error: {
      message: error.message || "Internal server error",
    },
  });
});

app.listen(port, host, () => {
  console.log(`GameAssetForge API ????http://${host}:${port}`);
  console.log("API ???docs/API.md");
});
