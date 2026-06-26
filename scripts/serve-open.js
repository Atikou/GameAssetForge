"use strict";

const fs = require("fs");
const http = require("http");
const path = require("path");
const { exec, spawn } = require("child_process");

const root = path.resolve(__dirname, "..");
const host = process.env.HOST || "127.0.0.1";
const webPort = Number(process.env.WEB_PORT || process.env.PORT || 5173);
const apiPort = Number(process.env.API_PORT || 5180);
const mcpPort = Number(process.env.MCP_PORT || 5181);
const url = `http://${host}:${webPort}/`;
const apiUrl = `http://${host}:${apiPort}`;
const mcpUrl = `http://${host}:${mcpPort}/mcp`;
const children = [];
let shuttingDown = false;

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

function openBrowser(targetUrl) {
  const escapedUrl = targetUrl.replace(/"/g, "");
  if (process.platform === "win32") {
    exec(`start "" "${escapedUrl}"`, { shell: "cmd.exe" });
    return;
  }
  if (process.platform === "darwin") {
    exec(`open "${escapedUrl}"`);
    return;
  }
  exec(`xdg-open "${escapedUrl}"`);
}

function send(res, statusCode, body, contentType = "text/plain; charset=utf-8") {
  res.writeHead(statusCode, {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function prefixOutput(child, label) {
  child.stdout.on("data", (chunk) => {
    process.stdout.write(`[${label}] ${chunk}`);
  });
  child.stderr.on("data", (chunk) => {
    process.stderr.write(`[${label}] ${chunk}`);
  });
}

function spawnManaged(label, script, env) {
  const child = spawn(process.execPath, [script], {
    cwd: root,
    env: {
      ...process.env,
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  child.label = label;
  children.push(child);
  prefixOutput(child, label);
  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    if (code === 0 || signal) return;
    console.error(`[${label}] exited with code ${code}.`);
    shutdown(1);
  });
  return child;
}

function requestJson(targetUrl, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const request = http.get(targetUrl, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`${targetUrl} returned ${res.statusCode}: ${body}`));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
    });
    request.on("error", reject);
    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error(`Timed out waiting for ${targetUrl}`));
    });
  });
}

async function waitForHealth(targetUrl, label) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < 12000) {
    try {
      return await requestJson(targetUrl, 1500);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
  }
  throw new Error(`${label} did not become ready: ${lastError?.message || "unknown error"}`);
}

const server = http.createServer((req, res) => {
  const requestUrl = new URL(req.url, url);
  const decodedPath = decodeURIComponent(requestUrl.pathname);
  const relativePath = decodedPath === "/" ? "index.html" : decodedPath.slice(1);
  const filePath = path.resolve(root, relativePath);

  if (!filePath.startsWith(root)) {
    send(res, 403, "Forbidden");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      send(res, 404, "Not found");
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    send(res, 200, data, mimeTypes[ext] || "application/octet-stream");
  });
});

function closeWebServer() {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

async function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill();
  }
  await closeWebServer();
  process.exit(exitCode);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
process.on("uncaughtException", (error) => {
  console.error(error);
  shutdown(1);
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`端口 ${webPort} 已被占用，请先关闭旧服务，或使用 WEB_PORT=其它端口 npm run serve。`);
    shutdown(1);
    return;
  }
  throw error;
});

server.listen(webPort, host, async () => {
  try {
    spawnManaged("api", path.join("server", "index.js"), {
      PORT: String(apiPort),
      HOST: host,
    });
    await waitForHealth(`${apiUrl}/api/health`, "API");

    spawnManaged("mcp", path.join("mcp", "server.js"), {
      MCP_PORT: String(mcpPort),
      MCP_HOST: host,
      GAF_API_URL: apiUrl,
    });
    await waitForHealth(`http://${host}:${mcpPort}/health`, "MCP");

    console.log(`GameAssetForge 网页已启动：${url}`);
    console.log(`GameAssetForge API：${apiUrl}`);
    console.log(`GameAssetForge MCP：${mcpUrl}`);
    console.log("按 Ctrl+C 会同时关闭网页、API 和 MCP。");
    openBrowser(url);
  } catch (error) {
    console.error(error.message);
    shutdown(1);
  }
});
