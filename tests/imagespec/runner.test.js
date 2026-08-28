"use strict";

const path = require("path");
const fs = require("fs/promises");
const os = require("os");
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  CapabilityRegistry,
  createExternalCapability,
  discoverHttpRunnerCapabilities,
  loadExternalRunnerDefinitions,
  registerExternalRunnerCapabilities,
} = require("../../imagespec/runner");

const fixture = path.join(__dirname, "fixtures", "external-runner-copy.js");

function commandDefinition(overrides = {}) {
  return {
    id: "external.copy",
    version: "test-1",
    deterministic: true,
    requiresApproval: true,
    outputExtension: "bin",
    outputMimeType: "application/octet-stream",
    transport: {
      type: "command",
      command: process.execPath,
      args: [fixture, "{input}", "{output}", "{request}", "0"],
      outputExtension: "bin",
      timeoutMs: 5000,
    },
    ...overrides,
  };
}

test("command Runner adapter executes without a shell and returns negotiated provenance", async () => {
  const registry = registerExternalRunnerCapabilities(new CapabilityRegistry(), [commandDefinition()]);
  const sourceBuffer = Buffer.from("external-runner-contract");
  const result = await registry.execute("external.copy", {
    project: { projectId: "project.runner" },
    asset: { id: "asset.runner", source: { mimeType: "application/octet-stream" } },
    sourceBuffer,
    params: { mode: "copy" },
  });
  assert.deepEqual(result.output, sourceBuffer);
  assert.deepEqual(result.capability, { id: "external.copy", version: "test-1" });
  assert.equal(registry.list()[0].transport.type, "command");
});

test("command Runner adapter supports cancellation", async () => {
  const controller = new AbortController();
  const capability = createExternalCapability(commandDefinition({
    id: "external.cancel",
    transport: { type: "command", command: process.execPath, args: [fixture, "{input}", "{output}", "{request}", "5000"], outputExtension: "bin", timeoutMs: 10000 },
  }));
  const pending = capability.execute({ sourceBuffer: Buffer.from("cancel"), params: {}, signal: controller.signal });
  setTimeout(() => controller.abort(), 25);
  await assert.rejects(pending, (error) => error.code === "IMAGESPEC_RUNNER_CANCELLED");
});

test("HTTP Runner adapter accepts binary responses and discovery resolves relative endpoints", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith("/capabilities")) {
      return new Response(JSON.stringify({ capabilities: [{ id: "external.http", endpoint: "run", outputExtension: "png" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(Buffer.from("binary-result"), { status: 200, headers: { "content-type": "image/png", "x-imagespec-extension": "png" } });
  };
  const definitions = await discoverHttpRunnerCapabilities("https://runner.example/capabilities", { fetchImpl });
  assert.equal(definitions[0].transport.endpoint, "https://runner.example/run");
  const capability = createExternalCapability(definitions[0], { fetchImpl });
  const result = await capability.execute({
    project: { projectId: "project.http" },
    asset: { id: "asset.http", source: { mimeType: "image/png" } },
    sourceBuffer: Buffer.from("source"),
    params: { strength: 0.5 },
  });
  assert.equal(result.output.toString(), "binary-result");
  assert.equal(calls[1].options.headers["x-imagespec-capability"], "external.http");
});

test("host Runner configuration loads definitions without exposing project-controlled execution", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "imagespec-runner-config-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const configPath = path.join(root, "runners.json");
  await fs.writeFile(configPath, JSON.stringify({ capabilities: [commandDefinition()] }));
  const definitions = loadExternalRunnerDefinitions(configPath);
  assert.equal(definitions.length, 1);
  assert.equal(definitions[0].transport.command, process.execPath);
});
