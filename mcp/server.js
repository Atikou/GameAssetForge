"use strict";

const fs = require("fs/promises");
const path = require("path");

const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StreamableHTTPServerTransport } = require("@modelcontextprotocol/sdk/server/streamableHttp.js");
const { createMcpExpressApp } = require("@modelcontextprotocol/sdk/server/express.js");
const { isInitializeRequest } = require("@modelcontextprotocol/sdk/types.js");
const JSZip = require("jszip");
const z = require("zod/v4");

const host = process.env.MCP_HOST || process.env.HOST || "127.0.0.1";
const port = Number(process.env.MCP_PORT || 5181);
const apiUrl = (process.env.GAF_API_URL || "http://127.0.0.1:5180").replace(/\/$/, "");
const outputRoot = path.resolve(process.env.GAF_OUTPUT_DIR || path.join(__dirname, "..", "outputs"));

function createServer() {
  const server = new McpServer({
    name: "game-asset-forge",
    version: "0.1.0",
  });

  registerTools(server);
  registerExtendedTools(server);
  return server;
}

function registerExtendedTools(server) {
  server.registerTool(
    "convert_image",
    {
      title: "图片格式转换",
      description: "把图片转为 PNG、WebP、JPG 或 AVIF，可设置质量和最长边。",
      inputSchema: {
        imagePath: z.string(),
        outputPath: z.string().optional(),
        outputDir: z.string().optional(),
        format: z.enum(["png", "webp", "jpeg", "avif"]).default("webp"),
        quality: z.number().min(1).max(100).default(82),
        maxSide: z.number().min(0).max(16384).default(0),
        background: z.string().default("#000000"),
      },
    },
    async (args) =>
      callSingleImageTool("/api/image/convert", args, `converted.${args.format === "jpeg" ? "jpg" : args.format}`, {
        format: args.format,
        quality: args.quality,
        maxSide: args.maxSide,
        background: args.background,
      }),
  );

  server.registerTool(
    "true_pixel_image",
    {
      title: "AI 伪像素转真像素",
      description: "把 AI 生成的柔边伪像素图重采样成真实像素网格，并输出硬边 PNG。",
      inputSchema: {
        imagePath: z.string(),
        outputPath: z.string().optional(),
        outputDir: z.string().optional(),
        cellSize: z.number().min(1).max(64).default(4),
        outputScale: z.number().min(1).max(32).default(4),
        colors: z.number().min(2).max(256).default(192),
        sharpen: z.number().min(0).max(100).default(25),
        sampleKernel: z.enum(["cubic", "nearest"]).default("cubic"),
        dither: z.number().min(0).max(1).default(0),
      },
    },
    async (args) =>
      callSingleImageTool("/api/image/true-pixel", args, "true-pixel.png", {
        cellSize: args.cellSize,
        outputScale: args.outputScale,
        colors: args.colors,
        sharpen: args.sharpen,
        sampleKernel: args.sampleKernel,
        dither: args.dither,
      }),
  );

  server.registerTool(
    "pixel_image_to_json",
    {
      title: "像素图转 JSON",
      description: "把像素图片导出为精简调色板索引 JSON，格式为 {w,h,c,p}，其中 c 是颜色表，p 是 [x,y,colorIndex]。",
      inputSchema: {
        imagePath: z.string(),
        outputPath: z.string().optional(),
        outputDir: z.string().optional(),
        includeTransparent: z.boolean().default(false),
      },
    },
    async (args) =>
      callSingleImageTool("/api/image/pixel-json", args, "pixel-image.json", {
        includeTransparent: args.includeTransparent,
      }),
  );

  server.registerTool(
    "pack_atlas_enhanced",
    {
      title: "增强图集打包",
      description: "打包 sprite 图集，支持 padding、extrude、裁透明边、2 的幂尺寸和引擎 manifest。",
      inputSchema: {
        framePaths: z.array(z.string()).min(1),
        outputPath: z.string().optional(),
        outputDir: z.string().optional(),
        padding: z.number().min(0).max(256).default(2),
        extrude: z.number().min(0).max(32).default(1),
        maxSize: z.number().min(64).max(16384).default(2048),
        trim: z.boolean().default(true),
        powerOfTwo: z.boolean().default(false),
        engine: z.enum(["generic", "unity", "godot", "cocos", "pixi"]).default("generic"),
      },
    },
    async (args) => {
      const outDir = await ensureOutputDir(args.outputDir);
      const outputPath = args.outputPath || path.join(outDir, "packed-atlas.zip");
      return callZipTool(
        "/api/atlas/pack",
        {
          padding: args.padding,
          extrude: args.extrude,
          maxSize: args.maxSize,
          trim: args.trim,
          powerOfTwo: args.powerOfTwo,
          engine: args.engine,
        },
        args.framePaths.map((filePath) => ({ field: "frames", path: filePath })),
        outputPath,
      );
    },
  );

  server.registerTool(
    "sprite_fx_image",
    {
      title: "Sprite 增强处理",
      description: "透明边缘修复、描边、投影、调色、调色板压色、法线图或遮罩图。",
      inputSchema: {
        imagePath: z.string(),
        outputPath: z.string().optional(),
        outputDir: z.string().optional(),
        operation: z.enum(["edge", "outline", "shadow", "palette", "color", "normal", "mask"]).default("edge"),
        color: z.string().default("#ffffff"),
        strength: z.number().min(0).max(64).default(2),
        colors: z.number().min(2).max(256).default(32),
        brightness: z.number().min(0).max(5).default(1),
        saturation: z.number().min(0).max(5).default(1),
        hue: z.number().min(-360).max(360).default(0),
      },
    },
    async (args) => {
      const endpoint =
        args.operation === "edge"
          ? "/api/image/edge-fix"
          : args.operation === "normal"
            ? "/api/image/normal-map"
            : args.operation === "mask"
              ? "/api/image/mask-map"
              : "/api/image/stylize";
      return callSingleImageTool(endpoint, args, `${args.operation}.png`, {
        operation: args.operation,
        color: args.color,
        thickness: args.strength,
        strength: args.strength,
        iterations: args.strength,
        colors: args.colors,
        brightness: args.brightness,
        saturation: args.saturation,
        hue: args.hue,
      });
    },
  );

  server.registerTool(
    "export_sequence_animation",
    {
      title: "序列帧导出动图",
      description: "把序列帧导出 GIF、WebP 或 MP4。",
      inputSchema: {
        framePaths: z.array(z.string()).min(1),
        outputPath: z.string().optional(),
        outputDir: z.string().optional(),
        fps: z.number().min(1).max(60).default(12),
        format: z.enum(["gif", "webp", "mp4"]).default("gif"),
      },
    },
    async (args) => {
      const outDir = await ensureOutputDir(args.outputDir);
      const outputPath = args.outputPath || path.join(outDir, `animation.${args.format}`);
      const result = await callApiMultipart(
        "/api/sequence/animation",
        { fps: args.fps, format: args.format },
        args.framePaths.map((filePath) => ({ field: "frames", path: filePath })),
      );
      return textResult({ ok: true, outputPath: await writeBuffer(result.buffer, outputPath), contentType: result.contentType });
    },
  );

  server.registerTool(
    "nine_slice_image",
    {
      title: "九宫格切片",
      description: "导出九宫格切片 ZIP 和 nine-slice.json。",
      inputSchema: {
        imagePath: z.string(),
        outputPath: z.string().optional(),
        outputDir: z.string().optional(),
        left: z.number().min(0).default(16),
        right: z.number().min(0).default(16),
        top: z.number().min(0).default(16),
        bottom: z.number().min(0).default(16),
      },
    },
    async (args) => {
      const outDir = await ensureOutputDir(args.outputDir);
      const outputPath = args.outputPath || path.join(outDir, "nine-slice.zip");
      return callZipTool(
        "/api/ui/nine-slice",
        { left: args.left, right: args.right, top: args.top, bottom: args.bottom },
        [{ field: "image", path: args.imagePath }],
        outputPath,
      );
    },
  );

  server.registerTool(
    "slice_tileset",
    {
      title: "Tileset 切片",
      description: "按 tile 宽高切 tileset，可去重并导出 tileset.json。",
      inputSchema: {
        imagePath: z.string(),
        outputPath: z.string().optional(),
        outputDir: z.string().optional(),
        tileWidth: z.number().min(1).default(16),
        tileHeight: z.number().min(1).default(16),
        marginX: z.number().min(0).default(0),
        marginY: z.number().min(0).default(0),
        gapX: z.number().min(0).default(0),
        gapY: z.number().min(0).default(0),
        dedupe: z.boolean().default(true),
      },
    },
    async (args) => {
      const outDir = await ensureOutputDir(args.outputDir);
      const outputPath = args.outputPath || path.join(outDir, "tileset.zip");
      return callZipTool(
        "/api/tileset/slice",
        {
          tileWidth: args.tileWidth,
          tileHeight: args.tileHeight,
          marginX: args.marginX,
          marginY: args.marginY,
          gapX: args.gapX,
          gapY: args.gapY,
          dedupe: args.dedupe,
        },
        [{ field: "image", path: args.imagePath }],
        outputPath,
      );
    },
  );

  server.registerTool(
    "quality_report_images",
    {
      title: "素材质检报告",
      description: "检查尺寸、透明通道、空白帧、2 的幂尺寸和大图风险。",
      inputSchema: {
        imagePaths: z.array(z.string()).min(1),
      },
    },
    async (args) => {
      const result = await callApiMultipart(
        "/api/quality/report",
        {},
        args.imagePaths.map((filePath) => ({ field: "images", path: filePath })),
      );
      return textResult(JSON.parse(result.buffer.toString("utf8")));
    },
  );

  server.registerTool(
    "batch_color_adjust",
    {
      title: "批量调色",
      description: "批量调整亮度、饱和度和色相，输出 ZIP。",
      inputSchema: {
        imagePaths: z.array(z.string()).min(1),
        outputPath: z.string().optional(),
        outputDir: z.string().optional(),
        brightness: z.number().min(0).max(5).default(1),
        saturation: z.number().min(0).max(5).default(1),
        hue: z.number().min(-360).max(360).default(0),
      },
    },
    async (args) => {
      const outDir = await ensureOutputDir(args.outputDir);
      const outputPath = args.outputPath || path.join(outDir, "batch-color.zip");
      return callZipTool(
        "/api/batch/color",
        { brightness: args.brightness, saturation: args.saturation, hue: args.hue },
        args.imagePaths.map((filePath) => ({ field: "images", path: filePath })),
        outputPath,
      );
    },
  );

  server.registerTool(
    "process_audio",
    {
      title: "音频转码与标准化",
      description: "转码游戏音频，或做响度标准化。",
      inputSchema: {
        audioPath: z.string(),
        outputPath: z.string().optional(),
        outputDir: z.string().optional(),
        operation: z.enum(["convert", "normalize"]).default("convert"),
        format: z.enum(["ogg", "mp3", "wav", "m4a"]).default("ogg"),
        bitrate: z.string().default("160k"),
      },
    },
    async (args) => {
      const outDir = await ensureOutputDir(args.outputDir);
      const outputPath = args.outputPath || path.join(outDir, `audio.${args.format}`);
      const result = await callApiMultipart(
        "/api/audio/process",
        { operation: args.operation, format: args.format, bitrate: args.bitrate },
        [{ field: "audio", path: args.audioPath }],
      );
      return textResult({ ok: true, outputPath: await writeBuffer(result.buffer, outputPath), contentType: result.contentType });
    },
  );

  server.registerTool(
    "extract_unity_apk",
    {
      title: "Unity APK 工程还原 / 资源提取",
      description: "导入 Unity Android APK，扫描 Unity 资源结构，导出原始资源 ZIP，或通过命令模板调用 AssetRipper、AssetStudio、UnityPy、Cpp2IL。",
      inputSchema: {
        apkPath: z.string(),
        outputPath: z.string().optional(),
        outputDir: z.string().optional(),
        mode: z.enum(["project", "assets", "raw", "code"]).default("assets"),
        runMode: z.enum(["quick", "expert"]).default("quick"),
        tool: z.enum(["auto", "assetripper", "assetstudio", "unitypy", "cpp2il", "raw"]).default("auto"),
        commandTemplate: z.string().optional(),
        toolArgs: z.string().optional(),
        assetTypes: z.string().default("texture,audio,mesh,text"),
        includeRaw: z.boolean().default(true),
        timeoutMs: z.number().min(10000).max(1800000).default(600000),
      },
    },
    async (args) => {
      const outDir = await ensureOutputDir(args.outputDir);
      const outputPath = args.outputPath || path.join(outDir, "unity-apk-extract.zip");
      return callZipTool(
        "/api/unity/apk-extract",
        {
          mode: args.mode,
          runMode: args.runMode,
          tool: args.tool,
          commandTemplate: args.commandTemplate,
          toolArgs: args.toolArgs,
          assetTypes: args.assetTypes,
          includeRaw: args.includeRaw,
          timeoutMs: args.timeoutMs,
        },
        [{ field: "apk", path: args.apkPath }],
        outputPath,
      );
    },
  );
}

function textResult(data) {
  return {
    content: [
      {
        type: "text",
        text: typeof data === "string" ? data : JSON.stringify(data, null, 2),
      },
    ],
  };
}

function normalizePath(filePath) {
  if (!filePath || typeof filePath !== "string") {
    throw new Error("Missing file path.");
  }
  return path.resolve(filePath);
}

function safeName(name, fallback = "asset") {
  return String(name || fallback).replace(/[<>:"/\\|?*\x00-\x1f]/g, "_");
}

async function ensureOutputDir(dir) {
  const resolved = path.resolve(dir || outputRoot);
  await fs.mkdir(resolved, { recursive: true });
  return resolved;
}

async function createMultipart(fields, fileFields) {
  const boundary = `----GameAssetForgeMcp${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
  const chunks = [];
  const push = (value) => chunks.push(Buffer.isBuffer(value) ? value : Buffer.from(String(value)));

  for (const [name, value] of Object.entries(fields || {})) {
    if (value === undefined || value === null) continue;
    push(`--${boundary}\r\n`);
    push(`Content-Disposition: form-data; name="${name}"\r\n\r\n`);
    push(value);
    push("\r\n");
  }

  for (const file of fileFields) {
    const filePath = normalizePath(file.path);
    const buffer = await fs.readFile(filePath);
    const filename = safeName(file.filename || path.basename(filePath));
    push(`--${boundary}\r\n`);
    push(`Content-Disposition: form-data; name="${file.field}"; filename="${filename}"\r\n`);
    push(`Content-Type: ${file.contentType || "application/octet-stream"}\r\n\r\n`);
    push(buffer);
    push("\r\n");
  }

  push(`--${boundary}--\r\n`);
  return {
    body: Buffer.concat(chunks),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

async function callApiMultipart(endpoint, fields, fileFields) {
  const { body, contentType } = await createMultipart(fields, fileFields);
  const response = await fetch(`${apiUrl}${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(body.length),
    },
    body,
  });
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!response.ok) {
    throw new Error(`API ${endpoint} failed: ${response.status} ${buffer.toString("utf8")}`);
  }
  return {
    buffer,
    contentType: response.headers.get("content-type") || "application/octet-stream",
    metadataHeader: response.headers.get("x-gameassetforge-metadata"),
  };
}

function decodeMetadata(header) {
  if (!header) return null;
  try {
    return JSON.parse(Buffer.from(header, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

async function writeBuffer(buffer, outputPath) {
  const resolved = path.resolve(outputPath);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(resolved, buffer);
  return resolved;
}

async function summarizeZip(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const names = Object.keys(zip.files).filter((name) => !zip.files[name].dir);
  let manifest = null;
  const manifestFile = zip.file("manifest.json") || zip.file("atlas.json");
  if (manifestFile) {
    manifest = JSON.parse(await manifestFile.async("string"));
  }
  return {
    files: names,
    manifest,
  };
}

async function callSingleImageTool(endpoint, args, defaultName, fields = {}) {
  const outDir = await ensureOutputDir(args.outputDir);
  const outputPath = args.outputPath || path.join(outDir, defaultName);
  const result = await callApiMultipart(endpoint, fields, [{ field: "image", path: args.imagePath }]);
  const savedPath = await writeBuffer(result.buffer, outputPath);
  return textResult({
    ok: true,
    outputPath: savedPath,
    contentType: result.contentType,
    metadata: decodeMetadata(result.metadataHeader),
  });
}

async function callZipTool(endpoint, fields, files, outputPath) {
  const result = await callApiMultipart(endpoint, fields, files);
  const savedPath = await writeBuffer(result.buffer, outputPath);
  const summary = await summarizeZip(result.buffer);
  return textResult({
    ok: true,
    outputPath: savedPath,
    contentType: result.contentType,
    ...summary,
  });
}

function registerTools(server) {
  server.registerTool(
    "health_check",
    {
      title: "GameAssetForge 健康检查",
      description: "检查 GameAssetForge HTTP API 是否可用。",
      inputSchema: {},
    },
    async () => {
      const response = await fetch(`${apiUrl}/api/health`);
      return textResult(await response.json());
    },
  );

  server.registerTool(
    "chroma_key_image",
    {
      title: "图片抠背景",
      description: "扣掉图片中的绿幕、品红、蓝色或自定义纯色背景，输出透明 PNG。",
      inputSchema: {
        imagePath: z.string().describe("输入图片的本地路径"),
        outputPath: z.string().optional().describe("输出 PNG 路径"),
        outputDir: z.string().optional().describe("未提供 outputPath 时使用的输出目录"),
        preset: z.enum(["green", "magenta", "blue", "custom", "auto"]).default("green"),
        color: z.string().default("#00ff00"),
        tolerance: z.number().min(0).max(441).default(72),
        softness: z.number().min(0).max(441).default(18),
        spill: z.number().min(0).max(100).default(85),
        edgeCleanup: z.number().min(0).max(100).default(18),
        matting: z.boolean().default(true),
        mattingRadius: z.number().min(1).max(32).default(4),
        mattingStrength: z.number().min(0).max(100).default(70),
      },
    },
    async (args) =>
      callSingleImageTool("/api/image/chroma-key", args, "chroma-key-result.png", {
        preset: args.preset,
        color: args.color,
        tolerance: args.tolerance,
        softness: args.softness,
        spill: args.spill,
        edgeCleanup: args.edgeCleanup,
        matting: args.matting,
        mattingRadius: args.mattingRadius,
        mattingStrength: args.mattingStrength,
      }),
  );

  server.registerTool(
    "resize_image",
    {
      title: "图片改分辨率",
      description: "按指定宽高、比例或最长边调整图片尺寸，输出 PNG。",
      inputSchema: {
        imagePath: z.string(),
        outputPath: z.string().optional(),
        outputDir: z.string().optional(),
        mode: z.enum(["exact", "scale", "maxSide"]).default("exact"),
        width: z.number().min(1).max(16384).optional(),
        height: z.number().min(1).max(16384).optional(),
        scale: z.number().min(1).max(1000).optional(),
        maxSide: z.number().min(1).max(16384).optional(),
      },
    },
    async (args) =>
      callSingleImageTool("/api/image/resize", args, "resized-image.png", {
        mode: args.mode,
        width: args.width,
        height: args.height,
        scale: args.scale,
        maxSide: args.maxSide,
      }),
  );

  server.registerTool(
    "trim_transparent_edges",
    {
      title: "自动裁透明边",
      description: "裁掉透明 PNG 四周空白区域，返回输出图和 offset 元数据。",
      inputSchema: {
        imagePath: z.string(),
        outputPath: z.string().optional(),
        outputDir: z.string().optional(),
        alphaThreshold: z.number().min(0).max(255).default(8),
        padding: z.number().min(0).max(4096).default(0),
      },
    },
    async (args) =>
      callSingleImageTool("/api/image/trim-transparent", args, "trimmed-image.png", {
        alphaThreshold: args.alphaThreshold,
        padding: args.padding,
      }),
  );

  server.registerTool(
    "pixel_scale_image",
    {
      title: "像素风缩放",
      description: "使用最近邻算法放大或缩小像素素材。",
      inputSchema: {
        imagePath: z.string(),
        outputPath: z.string().optional(),
        outputDir: z.string().optional(),
        factor: z.number().min(0.1).max(16).default(2),
      },
    },
    async (args) =>
      callSingleImageTool("/api/image/pixel-scale", args, "pixel-scaled-image.png", {
        factor: args.factor,
      }),
  );

  server.registerTool(
    "interpolate_images",
    {
      title: "图片插帧",
      description: "输入前后两帧，生成一张中间过渡帧 PNG。",
      inputSchema: {
        frameAPath: z.string(),
        frameBPath: z.string(),
        outputPath: z.string().optional(),
        outputDir: z.string().optional(),
        t: z.number().min(0).max(1).default(0.5),
        mode: z.enum(["alphaBlend", "nearest"]).default("alphaBlend"),
      },
    },
    async (args) => {
      const outDir = await ensureOutputDir(args.outputDir);
      const outputPath = args.outputPath || path.join(outDir, "interpolated-frame.png");
      const result = await callApiMultipart(
        "/api/image/interpolate",
        { t: args.t, mode: args.mode },
        [
          { field: "frameA", path: args.frameAPath },
          { field: "frameB", path: args.frameBPath },
        ],
      );
      return textResult({
        ok: true,
        outputPath: await writeBuffer(result.buffer, outputPath),
        contentType: result.contentType,
      });
    },
  );

  server.registerTool(
    "build_atlas",
    {
      title: "多图合成图集",
      description: "把多张帧图合成 atlas.zip，包含 atlas.png 和 atlas.json。",
      inputSchema: {
        framePaths: z.array(z.string()).min(1),
        outputPath: z.string().optional(),
        outputDir: z.string().optional(),
        columns: z.number().min(1).optional(),
      },
    },
    async (args) => {
      const outDir = await ensureOutputDir(args.outputDir);
      const outputPath = args.outputPath || path.join(outDir, "atlas.zip");
      return callZipTool(
        "/api/atlas",
        { columns: args.columns },
        args.framePaths.map((filePath) => ({ field: "frames", path: filePath })),
        outputPath,
      );
    },
  );

  server.registerTool(
    "batch_process_images",
    {
      title: "批量处理图片",
      description: "批量裁透明边、像素缩放、扣背景或真像素化，输出 ZIP 和 manifest.json。",
      inputSchema: {
        imagePaths: z.array(z.string()).min(1),
        outputPath: z.string().optional(),
        outputDir: z.string().optional(),
        operation: z.enum(["trim", "pixelScale", "chromaKey", "truePixel"]).default("trim"),
        alphaThreshold: z.number().min(0).max(255).default(8),
        padding: z.number().min(0).max(4096).default(0),
        factor: z.number().min(0.1).max(16).default(2),
        color: z.string().default("#00ff00"),
        preset: z.string().optional(),
        tolerance: z.number().min(0).max(441).default(72),
        softness: z.number().min(0).max(441).default(18),
        spill: z.number().min(0).max(100).default(85),
        edgeCleanup: z.number().min(0).max(100).default(18),
        mattingStrength: z.number().min(0).max(100).default(70),
        mattingRadius: z.number().min(1).max(32).default(4),
        cellSize: z.number().min(1).max(64).default(4),
        outputScale: z.number().min(1).max(32).default(4),
        colors: z.number().min(2).max(256).default(192),
        sharpen: z.number().min(0).max(100).default(25),
        sampleKernel: z.enum(["cubic", "nearest"]).default("cubic"),
        dither: z.number().min(0).max(1).default(0),
      },
    },
    async (args) => {
      const outDir = await ensureOutputDir(args.outputDir);
      const outputPath = args.outputPath || path.join(outDir, "batch-results.zip");
      return callZipTool(
        "/api/batch/process",
        {
          operation: args.operation,
          alphaThreshold: args.alphaThreshold,
          padding: args.padding,
          factor: args.factor,
          color: args.color,
          preset: args.preset,
          tolerance: args.tolerance,
          softness: args.softness,
          spill: args.spill,
          edgeCleanup: args.edgeCleanup,
          mattingStrength: args.mattingStrength,
          mattingRadius: args.mattingRadius,
          cellSize: args.cellSize,
          outputScale: args.outputScale,
          colors: args.colors,
          sharpen: args.sharpen,
          sampleKernel: args.sampleKernel,
          dither: args.dither,
        },
        args.imagePaths.map((filePath) => ({ field: "images", path: filePath })),
        outputPath,
      );
    },
  );

  server.registerTool(
    "rename_sequence",
    {
      title: "序列帧重命名",
      description: "对序列帧按自然排序、反序或原顺序重命名，输出 ZIP 和 manifest.json。",
      inputSchema: {
        framePaths: z.array(z.string()).min(1),
        outputPath: z.string().optional(),
        outputDir: z.string().optional(),
        sort: z.enum(["natural", "reverse", "mtime"]).default("natural"),
        prefix: z.string().default("frame"),
        start: z.number().min(0).default(0),
        padding: z.number().min(1).max(8).default(4),
        format: z.enum(["original", "png"]).default("original"),
      },
    },
    async (args) => {
      const outDir = await ensureOutputDir(args.outputDir);
      const outputPath = args.outputPath || path.join(outDir, "renamed-sequence.zip");
      return callZipTool(
        "/api/sequence/rename",
        {
          sort: args.sort,
          prefix: args.prefix,
          start: args.start,
          padding: args.padding,
          format: args.format,
        },
        args.framePaths.map((filePath) => ({ field: "frames", path: filePath })),
        outputPath,
      );
    },
  );

  server.registerTool(
    "slice_atlas",
    {
      title: "图集切割",
      description: "按行列、格子尺寸、边距和间隔切割未知图集，输出 ZIP 和 manifest.json。",
      inputSchema: {
        imagePath: z.string(),
        outputPath: z.string().optional(),
        outputDir: z.string().optional(),
        columns: z.number().min(1).default(1),
        rows: z.number().min(1).default(1),
        cellWidth: z.number().min(1).optional(),
        cellHeight: z.number().min(1).optional(),
        marginX: z.number().min(0).default(0),
        marginY: z.number().min(0).default(0),
        gapX: z.number().min(0).default(0),
        gapY: z.number().min(0).default(0),
        prefix: z.string().default("slice"),
      },
    },
    async (args) => {
      const outDir = await ensureOutputDir(args.outputDir);
      const outputPath = args.outputPath || path.join(outDir, "atlas-slices.zip");
      return callZipTool(
        "/api/atlas/slice",
        {
          columns: args.columns,
          rows: args.rows,
          cellWidth: args.cellWidth,
          cellHeight: args.cellHeight,
          marginX: args.marginX,
          marginY: args.marginY,
          gapX: args.gapX,
          gapY: args.gapY,
          prefix: args.prefix,
        },
        [{ field: "image", path: args.imagePath }],
        outputPath,
      );
    },
  );

  server.registerTool(
    "auto_slice_atlas",
    {
      title: "自动识别图集切割",
      description: "自动识别透明背景、纯色背景或规则网格图集，输出切片 ZIP 和 manifest.json。",
      inputSchema: {
        imagePath: z.string(),
        outputPath: z.string().optional(),
        outputDir: z.string().optional(),
        mode: z.enum(["auto", "alpha", "solid", "grid"]).default("auto"),
        threshold: z.number().min(0).max(255).default(16),
        minArea: z.number().min(1).default(8),
        padding: z.number().min(0).max(4096).default(0),
        prefix: z.string().default("slice"),
      },
    },
    async (args) => {
      const outDir = await ensureOutputDir(args.outputDir);
      const outputPath = args.outputPath || path.join(outDir, "atlas-auto-slices.zip");
      return callZipTool(
        "/api/atlas/auto-slice",
        {
          mode: args.mode,
          threshold: args.threshold,
          minArea: args.minArea,
          padding: args.padding,
          prefix: args.prefix,
        },
        [{ field: "image", path: args.imagePath }],
        outputPath,
      );
    },
  );

  server.registerTool(
    "slice_atlas_boxes",
    {
      title: "按自定义框切割图集",
      description: "按一组 {x,y,w,h} 自定义切割框切割图集，适合复用前端手动调整后的框数据。",
      inputSchema: {
        imagePath: z.string(),
        outputPath: z.string().optional(),
        outputDir: z.string().optional(),
        prefix: z.string().default("slice"),
        boxes: z
          .array(
            z.object({
              x: z.number().min(0),
              y: z.number().min(0),
              w: z.number().min(1).optional(),
              h: z.number().min(1).optional(),
              width: z.number().min(1).optional(),
              height: z.number().min(1).optional(),
              name: z.string().optional(),
            }),
          )
          .min(1),
      },
    },
    async (args) => {
      const outDir = await ensureOutputDir(args.outputDir);
      const outputPath = args.outputPath || path.join(outDir, "atlas-box-slices.zip");
      return callZipTool(
        "/api/atlas/slice-boxes",
        {
          prefix: args.prefix,
          boxes: JSON.stringify(args.boxes),
        },
        [{ field: "image", path: args.imagePath }],
        outputPath,
      );
    },
  );

  server.registerTool(
    "extract_video_frames",
    {
      title: "视频抽帧",
      description: "把视频按间隔抽成 PNG 序列，输出 ZIP 和 manifest.json。",
      inputSchema: {
        videoPath: z.string(),
        outputPath: z.string().optional(),
        outputDir: z.string().optional(),
        interval: z.number().min(0.05).max(60).default(0.5),
        maxFrames: z.number().min(1).max(2000).default(240),
      },
    },
    async (args) => {
      const outDir = await ensureOutputDir(args.outputDir);
      const outputPath = args.outputPath || path.join(outDir, "video-frames.zip");
      return callZipTool(
        "/api/video/extract-frames",
        { interval: args.interval, maxFrames: args.maxFrames },
        [{ field: "video", path: args.videoPath }],
        outputPath,
      );
    },
  );

  server.registerTool(
    "chroma_key_video",
    {
      title: "视频抠背景",
      description: "视频抽帧后逐帧抠背景，输出透明 PNG 序列 ZIP。",
      inputSchema: {
        videoPath: z.string(),
        outputPath: z.string().optional(),
        outputDir: z.string().optional(),
        interval: z.number().min(0.05).max(60).default(0.5),
        maxFrames: z.number().min(1).max(2000).default(240),
        preset: z.enum(["green", "magenta", "blue", "custom", "auto"]).default("green"),
        color: z.string().default("#00ff00"),
        tolerance: z.number().min(0).max(441).default(72),
        softness: z.number().min(0).max(441).default(18),
        spill: z.number().min(0).max(100).default(85),
        edgeCleanup: z.number().min(0).max(100).default(18),
        matting: z.boolean().default(true),
        mattingRadius: z.number().min(1).max(32).default(4),
        mattingStrength: z.number().min(0).max(100).default(70),
      },
    },
    async (args) => {
      const outDir = await ensureOutputDir(args.outputDir);
      const outputPath = args.outputPath || path.join(outDir, "video-transparent-frames.zip");
      return callZipTool(
        "/api/video/chroma-key",
        {
          interval: args.interval,
          maxFrames: args.maxFrames,
          preset: args.preset,
          color: args.color,
          tolerance: args.tolerance,
          softness: args.softness,
          spill: args.spill,
          edgeCleanup: args.edgeCleanup,
          matting: args.matting,
          mattingRadius: args.mattingRadius,
          mattingStrength: args.mattingStrength,
        },
        [{ field: "video", path: args.videoPath }],
        outputPath,
      );
    },
  );
}

const app = createMcpExpressApp();

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    name: "GameAssetForge MCP",
    apiUrl,
    mcpUrl: `http://${host}:${port}/mcp`,
  });
});

app.post("/mcp", async (req, res) => {
  const server = createServer();
  try {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
    res.on("close", () => {
      transport.close();
      server.close();
    });
  } catch (error) {
    console.error("Error handling MCP request:", error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: error.message || "Internal server error",
        },
        id: null,
      });
    }
  }
});

app.get("/mcp", (req, res) => {
  res.writeHead(405).end(
    JSON.stringify({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Method not allowed.",
      },
      id: null,
    }),
  );
});

app.delete("/mcp", (req, res) => {
  res.writeHead(405).end(
    JSON.stringify({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Method not allowed.",
      },
      id: null,
    }),
  );
});

const httpServer = app.listen(port, host, (error) => {
  if (error) {
    console.error("Failed to start MCP server:", error);
    process.exit(1);
  }
  console.log(`GameAssetForge MCP started: http://${host}:${port}/mcp`);
  console.log(`Using GameAssetForge API: ${apiUrl}`);
});

function shutdown() {
  httpServer.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
