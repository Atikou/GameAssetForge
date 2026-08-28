"use strict";

const { spawn } = require("child_process");
const fsSync = require("fs");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");

const { ImageSpecError } = require("../core/errors");

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

function assertExternalDefinition(definition) {
  if (!definition?.id || !definition?.transport?.type) {
    throw new ImageSpecError("IMAGESPEC_EXTERNAL_RUNNER_INVALID", "External Runner definition requires id and transport.type.", { definition });
  }
  if (!['command', 'http'].includes(definition.transport.type)) {
    throw new ImageSpecError("IMAGESPEC_EXTERNAL_RUNNER_INVALID", `Unsupported external Runner transport: ${definition.transport.type}`);
  }
  if (definition.transport.type === "command" && !definition.transport.command) {
    throw new ImageSpecError("IMAGESPEC_EXTERNAL_RUNNER_INVALID", `Command Runner ${definition.id} requires transport.command.`);
  }
  if (definition.transport.type === "http") {
    let endpoint;
    try {
      endpoint = new URL(definition.transport.endpoint);
    } catch {
      throw new ImageSpecError("IMAGESPEC_EXTERNAL_RUNNER_INVALID", `HTTP Runner ${definition.id} has an invalid endpoint.`);
    }
    if (!['http:', 'https:'].includes(endpoint.protocol)) {
      throw new ImageSpecError("IMAGESPEC_EXTERNAL_RUNNER_INVALID", `HTTP Runner ${definition.id} must use HTTP or HTTPS.`);
    }
  }
}

function interpolateArg(value, replacements) {
  return String(value).replace(/\{(input|output|request)\}/g, (_, key) => replacements[key]);
}

function collectBounded(stream, maxBytes, onOverflow) {
  const chunks = [];
  let size = 0;
  stream.on("data", (chunk) => {
    size += chunk.length;
    if (size > maxBytes) return onOverflow();
    chunks.push(chunk);
  });
  return () => Buffer.concat(chunks).toString("utf8");
}

async function executeCommand(definition, context) {
  const transport = definition.transport;
  const timeoutMs = transport.timeoutMs || DEFAULT_TIMEOUT_MS;
  const maxOutputBytes = transport.maxOutputBytes || DEFAULT_MAX_OUTPUT_BYTES;
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "imagespec-runner-"));
  const inputPath = path.join(tempDir, `input.${transport.inputExtension || "bin"}`);
  const outputPath = path.join(tempDir, `output.${transport.outputExtension || definition.outputExtension || "png"}`);
  const requestPath = path.join(tempDir, "request.json");
  try {
    await Promise.all([
      fs.writeFile(inputPath, context.sourceBuffer || Buffer.alloc(0)),
      fs.writeFile(requestPath, `${JSON.stringify({ projectId: context.project?.projectId, asset: context.asset, params: context.params || {}, masks: context.masks || {} }, null, 2)}\n`),
    ]);
    const replacements = { input: inputPath, output: outputPath, request: requestPath };
    const args = (transport.args || ["{input}", "{output}", "{request}"]).map((arg) => interpolateArg(arg, replacements));
    const result = await new Promise((resolve, reject) => {
      const child = spawn(transport.command, args, {
        cwd: transport.cwd || tempDir,
        env: { ...process.env, ...(transport.env || {}) },
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let settled = false;
      let overflow = false;
      let terminationError = null;
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        context.signal?.removeEventListener("abort", abort);
        error ? reject(error) : resolve(value);
      };
      const abort = () => {
        terminationError = new ImageSpecError("IMAGESPEC_RUNNER_CANCELLED", `External Runner ${definition.id} was cancelled.`);
        child.kill();
      };
      const overflowOutput = () => {
        if (overflow) return;
        overflow = true;
        terminationError = new ImageSpecError("IMAGESPEC_RUNNER_OUTPUT_LIMIT", `External Runner ${definition.id} exceeded its log limit.`);
        child.kill();
      };
      const stdout = collectBounded(child.stdout, Math.min(maxOutputBytes, 1024 * 1024), overflowOutput);
      const stderr = collectBounded(child.stderr, Math.min(maxOutputBytes, 1024 * 1024), overflowOutput);
      const timer = setTimeout(() => {
        terminationError = new ImageSpecError("IMAGESPEC_RUNNER_TIMEOUT", `External Runner ${definition.id} exceeded ${timeoutMs}ms.`);
        child.kill();
      }, timeoutMs);
      timer.unref?.();
      if (context.signal?.aborted) return abort();
      context.signal?.addEventListener("abort", abort, { once: true });
      child.once("error", (error) => finish(new ImageSpecError("IMAGESPEC_RUNNER_SPAWN_FAILED", `Cannot start external Runner ${definition.id}.`, { command: transport.command }, { cause: error })));
      child.once("close", (code) => {
        if (terminationError) return finish(terminationError);
        const logs = { stdout: stdout().slice(-4096), stderr: stderr().slice(-4096) };
        if (code !== 0) return finish(new ImageSpecError("IMAGESPEC_RUNNER_EXIT_FAILED", `External Runner ${definition.id} exited with code ${code}.`, { code, ...logs }));
        finish(null, logs);
      });
    });
    const output = await fs.readFile(outputPath).catch((error) => {
      throw new ImageSpecError("IMAGESPEC_RUNNER_OUTPUT_MISSING", `External Runner ${definition.id} did not create its output file.`, { outputPath }, { cause: error });
    });
    if (output.length > maxOutputBytes) {
      throw new ImageSpecError("IMAGESPEC_RUNNER_OUTPUT_LIMIT", `External Runner ${definition.id} output exceeds ${maxOutputBytes} bytes.`);
    }
    return {
      output,
      extension: transport.outputExtension || definition.outputExtension || "png",
      mimeType: definition.outputMimeType || "image/png",
      metadata: { externalRunner: { transport: "command", exitCode: 0 } },
      warnings: transport.captureStderrAsWarning && result.stderr ? [`External Runner stderr: ${result.stderr}`] : [],
    };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }).catch(() => {});
  }
}

async function executeHttp(definition, context, fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== "function") throw new ImageSpecError("IMAGESPEC_RUNNER_HTTP_UNAVAILABLE", "HTTP Runner requires fetch().");
  const transport = definition.transport;
  const timeoutMs = transport.timeoutMs || DEFAULT_TIMEOUT_MS;
  const maxOutputBytes = transport.maxOutputBytes || DEFAULT_MAX_OUTPUT_BYTES;
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = context.signal ? AbortSignal.any([context.signal, timeout]) : timeout;
  let response;
  try {
    response = await fetchImpl(transport.endpoint, {
      method: transport.method || "POST",
      headers: {
        "content-type": context.asset?.source?.mimeType || "application/octet-stream",
        "accept": "application/octet-stream, application/json",
        "x-imagespec-capability": definition.id,
        "x-imagespec-project": context.project?.projectId || "",
        "x-imagespec-asset": context.asset?.id || "",
        "x-imagespec-params": Buffer.from(JSON.stringify(context.params || {})).toString("base64url"),
        ...(transport.headers || {}),
      },
      body: context.sourceBuffer || Buffer.alloc(0),
      signal,
    });
  } catch (error) {
    const code = context.signal?.aborted ? "IMAGESPEC_RUNNER_CANCELLED" : timeout.aborted ? "IMAGESPEC_RUNNER_TIMEOUT" : "IMAGESPEC_RUNNER_HTTP_FAILED";
    throw new ImageSpecError(code, `HTTP Runner ${definition.id} request failed.`, { endpoint: transport.endpoint }, { cause: error });
  }
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 4096);
    throw new ImageSpecError("IMAGESPEC_RUNNER_HTTP_STATUS", `HTTP Runner ${definition.id} returned ${response.status}.`, { status: response.status, detail });
  }
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > maxOutputBytes) throw new ImageSpecError("IMAGESPEC_RUNNER_OUTPUT_LIMIT", `HTTP Runner ${definition.id} output exceeds ${maxOutputBytes} bytes.`);
  const contentType = response.headers.get("content-type") || definition.outputMimeType || "application/octet-stream";
  let output;
  let responseMetadata = {};
  if (contentType.includes("application/json")) {
    const payload = await response.json();
    if (!payload.outputBase64) throw new ImageSpecError("IMAGESPEC_RUNNER_OUTPUT_INVALID", `HTTP Runner ${definition.id} JSON response requires outputBase64.`);
    output = Buffer.from(payload.outputBase64, "base64");
    responseMetadata = payload.metadata || {};
  } else {
    output = Buffer.from(await response.arrayBuffer());
  }
  if (output.length > maxOutputBytes) throw new ImageSpecError("IMAGESPEC_RUNNER_OUTPUT_LIMIT", `HTTP Runner ${definition.id} output exceeds ${maxOutputBytes} bytes.`);
  return {
    output,
    extension: response.headers.get("x-imagespec-extension") || definition.outputExtension || "png",
    mimeType: contentType.split(";")[0],
    metadata: { ...responseMetadata, externalRunner: { transport: "http", endpoint: transport.endpoint } },
  };
}

function createExternalCapability(definition, options = {}) {
  assertExternalDefinition(definition);
  return {
    id: definition.id,
    version: definition.version || "1",
    title: definition.title || definition.id,
    description: definition.description || `External ${definition.transport.type} Runner capability.`,
    deterministic: Boolean(definition.deterministic),
    inputKinds: definition.inputKinds || ["image"],
    outputKinds: definition.outputKinds || ["image"],
    requiresApproval: definition.requiresApproval !== false,
    parameterSchema: definition.parameterSchema || { type: "object" },
    transport: { type: definition.transport.type },
    execute: (context) =>
      definition.transport.type === "command"
        ? executeCommand(definition, context)
        : executeHttp(definition, context, options.fetchImpl),
  };
}

function registerExternalRunnerCapabilities(registry, definitions = [], options = {}) {
  for (const definition of definitions) registry.register(createExternalCapability(definition, options));
  return registry;
}

function loadExternalRunnerDefinitions(filePath = process.env.GAF_IMAGESPEC_RUNNERS) {
  if (!filePath) return [];
  const resolved = path.resolve(filePath);
  let payload;
  try {
    payload = JSON.parse(fsSync.readFileSync(resolved, "utf8"));
  } catch (error) {
    throw new ImageSpecError("IMAGESPEC_RUNNER_CONFIG_INVALID", `Cannot read external Runner configuration: ${resolved}`, { filePath: resolved }, { cause: error });
  }
  const definitions = Array.isArray(payload) ? payload : payload.capabilities;
  if (!Array.isArray(definitions)) {
    throw new ImageSpecError("IMAGESPEC_RUNNER_CONFIG_INVALID", "External Runner configuration requires a capabilities array.", { filePath: resolved });
  }
  definitions.forEach(assertExternalDefinition);
  return definitions;
}

async function discoverHttpRunnerCapabilities(capabilitiesUrl, options = {}) {
  const endpoint = new URL(capabilitiesUrl);
  if (!['http:', 'https:'].includes(endpoint.protocol)) throw new ImageSpecError("IMAGESPEC_EXTERNAL_RUNNER_INVALID", "Capability discovery requires HTTP or HTTPS.");
  const response = await (options.fetchImpl || globalThis.fetch)(endpoint, { headers: options.headers || {}, signal: options.signal });
  if (!response.ok) throw new ImageSpecError("IMAGESPEC_RUNNER_DISCOVERY_FAILED", `Runner capability discovery returned ${response.status}.`);
  const payload = await response.json();
  const capabilities = Array.isArray(payload) ? payload : payload.capabilities;
  if (!Array.isArray(capabilities)) throw new ImageSpecError("IMAGESPEC_RUNNER_DISCOVERY_FAILED", "Runner capability discovery response requires a capabilities array.");
  return capabilities.map((entry) => ({
    ...entry,
    transport: {
      type: "http",
      endpoint: new URL(entry.endpoint, endpoint).href,
      timeoutMs: entry.timeoutMs,
      maxOutputBytes: entry.maxOutputBytes,
      headers: options.headers || {},
    },
  }));
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  DEFAULT_MAX_OUTPUT_BYTES,
  assertExternalDefinition,
  createExternalCapability,
  executeCommand,
  executeHttp,
  registerExternalRunnerCapabilities,
  loadExternalRunnerDefinitions,
  discoverHttpRunnerCapabilities,
};
