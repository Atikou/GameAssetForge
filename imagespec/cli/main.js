"use strict";

const fs = require("fs/promises");
const path = require("path");

const packageJson = require("../../package.json");
const protocol = require("../protocol");
const { ImageSpecService } = require("../core");
const { parseArgs, booleanOption, numberOption, requireOption } = require("./args");

const HELP = {
  name: "imagespec",
  version: packageJson.version,
  commands: [
    "project create --project <path.project.imagespec> --name <name> [--width N --height N]",
    "project inspect --project <path.project.imagespec>",
    "project recover --project <path.project.imagespec>",
    "asset find --project <path.project.imagespec> [--query text]",
    "capability list",
    "plan create --project <path.project.imagespec> --input <plan.json>",
    "plan preview --project <path.project.imagespec> --plan <plan-id|file.json>",
    "plan apply --project <path.project.imagespec> --plan <plan-id|file.json> [--approve]",
    "validate --project <path.project.imagespec> [--apply]",
    "build --project <path.project.imagespec> --preset <preset-id>",
    "export --project <path.project.imagespec> --preset <preset-id> --output <build/archive.zip>",
    "schema list",
    "schema print --name <project|plan|receipt|common>",
  ],
};

async function readJsonFile(filePath) {
  return JSON.parse(await fs.readFile(path.resolve(filePath), "utf8"));
}

async function resolvePlanInput(service, projectDir, value) {
  const resolved = path.resolve(String(value));
  try {
    const stat = await fs.stat(resolved);
    if (stat.isFile()) return readJsonFile(resolved);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return service.getPlan(projectDir, value);
}

async function executeCommand(argv, dependencies = {}) {
  const service = dependencies.service || new ImageSpecService();
  const { positionals, options } = parseArgs(argv);
  const [group, action] = positionals;
  if (group === "version" || options.version) return { version: packageJson.version };
  if (!group || group === "help" || options.help) return HELP;

  if (group === "project" && action === "create") {
    return service.createProject(requireOption(options, "project"), {
      name: requireOption(options, "name"),
      projectId: options.id,
      width: numberOption(options.width, 1024),
      height: numberOption(options.height, 1024),
      description: options.description || "",
      author: options.author || "",
      orientation: options.orientation || "free",
      alphaMode: options["alpha-mode"] || "straight",
    });
  }
  if (group === "project" && action === "inspect") return service.inspectProject(requireOption(options, "project"));
  if (group === "project" && action === "recover") return { recovered: await service.recoverProject(requireOption(options, "project")) };
  if (group === "asset" && action === "find") return { assets: await service.findAssets(requireOption(options, "project"), options.query || "") };
  if (group === "capability" && action === "list") return { capabilities: service.listCapabilities() };

  if (group === "plan" && action === "create") {
    const input = await readJsonFile(requireOption(options, "input"));
    return service.createPlan(requireOption(options, "project"), input, { save: !booleanOption(options["no-save"]) });
  }
  if (group === "plan" && action === "preview") {
    const projectDir = requireOption(options, "project");
    return service.previewPlan(projectDir, await resolvePlanInput(service, projectDir, requireOption(options, "plan")));
  }
  if (group === "plan" && action === "apply") {
    const projectDir = requireOption(options, "project");
    return service.applyPlan(projectDir, await resolvePlanInput(service, projectDir, requireOption(options, "plan")), {
      approved: booleanOption(options.approve),
      approval: booleanOption(options.approve) ? { id: options["approval-id"] || `cli.${Date.now()}` } : null,
    });
  }
  if (group === "validate" && !action) {
    const projectDir = requireOption(options, "project");
    if (!booleanOption(options.apply)) return service.validateProject(projectDir, { forBuild: booleanOption(options["for-build"]) });
    const plan = await service.createValidationPlan(projectDir);
    return service.applyPlan(projectDir, plan.planId);
  }
  if (group === "build" && !action) {
    const projectDir = requireOption(options, "project");
    const plan = await service.createBuildPlan(projectDir, requireOption(options, "preset"));
    return service.applyPlan(projectDir, plan.planId);
  }
  if (group === "export" && !action) {
    const projectDir = requireOption(options, "project");
    const plan = await service.createExportPlan(projectDir, requireOption(options, "preset"), requireOption(options, "output"));
    return service.applyPlan(projectDir, plan.planId);
  }
  if (group === "schema" && action === "list") return { schemas: Object.keys(protocol.schemas) };
  if (group === "schema" && action === "print") {
    const name = requireOption(options, "name");
    if (!protocol.schemas[name]) {
      const error = new Error(`Unknown schema: ${name}`);
      error.code = "IMAGESPEC_SCHEMA_NOT_FOUND";
      throw error;
    }
    return protocol.schemas[name];
  }

  const error = new Error(`Unknown ImageSpec command: ${positionals.join(" ")}`);
  error.code = "IMAGESPEC_CLI_COMMAND_UNKNOWN";
  error.details = { positionals, help: HELP.commands };
  throw error;
}

function errorPayload(error) {
  return {
    ok: false,
    error: {
      code: error.code || "IMAGESPEC_CLI_FAILED",
      message: error.message || "ImageSpec CLI failed.",
      details: error.details || {},
      ...(error.receipt ? { receipt: error.receipt } : {}),
    },
  };
}

async function runCli(argv = process.argv.slice(2), io = {}) {
  const stdout = io.stdout || process.stdout;
  const stderr = io.stderr || process.stderr;
  try {
    const result = await executeCommand(argv, io.dependencies);
    stdout.write(`${JSON.stringify({ ok: true, result }, null, 2)}\n`);
    return 0;
  } catch (error) {
    stderr.write(`${JSON.stringify(errorPayload(error), null, 2)}\n`);
    return error.statusCode === 404 ? 4 : error.statusCode === 409 ? 3 : 2;
  }
}

module.exports = {
  HELP,
  readJsonFile,
  resolvePlanInput,
  executeCommand,
  errorPayload,
  runCli,
};
