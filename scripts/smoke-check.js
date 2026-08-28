const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const requiredFiles = [
  "index.html",
  "src/app.js",
  "src/imagespec-zip.js",
  "src/imagespec-studio.js",
  "src/styles.css",
  "scripts/serve-open.js",
  "scripts/install-unity-tools.js",
  "scripts/check-unity-tools.js",
  "server/index.js",
  "server/app.js",
  "server/imagespec/access.js",
  "server/lib/common.js",
  "server/lib/http.js",
  "server/lib/process.js",
  "server/routes/index.js",
  "server/routes/rankings.routes.js",
  "server/routes/imagespec.routes.js",
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
  "mcp/tools/imagespec.js",
  "imagespec/protocol/index.js",
  "imagespec/core/index.js",
  "imagespec/runner/index.js",
  "imagespec/runner/external-adapters.js",
  "imagespec/validator/index.js",
  "imagespec/builder/index.js",
  "imagespec/cli/bin.js",
  "src/imagespec-studio.css",
  "src/imagespec-studio.js",
  "skills/imagespec-agent/SKILL.md",
  "skills/imagespec-agent/agents/openai.yaml",
  "skills/imagespec-agent/references/workflow.md",
  "README.md",
  "docs/API.md",
  "docs/MCP.md",
  "docs/PROJECT_STRUCTURE.md",
  "docs/IMAGESPEC.md",
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
const imageSpecStudioJs = fs.readFileSync(path.join(root, "src/imagespec-studio.js"), "utf8");
const imageSpecZipJs = fs.readFileSync(path.join(root, "src/imagespec-zip.js"), "utf8");
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
  "commandToolName",
  "commandToolTag",
  "commandFileState",
  "globalExportButton",
  "helpButton",
  "toolSearch",
  "recentToolList",
  "toolGroupNav",
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
  "downloadPixelJson",
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
  "imagespecPanel",
  "imagespecProjectName",
  "imagespecImageInput",
  "imagespecProjectInput",
  "imagespecExportPackage",
  "imagespecCanvas",
  "imagespecInspectorContent",
  "imagespecCompareInput",
  "imagespecUndo",
  "imagespecRedo",
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
  "/api/image/pixel-json",
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
  "/api/imagespec/project/create",
  "/api/imagespec/project/inspect",
  "/api/imagespec/project/read",
  "/api/imagespec/asset/find",
  "/api/imagespec/plan/create",
  "/api/imagespec/plan/list",
  "/api/imagespec/plan/preview",
  "/api/imagespec/plan/apply",
  "/api/imagespec/receipt/list",
  "/api/imagespec/file/read",
  "/api/imagespec/validate",
  "/api/imagespec/build",
  "/api/imagespec/export",
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
  "pixel_image_to_json",
  "extract_unity_apk",
  "imagespec_project_create",
  "imagespec_project_inspect",
  "imagespec_asset_find",
  "imagespec_capabilities",
  "imagespec_plan_create",
  "imagespec_plan_preview",
  "imagespec_plan_apply",
  "imagespec_validate",
  "imagespec_build",
  "imagespec_export",
]) {
  if (!mcpTree.includes(`"${tool}"`)) {
    throw new Error(`Missing MCP tool: ${tool}`);
  }
}

if (packageJson.scripts.mcp !== "node mcp/server.js") {
  throw new Error("Missing npm mcp script");
}

if (!html.includes('class="help-toggle"')) {
  throw new Error("Missing help buttons");
}

if (html.includes("返回说明")) {
  throw new Error("Old overview wording is still present");
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
  "pixelJsonImage",
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

for (const removedId of ["toolPrev", "toolNext", "toolOverview", "enterToolButton", "overviewTitle", "overviewDesc"]) {
  if (html.includes(`id="${removedId}"`) || html.includes(`id='${removedId}'`)) {
    throw new Error(`Removed workspace/overview element is still present: ${removedId}`);
  }
}

for (const removedToolNavCode of ["wheelDelta", "dragOffset", "layoutWheel", "tab-button", "tool-wheel", "wheel-window"]) {
  if (js.includes(removedToolNavCode) || html.includes(removedToolNavCode)) {
    throw new Error(`Removed wheel navigation code is still present: ${removedToolNavCode}`);
  }
}

for (const panelId of [
  "chromaPanel",
  "resizePanel",
  "interpolatePanel",
  "videoPanel",
  "batchPanel",
  "trimPanel",
  "pixelScalePanel",
  "truePixelPanel",
  "pixelEditorPanel",
  "sequencePanel",
  "atlasSlicePanel",
  "convertPanel",
  "atlasPackPanel",
  "unityApkPanel",
  "spriteFxPanel",
  "pipelinePanel",
  "audioPanel",
  "imagespecPanel",
]) {
  if (!html.includes(`id="${panelId}"`)) {
    throw new Error(`Missing tool panel: ${panelId}`);
  }
}

for (const primaryActionId of [
  "downloadChroma",
  "downloadResize",
  "generateInterpolate",
  "downloadAtlas",
  "processBatch",
  "downloadTrim",
  "downloadPixelScale",
  "downloadTruePixel",
  "downloadPixelEditor",
  "downloadSequenceAll",
  "applyAtlasSlice",
  "runConvert",
  "runAtlasPack",
  "runUnityApkExtract",
  "runSpriteFx",
  "runQualityReport",
  "runAudio",
  "imagespecExportPackage",
]) {
  if (!html.includes(`id="${primaryActionId}"`)) {
    throw new Error(`Primary action points to missing control: ${primaryActionId}`);
  }
}

for (const removedText of ["brand-mark", "status-pill", "statusText", "游戏素材工具台"]) {
  if (html.includes(removedText)) {
    throw new Error(`Removed header content is still present: ${removedText}`);
  }
}

new Function(js);
new Function(imageSpecZipJs);
new Function(imageSpecStudioJs);
eachJsFile(path.join(root, "server"), (filePath) => {
  new Function(fs.readFileSync(filePath, "utf8"));
});
eachJsFile(path.join(root, "mcp"), (filePath) => {
  new Function(fs.readFileSync(filePath, "utf8"));
});
console.log("Smoke check passed.");
