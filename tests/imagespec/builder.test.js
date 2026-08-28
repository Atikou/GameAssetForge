"use strict";

const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");
const JSZip = require("jszip");
const sharp = require("sharp");

const { exportProjectArchive, prepareAssetImage } = require("../../imagespec/builder");
const { createDefaultAsset, createDefaultProject, createExportPreset, sha256 } = require("../../imagespec/protocol");

test("export archive includes loose assets, atlas files, manifest, and engine artifacts", async (t) => {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "imagespec-builder-"));
  t.after(() => fs.rm(projectDir, { recursive: true, force: true }));
  const source = await sharp({ create: { width: 8, height: 8, channels: 4, background: { r: 40, g: 120, b: 240, alpha: 1 } } }).png().toBuffer();
  await fs.mkdir(path.join(projectDir, "assets", "source"), { recursive: true });
  await fs.writeFile(path.join(projectDir, "assets", "source", "button.png"), source);

  const project = createDefaultProject({ projectId: "project.builder", name: "Builder" });
  const asset = createDefaultAsset({ id: "ui.button", name: "Button", bounds: { x: 0, y: 0, width: 8, height: 8 } });
  asset.source = { kind: "file", path: "assets/source/button.png", sha256: sha256(source), mimeType: "image/png" };
  asset.state = "validated";
  asset.exportPolicy.trimTransparent = false;
  project.assetGraph.nodes.push(asset);
  project.exportPresets.push(createExportPreset("preset.unity", "Unity", "unity", { scales: [1, 2], atlas: { enabled: true, maxSize: 128, padding: 2, extrude: 1, powerOfTwo: true } }));

  const staged = new Map();
  const transaction = { stageWrite(relativePath, buffer) { staged.set(relativePath, Buffer.from(buffer)); } };
  const result = await exportProjectArchive(projectDir, project, "preset.unity", "build/exports/unity.zip", {
    transaction,
    readFile: (relativePath) => fs.readFile(path.join(projectDir, ...relativePath.split("/"))),
  });
  const zip = await JSZip.loadAsync(result.archive);
  for (const expected of [
    "build/unity/assets/ui-button.png",
    "build/unity/assets/ui-button.png.meta",
    "build/unity/atlas/atlas.png",
    "build/unity/atlas/atlas.json",
    "build/unity/atlas/atlas@2x.png",
    "build/unity/atlas/atlas@2x.json",
    "build/unity/unity-manifest.json",
  ]) {
    assert.ok(zip.file(expected), `archive is missing ${expected}`);
  }
  assert.ok(staged.has("build/exports/unity.zip"));
  assert.ok(result.generatedFiles.some((entry) => entry.role === "unity-meta"));
});

test("trimmed pivot uses source pixels rather than layout bounds", async () => {
  const foreground = await sharp({ create: { width: 4, height: 4, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } }).png().toBuffer();
  const source = await sharp({ create: { width: 8, height: 8, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: foreground, left: 2, top: 2 }])
    .png()
    .toBuffer();
  const asset = createDefaultAsset({ id: "ui.scaled", bounds: { x: 0, y: 0, width: 80, height: 40 } });
  asset.exportPolicy.trimTransparent = true;
  asset.exportPolicy.pivot = { x: 0.5, y: 0.5 };
  const preset = createExportPreset("preset.generic.pivot", "Generic", "generic");
  const prepared = await prepareAssetImage(source, asset, preset, 1);
  assert.deepEqual(prepared.trim, { x: 2, y: 2 });
  assert.equal(prepared.width, 4);
  assert.equal(prepared.height, 4);
  assert.equal(prepared.pivot.x, 0.5);
  assert.equal(prepared.pivot.y, 0.5);
});

test("nine-slice borders include padding and output scale", async () => {
  const source = await sharp({ create: { width: 16, height: 12, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } }).png().toBuffer();
  const asset = createDefaultAsset({ id: "ui.panel", type: "nineSlice", bounds: { x: 0, y: 0, width: 16, height: 12 } });
  asset.exportPolicy.nineSlice = { left: 3, right: 4, top: 2, bottom: 3 };
  asset.exportPolicy.padding = 1;
  const preset = createExportPreset("preset.generic.nine", "Generic", "generic");
  const prepared = await prepareAssetImage(source, asset, preset, 2);
  assert.deepEqual(prepared.nineSlice, { left: 8, right: 10, top: 6, bottom: 8 });
});
