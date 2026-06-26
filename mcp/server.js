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
  return server;
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
        preset: z.enum(["green", "magenta", "blue", "custom"]).default("green"),
        color: z.string().default("#00ff00"),
        tolerance: z.number().min(0).max(441).default(72),
        softness: z.number().min(0).max(441).default(18),
      },
    },
    async (args) =>
      callSingleImageTool("/api/image/chroma-key", args, "chroma-key-result.png", {
        preset: args.preset,
        color: args.color,
        tolerance: args.tolerance,
        softness: args.softness,
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
      description: "批量裁透明边或像素缩放，输出 ZIP 和 manifest.json。",
      inputSchema: {
        imagePaths: z.array(z.string()).min(1),
        outputPath: z.string().optional(),
        outputDir: z.string().optional(),
        operation: z.enum(["trim", "pixelScale"]).default("trim"),
        alphaThreshold: z.number().min(0).max(255).default(8),
        padding: z.number().min(0).max(4096).default(0),
        factor: z.number().min(0.1).max(16).default(2),
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
        preset: z.enum(["green", "magenta", "blue", "custom"]).default("green"),
        color: z.string().default("#00ff00"),
        tolerance: z.number().min(0).max(441).default(72),
        softness: z.number().min(0).max(441).default(18),
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
