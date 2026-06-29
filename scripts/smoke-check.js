const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const requiredFiles = [
  "index.html",
  "src/app.js",
  "src/styles.css",
  "scripts/serve-open.js",
  "scripts/install-unity-tools.js",
  "scripts/check-unity-tools.js",
  "server/index.js",
  "server/lib/common.js",
  "server/lib/http.js",
  "server/lib/process.js",
  "server/routes/index.js",
  "server/routes/rankings.routes.js",
  "server/tools/image.js",
  "server/tools/image/background.js",
  "server/tools/image/transform.js",
  "server/tools/image/pixel.js",
  "server/tools/image/effects.js",
  "server/tools/atlas.js",
  "server/tools/batch.js",
  "server/tools/sequence.js",
  "server/tools/media.js",
  "server/tools/app-rankings.js",
  "server/tools/unity-apk.js",
  "server/tools/unity-adapters/index.js",
  "mcp/server.js",
  "README.md",
  "docs/API.md",
  "docs/MCP.md",
  "docs/PROJECT_STRUCTURE.md",
  "tools/external/README.md",
  "tools/external/unitypy/export_unitypy.py",
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

function readTree(dir) {
  let content = "";
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      content += readTree(fullPath);
    } else if (entry.isFile() && entry.name.endsWith(".js")) {
      content += `\n${fs.readFileSync(fullPath, "utf8")}`;
    }
  }
  return content;
}

function eachJsFile(dir, callback) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      eachJsFile(fullPath, callback);
    } else if (entry.isFile() && entry.name.endsWith(".js")) {
      callback(fullPath);
    }
  }
}

const serverTree = readTree(path.join(root, "server"));
const mcpTree = readTree(path.join(root, "mcp"));

for (const id of [
  "toolOverview",
  "overviewTitle",
  "overviewDesc",
  "enterToolButton",
  "chromaInput",
  "chromaPreviewBackground",
  "chromaResultPreview",
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
  "batchOperation",
  "batchTrimAlpha",
  "batchTrimPadding",
  "batchScaleFactor",
  "batchChromaPreset",
  "batchChromaColor",
  "batchChromaTolerance",
  "batchChromaSoftness",
  "batchChromaSpill",
  "batchChromaEdgeCleanup",
  "batchTruePixelCellSize",
  "batchTruePixelOutputScale",
  "batchTruePixelColors",
  "batchTruePixelSharpen",
  "batchTruePixelKernel",
  "batchTruePixelDither",
  "processBatch",
  "trimInput",
  "trimSourceCanvas",
  "pixelScaleInput",
  "pixelScaleResultCanvas",
  "truePixelDropzone",
  "truePixelInput",
  "truePixelResultCanvas",
  "downloadTruePixel",
  "pixelEditorFrame",
  "pixelEditorCanvas",
  "editorGridOverlay",
  "editorBrushPreview",
  "sequenceInput",
  "atlasSliceInput",
  "unityApkDropzone",
  "unityApkInput",
  "unityApkMode",
  "unityApkTool",
  "unityRunMode",
  "unityApkProgress",
  "unityApkProgressFill",
  "unityApkProgressPercent",
  "unityInspectDialog",
  "unityInspectTitle",
  "unityInspectReport",
  "unityInspectConfirm",
  "unityToolCommand",
  "unityToolArgs",
  "detectUnityTools",
  "runUnityApkExtract",
  "atlasAutoMode",
  "sliceNamePrefix",
  "atlasAutoThreshold",
  "atlasAutoMinArea",
  "atlasAutoPadding",
  "atlasSliceCanvas",
  "rankingOpen",
  "rankingBackdrop",
  "rankingWindow",
  "rankingSource",
  "rankingCountry",
  "rankingChart",
  "rankingFilter",
  "rankingLimit",
  "rankingRefresh",
  "rankingTableBody",
]) {
  if (!html.includes(`id="${id}"`) && !html.includes(`id='${id}'`)) {
    throw new Error(`Missing HTML id: ${id}`);
  }
}

for (const route of [
  "/api/image/chroma-key",
  "/api/image/convert",
  "/api/image/resize",
  "/api/image/edge-fix",
  "/api/image/stylize",
  "/api/image/normal-map",
  "/api/image/mask-map",
  "/api/image/trim-transparent",
  "/api/image/pixel-scale",
  "/api/image/true-pixel",
  "/api/image/interpolate",
  "/api/batch/process",
  "/api/sequence/rename",
  "/api/atlas/slice",
  "/api/atlas/auto-slice",
  "/api/atlas",
  "/api/video/extract-frames",
  "/api/video/chroma-key",
  "/api/unity/toolchain",
  "/api/unity/apk-inspect",
  "/api/unity/apk-extract",
  "/api/unity/apk-extract/jobs",
  "/api/rankings/apps",
  "/api/rankings/providers",
]) {
  if (!serverTree.includes(route)) {
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
  "true_pixel_image",
  "extract_unity_apk",
]) {
  if (!mcpTree.includes(`"${tool}"`)) {
    throw new Error(`Missing MCP tool: ${tool}`);
  }
}

if (packageJson.scripts.mcp !== "node mcp/server.js") {
  throw new Error("Missing npm mcp script");
}

if (!html.includes('class="back-to-overview"')) {
  throw new Error("Missing back-to-overview buttons");
}

const imageTools = require(path.join(root, "server/tools/image"));
for (const imageExport of [
  "convertImage",
  "chromaKey",
  "resizeImage",
  "interpolateImages",
  "trimTransparent",
  "pixelScaleImage",
  "truePixelImage",
  "edgeFixImage",
  "stylizeImage",
  "normalMapImage",
  "maskMapImage",
  "colorAdjustImage",
]) {
  if (typeof imageTools[imageExport] !== "function") {
    throw new Error(`Missing image tool export: ${imageExport}`);
  }
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
eachJsFile(path.join(root, "server"), (filePath) => {
  new Function(fs.readFileSync(filePath, "utf8"));
});
eachJsFile(path.join(root, "mcp"), (filePath) => {
  new Function(fs.readFileSync(filePath, "utf8"));
});
console.log("Smoke check passed.");
