"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { createDefaultProject, createDefaultAsset, createExportPreset } = require("../../imagespec/protocol");
const { createEngineArtifacts, createEngineManifest } = require("../../imagespec/builder");

function fixture(engine) {
  const project = createDefaultProject({ projectId: "project.exporters", name: "Exporter Test" });
  const asset = createDefaultAsset({ id: "ui.button", name: "Button", type: "nineSlice" });
  asset.exportPolicy.nineSlice = { left: 4, right: 4, top: 3, bottom: 3 };
  project.assetGraph.nodes.push(asset);
  const preset = createExportPreset(`preset.${engine}`, engine, engine, { options: { packageName: "ExporterTest", packageId: "A1B2C3D4" } });
  const builtAssets = [{
    assetId: asset.id,
    scale: 1,
    path: `${preset.outputDir}/assets/ui-button.png`,
    width: 32,
    height: 16,
    pivot: { x: 0.5, y: 0.5 },
    nineSlice: asset.exportPolicy.nineSlice,
  }];
  return { project, preset, builtAssets };
}

test("all declared engine exporters produce manifests and adapter artifacts", () => {
  for (const engine of ["unity", "laya", "fgui", "cocos", "godot", "pixi"]) {
    const { project, preset, builtAssets } = fixture(engine);
    const manifest = createEngineManifest(project, preset, builtAssets);
    const artifacts = createEngineArtifacts(project, preset, builtAssets);
    assert.match(manifest.format, new RegExp(engine));
    assert.ok(artifacts.length > 0, `${engine} requires at least one adapter artifact`);
    assert.ok(artifacts.every((entry) => entry.path.startsWith(`${preset.outputDir}/`) && Buffer.isBuffer(entry.buffer)));
  }
});

test("Unity and FairyGUI artifacts preserve pivot and nine-slice contracts", () => {
  const unity = fixture("unity");
  const unityMeta = createEngineArtifacts(unity.project, unity.preset, unity.builtAssets)[0].buffer.toString();
  assert.match(unityMeta, /spritePivot: \{x: 0\.5, y: 0\.5\}/);
  assert.match(unityMeta, /spriteBorder: \{x: 4, y: 3, z: 4, w: 3\}/);

  const fgui = fixture("fgui");
  const packageXml = createEngineArtifacts(fgui.project, fgui.preset, fgui.builtAssets)[0].buffer.toString();
  assert.match(packageXml, /packageDescription id="A1B2C3D4"/);
  assert.match(packageXml, /scale="9grid"/);
});

test("multi-scale variants keep unique manifest entries", () => {
  for (const engine of ["generic", "unity", "laya", "fgui", "cocos", "godot", "pixi"]) {
    const { project, preset, builtAssets } = fixture(engine);
    const scaleTwo = { ...builtAssets[0], scale: 2, path: builtAssets[0].path.replace(".png", "@2x.png"), width: 64, height: 32 };
    const manifest = createEngineManifest(project, preset, [...builtAssets, scaleTwo]);
    const serialized = JSON.stringify(manifest);
    assert.match(serialized, /ui\.button@2x/, `${engine} must retain its @2x variant`);
    assert.match(serialized, /ui\.button/, `${engine} must retain its 1x variant`);
  }
});
