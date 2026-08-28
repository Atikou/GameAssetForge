"use strict";

const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const test = require("node:test");
const assert = require("node:assert/strict");
const sharp = require("sharp");

const root = path.resolve(__dirname, "../..");
const cli = path.join(root, "imagespec", "cli", "bin.js");

function runCli(args, expectedStatus = 0) {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, expectedStatus, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  const text = expectedStatus === 0 ? result.stdout : result.stderr;
  return JSON.parse(text);
}

async function fixture(t) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "gameassetforge-cli-"));
  t.after(() => fs.rm(tempRoot, { recursive: true, force: true }));
  const imagePath = path.join(tempRoot, "icon.png");
  await sharp({ create: { width: 4, height: 4, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 0.5 } } }).png().toFile(imagePath);
  return { tempRoot, imagePath, projectDir: path.join(tempRoot, "cli.project.imagespec") };
}

test("CLI emits structured help, version, schema, and errors", () => {
  assert.equal(runCli(["help"]).ok, true);
  assert.match(runCli(["version"]).result.version, /^0\./);
  assert.ok(runCli(["schema", "list"]).result.schemas.includes("project"));
  const error = runCli(["unknown", "command"], 2);
  assert.equal(error.ok, false);
  assert.equal(error.error.code, "IMAGESPEC_CLI_COMMAND_UNKNOWN");
});

test("CLI completes project create, plan create/apply, validate, and build", async (t) => {
  const { tempRoot, imagePath, projectDir } = await fixture(t);
  const created = runCli(["project", "create", "--project", projectDir, "--name", "CLI project", "--width", "32", "--height", "32"]);
  assert.equal(created.result.revision.number, 0);

  const planPath = path.join(tempRoot, "import-plan.json");
  await fs.writeFile(
    planPath,
    JSON.stringify({
      planId: "plan.cli.import",
      sourceUserRequest: "Import an icon through the CLI.",
      operations: [
        {
          operationId: "operation.cli.import",
          op: "asset.import",
          targetId: "icon.cli",
          params: { sourcePath: imagePath, name: "CLI icon", type: "atomic" },
          allowedChanges: ["assetGraph", "assets/source"],
          deniedChanges: ["canvas"],
          requiresApproval: false
        }
      ]
    }),
    "utf8",
  );
  const plan = runCli(["plan", "create", "--project", projectDir, "--input", planPath]);
  assert.equal(plan.result.planId, "plan.cli.import");
  const applied = runCli(["plan", "apply", "--project", projectDir, "--plan", "plan.cli.import"]);
  assert.equal(applied.result.receipt.status, "succeeded");

  const validatedReadOnly = runCli(["validate", "--project", projectDir]);
  assert.equal(validatedReadOnly.result.ok, true);
  const validated = runCli(["validate", "--project", projectDir, "--apply"]);
  assert.equal(validated.result.project.assetGraph.nodes[0].state, "validated");
  const built = runCli(["build", "--project", projectDir, "--preset", "generic.default"]);
  assert.equal(built.result.project.assetGraph.nodes[0].state, "exportable");
  assert.equal(runCli(["project", "inspect", "--project", projectDir]).result.revision.number, 3);
});
