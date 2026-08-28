"use strict";

const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");

const { createApp } = require("../../server/app");
const { ImageSpecService } = require("../../imagespec/core");
const { registerImageSpecTools } = require("../../mcp/tools/imagespec");

async function temporaryRoot(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "gameassetforge-transport-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

async function startApp(t, root) {
  const app = createApp({ imagespecAccessOptions: { roots: [root] } });
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
}

async function jsonRequest(baseUrl, route, body) {
  const response = await fetch(`${baseUrl}${route}`, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

test("HTTP ImageSpec routes create and inspect projects within configured roots", async (t) => {
  const root = await temporaryRoot(t);
  const baseUrl = await startApp(t, root);
  const projectPath = path.join(root, "http.project.imagespec");
  const capabilities = await jsonRequest(baseUrl, "/api/imagespec/capabilities");
  assert.equal(capabilities.status, 200);
  assert.ok(capabilities.body.capabilities.some((entry) => entry.id === "image.resize"));

  const created = await jsonRequest(baseUrl, "/api/imagespec/project/create", {
    projectPath,
    name: "HTTP project",
    width: 80,
    height: 120,
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.revision.number, 0);
  const inspected = await jsonRequest(baseUrl, "/api/imagespec/project/inspect", { projectPath });
  assert.equal(inspected.status, 200);
  assert.equal(inspected.body.name, "HTTP project");
  const schema = await jsonRequest(baseUrl, "/api/imagespec/schema/project");
  assert.equal(schema.status, 200);
  assert.equal(schema.body.title, "ImageSpec ProjectSpec 2.0");
});

test("HTTP ImageSpec routes reject project paths outside configured roots", async (t) => {
  const root = await temporaryRoot(t);
  const outside = await temporaryRoot(t);
  const baseUrl = await startApp(t, root);
  const response = await jsonRequest(baseUrl, "/api/imagespec/project/create", {
    projectPath: path.join(outside, "denied.project.imagespec"),
    name: "Denied",
  });
  assert.equal(response.status, 403);
  assert.equal(response.body.error.code, "IMAGESPEC_PROJECT_ROOT_DENIED");
});

test("MCP ImageSpec tools are thin wrappers over the shared service", async (t) => {
  const root = await temporaryRoot(t);
  const projectPath = path.join(root, "mcp.project.imagespec");
  const service = new ImageSpecService();
  const registered = new Map();
  const server = {
    registerTool(name, definition, handler) {
      registered.set(name, { definition, handler });
    },
  };
  registerImageSpecTools(server, { service });
  assert.ok(registered.has("imagespec_plan_apply"));
  assert.ok(registered.has("imagespec_build"));
  const created = await registered.get("imagespec_project_create").handler({
    projectPath,
    name: "MCP project",
    width: 32,
    height: 32,
    description: "",
  });
  assert.equal(created.structuredContent.revision.number, 0);
  const inspected = await registered.get("imagespec_project_inspect").handler({ projectPath });
  assert.equal(inspected.structuredContent.projectId, "mcp.project");
  const capabilities = await registered.get("imagespec_capabilities").handler({});
  assert.ok(capabilities.structuredContent.capabilities.length >= 10);
});
