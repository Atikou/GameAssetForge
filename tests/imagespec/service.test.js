"use strict";

const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");
const sharp = require("sharp");

const { ImageSpecService } = require("../../imagespec/core");

async function workspace(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "gameassetforge-service-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return { root, projectDir: path.join(root, "service.project.imagespec") };
}

async function createTransparentFixture(filePath, width = 8, height = 8) {
  const foreground = await sharp({
    create: { width: Math.max(1, width - 4), height: Math.max(1, height - 4), channels: 4, background: { r: 255, g: 180, b: 0, alpha: 1 } },
  })
    .png()
    .toBuffer();
  const output = await sharp({
    create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: foreground, left: 2, top: 2 }])
    .png()
    .toBuffer();
  await fs.writeFile(filePath, output);
  return output;
}

test("ImageSpec service completes import, validate, build, and export with receipts", async (t) => {
  const { root, projectDir } = await workspace(t);
  const sourcePath = path.join(root, "coin.png");
  await createTransparentFixture(sourcePath);
  const service = new ImageSpecService();
  await service.createProject(projectDir, { name: "Service integration", width: 64, height: 64 });

  const importPlan = await service.createPlan(projectDir, {
    planId: "plan.service.import",
    sourceUserRequest: "Import the coin icon.",
    operations: [
      {
        operationId: "operation.service.import",
        op: "asset.import",
        targetId: "icon.coin",
        params: { sourcePath, destinationPath: "assets/source/coin.png", name: "Coin", type: "atomic" },
        allowedChanges: ["assetGraph", "assets/source/coin.png"],
        deniedChanges: ["canvas"],
        requiresApproval: false,
      },
    ],
  });
  assert.match(importPlan.preview.summary, /1 operation/);
  const imported = await service.applyPlan(projectDir, importPlan.planId);
  assert.equal(imported.receipt.status, "succeeded");
  assert.equal(imported.project.assetGraph.nodes[0].source.path, "assets/source/coin.png");

  const validationPlan = await service.createValidationPlan(projectDir, { planId: "plan.service.validate" });
  const validated = await service.applyPlan(projectDir, validationPlan.planId);
  assert.equal(validated.project.assetGraph.nodes[0].state, "validated");
  assert.equal(validated.receipt.validationResult.ok, true);

  const buildPlan = await service.createBuildPlan(projectDir, "generic.default", { planId: "plan.service.build" });
  const built = await service.applyPlan(projectDir, buildPlan.planId);
  assert.equal(built.project.assetGraph.nodes[0].state, "exportable");
  assert.ok(built.receipt.generatedFiles.some((file) => file.role === "manifest"));
  await fs.access(path.join(projectDir, "build", "generic", "generic-manifest.json"));
  await fs.access(path.join(projectDir, "build", "generic", "assets", "icon-coin.png"));

  const exportPlan = await service.createExportPlan(projectDir, "generic.default", "build/exports/service.zip", {
    planId: "plan.service.export",
  });
  const exported = await service.applyPlan(projectDir, exportPlan.planId);
  assert.ok(exported.receipt.generatedFiles.some((file) => file.path === "build/exports/service.zip"));
  const archiveStat = await fs.stat(path.join(projectDir, "build", "exports", "service.zip"));
  assert.ok(archiveStat.size > 0);
  assert.equal((await service.inspectProject(projectDir)).revision.number, 4);
});

test("Runner processing updates source asset through an approved deterministic operation", async (t) => {
  const { root, projectDir } = await workspace(t);
  const sourcePath = path.join(root, "sprite.png");
  await createTransparentFixture(sourcePath);
  const service = new ImageSpecService();
  await service.createProject(projectDir, { name: "Runner integration", width: 64, height: 64 });
  const importPlan = await service.createPlan(projectDir, {
    planId: "plan.runner.import",
    operations: [
      {
        operationId: "operation.runner.import",
        op: "asset.import",
        targetId: "sprite.hero",
        params: { sourcePath, name: "Hero", type: "atomic" },
        allowedChanges: ["assetGraph", "assets/source"],
        deniedChanges: ["canvas"],
        requiresApproval: false,
      },
    ],
  });
  await service.applyPlan(projectDir, importPlan.planId);
  const project = await service.repository.read(projectDir);
  const processPlan = await service.createPlan(projectDir, {
    planId: "plan.runner.resize",
    affectedAssets: ["sprite.hero"],
    operations: [
      {
        operationId: "operation.runner.resize",
        op: "asset.process",
        targetId: "sprite.hero",
        params: { capability: "image.resize", width: 16, height: 16, mode: "exact", outputPath: "assets/generated/hero-16.png" },
        allowedChanges: ["asset.*", "assets/generated/hero-16.png"],
        deniedChanges: ["canvas"],
        requiresApproval: false,
      },
    ],
    constraints: { canvasSizeUnchanged: true, protectedAssetHashUnchanged: true },
  });
  const result = await service.applyPlan(projectDir, processPlan.planId);
  assert.equal(result.project.assetGraph.nodes[0].source.path, "assets/generated/hero-16.png");
  assert.equal(result.project.assetGraph.nodes[0].bounds.width, 16);
  assert.ok(result.receipt.provenance.adapters.some((adapter) => adapter.id === "image.resize"));
  await fs.access(path.join(projectDir, "assets", "generated", "hero-16.png"));
  assert.equal(project.revision.number + 1, result.project.revision.number);
});

test("destructive plans require explicit approval", async (t) => {
  const { root, projectDir } = await workspace(t);
  const sourcePath = path.join(root, "sprite.png");
  await createTransparentFixture(sourcePath);
  const service = new ImageSpecService();
  await service.createProject(projectDir, { name: "Approval test" });
  const importPlan = await service.createPlan(projectDir, {
    planId: "plan.approval.import",
    operations: [
      {
        operationId: "operation.approval.import",
        op: "asset.import",
        targetId: "sprite.delete",
        params: { sourcePath, name: "Delete me", type: "atomic" },
        allowedChanges: ["assetGraph", "assets/source"],
        deniedChanges: ["canvas"],
        requiresApproval: false,
      },
    ],
  });
  await service.applyPlan(projectDir, importPlan.planId);
  const deletePlan = await service.createPlan(projectDir, {
    planId: "plan.approval.delete",
    affectedAssets: ["sprite.delete"],
    operations: [
      {
        operationId: "operation.approval.delete",
        op: "asset.delete",
        targetId: "sprite.delete",
        params: { cascade: false },
        allowedChanges: ["asset.*"],
        deniedChanges: ["canvas"],
        requiresApproval: false,
      },
    ],
  });
  assert.equal(deletePlan.requiredApproval, true);
  await assert.rejects(() => service.applyPlan(projectDir, deletePlan.planId), (error) => error.code === "IMAGESPEC_APPROVAL_REQUIRED");
  const deleted = await service.applyPlan(projectDir, deletePlan.planId, { approved: true, approval: { id: "approval.test" } });
  assert.equal(deleted.project.assetGraph.nodes.length, 0);
  assert.equal(deleted.receipt.status, "succeeded");
});

test("change contracts cover implicit bounds and region-association mutations", async (t) => {
  const { root, projectDir } = await workspace(t);
  const sourcePath = path.join(root, "source.png");
  const replacementPath = path.join(root, "replacement.png");
  await createTransparentFixture(sourcePath, 8, 8);
  await createTransparentFixture(replacementPath, 16, 12);
  const service = new ImageSpecService();
  await service.createProject(projectDir, { name: "Mutation contract" });
  const imported = await service.createPlan(projectDir, {
    planId: "plan.contract.import",
    operations: [{
      operationId: "operation.contract.import",
      op: "asset.import",
      targetId: "sprite.contract",
      params: { sourcePath, name: "Contract", type: "atomic" },
      allowedChanges: ["asset.*", "assets/source"],
      deniedChanges: ["canvas"],
      requiresApproval: false,
    }],
  });
  await service.applyPlan(projectDir, imported.planId);

  const replacement = await service.createPlan(projectDir, {
    planId: "plan.contract.replace",
    affectedAssets: ["sprite.contract"],
    operations: [{
      operationId: "operation.contract.replace",
      op: "asset.replaceSource",
      targetId: "sprite.contract",
      params: { sourcePath: replacementPath, destinationPath: "assets/source/replacement.png" },
      allowedChanges: ["asset.sprite.contract.source", "assets/source/replacement.png"],
      deniedChanges: ["asset.sprite.contract.bounds"],
      requiresApproval: true,
    }],
  });
  await assert.rejects(
    () => service.applyPlan(projectDir, replacement.planId, { approved: true, approval: { id: "approval.contract" } }),
    (error) => error.code === "IMAGESPEC_CHANGE_DENIED" && error.receipt?.status === "failed",
  );
  assert.equal((await service.readProject(projectDir)).assetGraph.nodes[0].bounds.width, 8);

  const regionPlan = await service.createPlan(projectDir, {
    planId: "plan.contract.region",
    affectedAssets: ["sprite.contract"],
    operations: [{
      operationId: "operation.contract.region",
      op: "region.create",
      targetId: null,
      params: { region: { id: "region.contract", name: "Contract", geometry: { type: "rect", bounds: { x: 0, y: 0, width: 8, height: 8 }, rotation: 0 }, masks: {}, associatedAssetIds: ["sprite.contract"], instruction: "", acceptance: "" } },
      allowedChanges: ["regions"],
      deniedChanges: ["canvas"],
      requiresApproval: false,
    }],
  });
  await service.applyPlan(projectDir, regionPlan.planId);
  await assert.rejects(
    () => service.createPlan(projectDir, {
      planId: "plan.contract.delete",
      affectedAssets: ["sprite.contract"],
      operations: [{
        operationId: "operation.contract.delete",
        op: "asset.delete",
        targetId: "sprite.contract",
        params: { cascade: false },
        allowedChanges: ["asset.*"],
        deniedChanges: ["canvas"],
        requiresApproval: true,
      }],
    }),
    (error) => error.code === "IMAGESPEC_CHANGE_NOT_ALLOWED",
  );
});
