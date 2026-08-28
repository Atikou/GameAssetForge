"use strict";

const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");

const protocol = require("../../imagespec/protocol");
const {
  AtomicProjectTransaction,
  ProjectRepository,
  acquireProjectLock,
  inspectTransactions,
  recoverTransactions,
} = require("../../imagespec/core");

async function temporaryProject(t, name = "test.project.imagespec") {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "gameassetforge-imagespec-"));
  t.after(() => fs.rm(tempRoot, { recursive: true, force: true }));
  return path.join(tempRoot, name);
}

function importPlan(project, planId = "plan.import.icon") {
  return protocol.createOperationPlan(project, {
    planId,
    operations: [
      {
        operationId: "operation.import.icon",
        op: "asset.import",
        targetId: "icon.coin",
        params: { sourcePath: "coin.png", destinationPath: "assets/source/coin.png", name: "Coin", type: "atomic" },
        allowedChanges: ["assetGraph", "assets/source/coin.png"],
        deniedChanges: ["canvas"],
        requiresApproval: false,
      },
    ],
  });
}

test("repository creates a canonical project with a verified revision hash", async (t) => {
  const projectDir = await temporaryProject(t);
  const repository = new ProjectRepository();
  const inspection = await repository.create(projectDir, { name: "Repository test", width: 64, height: 64 });
  assert.equal(inspection.revision.number, 0);
  assert.match(inspection.revision.hash, /^sha256:/);
  assert.equal(inspection.pendingTransactions.length, 0);
  const project = await repository.read(projectDir);
  assert.equal(project.revision.hash, protocol.hashProject(project));
});

test("repository detects project.json edits outside a revision transaction", async (t) => {
  const projectDir = await temporaryProject(t);
  const repository = new ProjectRepository();
  await repository.create(projectDir, { name: "Hash test" });
  const projectPath = path.join(projectDir, "project.json");
  const project = JSON.parse(await fs.readFile(projectPath, "utf8"));
  project.name = "Tampered";
  await fs.writeFile(projectPath, JSON.stringify(project), "utf8");
  await assert.rejects(() => repository.read(projectDir), (error) => error.code === "IMAGESPEC_REVISION_HASH_MISMATCH");
});

test("atomic transaction recovery restores replaced files and removes new partial files", async (t) => {
  const projectDir = await temporaryProject(t);
  const repository = new ProjectRepository();
  await repository.create(projectDir, { name: "Recovery test" });
  await fs.mkdir(path.join(projectDir, "design"), { recursive: true });
  await fs.writeFile(path.join(projectDir, "design", "existing.txt"), "original", "utf8");

  const transaction = new AtomicProjectTransaction(projectDir);
  transaction.stageWrite("design/existing.txt", "replacement");
  transaction.stageWrite("design/new.txt", "new");
  await transaction.prepare();
  await fs.writeFile(path.join(projectDir, "design", "existing.txt"), "partial", "utf8");
  await fs.writeFile(path.join(projectDir, "design", "new.txt"), "partial", "utf8");
  assert.equal((await inspectTransactions(projectDir)).length, 1);
  const results = await recoverTransactions(projectDir);
  assert.equal(results[0].recovered, true);
  assert.equal(await fs.readFile(path.join(projectDir, "design", "existing.txt"), "utf8"), "original");
  await assert.rejects(() => fs.access(path.join(projectDir, "design", "new.txt")));
});

test("project lock rejects concurrent writers and releases by token", async (t) => {
  const projectDir = await temporaryProject(t);
  await fs.mkdir(projectDir, { recursive: true });
  const lock = await acquireProjectLock(projectDir, { timeoutMs: 100 });
  await assert.rejects(
    () => acquireProjectLock(projectDir, { timeoutMs: 40, pollMs: 5 }),
    (error) => error.code === "IMAGESPEC_PROJECT_LOCKED",
  );
  await lock.release();
  const second = await acquireProjectLock(projectDir, { timeoutMs: 100 });
  await second.release();
});

test("project lock heartbeat prevents active long-running writers from becoming stale", async (t) => {
  const projectDir = await temporaryProject(t);
  await fs.mkdir(projectDir, { recursive: true });
  const lock = await acquireProjectLock(projectDir, { timeoutMs: 100, staleMs: 45, heartbeatMs: 10 });
  await new Promise((resolve) => setTimeout(resolve, 90));
  await assert.rejects(
    () => acquireProjectLock(projectDir, { timeoutMs: 35, staleMs: 45, pollMs: 5 }),
    (error) => error.code === "IMAGESPEC_PROJECT_LOCKED",
  );
  await lock.release();
});

test("successful transaction advances revision and writes immutable plan, history, asset, and receipt", async (t) => {
  const projectDir = await temporaryProject(t);
  const repository = new ProjectRepository();
  await repository.create(projectDir, { name: "Transaction test", width: 16, height: 16 });
  const project = await repository.read(projectDir);
  const plan = importPlan(project);
  const data = Buffer.from("asset-bytes");
  const result = await repository.transact(projectDir, plan, async ({ project: draft, transaction }) => {
    transaction.stageWrite("assets/source/coin.png", data);
    draft.assetGraph.nodes.push(
      protocol.createDefaultAsset({
        id: "icon.coin",
        name: "Coin",
        bounds: { x: 0, y: 0, width: 16, height: 16 },
        source: { kind: "file", path: "assets/source/coin.png", sha256: protocol.sha256(data), mimeType: "image/png" },
      }),
    );
    return {
      project: draft,
      changedAssets: ["icon.coin"],
      generatedFiles: [{ path: "assets/source/coin.png", sha256: protocol.sha256(data), size: data.length, mimeType: "image/png", role: "source" }],
      validationResult: { ok: true, issues: [], reportPath: "validation-report.json" },
      adapters: [{ id: "test.adapter", version: "1" }],
    };
  });
  assert.equal(result.project.revision.number, 1);
  assert.equal(result.receipt.status, "succeeded");
  assert.equal((await repository.read(projectDir)).assetGraph.nodes[0].id, "icon.coin");
  assert.equal(await fs.readFile(path.join(projectDir, "assets", "source", "coin.png"), "utf8"), "asset-bytes");
  assert.equal((await repository.listPlans(projectDir)).length, 1);
  assert.equal((await repository.inspect(projectDir)).receiptCount, 1);
});

test("failed validation produces a receipt without advancing the project revision", async (t) => {
  const projectDir = await temporaryProject(t);
  const repository = new ProjectRepository();
  await repository.create(projectDir, { name: "Failed transaction" });
  const project = await repository.read(projectDir);
  const plan = importPlan(project, "plan.failed.import");
  const result = await repository.transact(projectDir, plan, async ({ project: draft }) => ({
    project: draft,
    validationResult: { ok: false, issues: [{ code: "test.failure", severity: "error", message: "Expected failure" }] },
  }));
  assert.equal(result.status, "failed");
  assert.equal((await repository.read(projectDir)).revision.number, 0);
  assert.equal((await repository.inspect(projectDir)).receiptCount, 1);
});
