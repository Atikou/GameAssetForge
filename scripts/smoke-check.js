const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const requiredFiles = [
  "index.html",
  "src/app.js",
  "src/styles.css",
  "scripts/serve-open.js",
  "server/index.js",
  "mcp/server.js",
  "README.md",
  "docs/API.md",
  "docs/MCP.md",
  ".gitignore",
];

for (const file of requiredFiles) {
  const fullPath = path.join(root, file);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Missing required file: ${file}`);
  }
}

const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const js = fs.readFileSync(path.join(root, "src/app.js"), "utf8");
const server = fs.readFileSync(path.join(root, "server/index.js"), "utf8");
const mcp = fs.readFileSync(path.join(root, "mcp/server.js"), "utf8");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

for (const id of [
  "toolOverview",
  "overviewTitle",
  "overviewDesc",
  "enterToolButton",
  "chromaInput",
  "resizeInput",
  "interpolateAInput",
  "interpolateBInput",
  "generateInterpolate",
  "videoInput",
  "frameGrid",
  "downloadAtlas",
  "eyedropperButton",
  "animationCanvas",
  "toggleAnimation",
  "videoChromaEnabled",
  "videoKeyPreset",
  "batchInput",
  "processBatch",
  "trimInput",
  "trimSourceCanvas",
  "pixelScaleInput",
  "pixelScaleResultCanvas",
  "pixelEditorFrame",
  "pixelEditorCanvas",
  "editorGridOverlay",
  "editorBrushPreview",
  "sequenceInput",
  "atlasSliceInput",
  "atlasAutoMode",
  "sliceNamePrefix",
  "atlasAutoThreshold",
  "atlasAutoMinArea",
  "atlasAutoPadding",
  "atlasSliceCanvas",
]) {
  if (!html.includes(`id="${id}"`) && !html.includes(`id='${id}'`)) {
    throw new Error(`Missing HTML id: ${id}`);
  }
}

for (const route of [
  "/api/image/chroma-key",
  "/api/image/resize",
  "/api/image/trim-transparent",
  "/api/image/pixel-scale",
  "/api/image/interpolate",
  "/api/batch/process",
  "/api/sequence/rename",
  "/api/atlas/slice",
  "/api/atlas/auto-slice",
  "/api/atlas",
  "/api/video/extract-frames",
  "/api/video/chroma-key",
]) {
  if (!server.includes(route)) {
    throw new Error(`Missing API route: ${route}`);
  }
}

for (const tool of [
  "health_check",
  "chroma_key_image",
  "resize_image",
  "trim_transparent_edges",
  "pixel_scale_image",
  "interpolate_images",
  "build_atlas",
  "batch_process_images",
  "rename_sequence",
  "slice_atlas",
  "auto_slice_atlas",
  "extract_video_frames",
  "chroma_key_video",
]) {
  if (!mcp.includes(`"${tool}"`)) {
    throw new Error(`Missing MCP tool: ${tool}`);
  }
}

if (packageJson.scripts.mcp !== "node mcp/server.js") {
  throw new Error("Missing npm mcp script");
}

if (!html.includes('class="back-to-overview"')) {
  throw new Error("Missing back-to-overview buttons");
}

for (const removedId of ["toolPrev", "toolNext"]) {
  if (html.includes(`id="${removedId}"`) || html.includes(`id='${removedId}'`)) {
    throw new Error(`Removed wheel control is still present: ${removedId}`);
  }
}

for (const removedText of ["brand-mark", "status-pill", "statusText", "游戏素材工具台"]) {
  if (html.includes(removedText)) {
    throw new Error(`Removed header content is still present: ${removedText}`);
  }
}

new Function(js);
new Function(server);
new Function(mcp);
console.log("Smoke check passed.");
