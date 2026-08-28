"use strict";

const crypto = require("crypto");

function normalizeFileName(value) {
  return String(value).replaceAll("\\", "/").split("/").pop();
}

function xmlEscape(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function deterministicHex(...parts) {
  return crypto.createHash("sha256").update(parts.join("\u0000")).digest("hex");
}

function variantName(assetId, scale) {
  return scale === 1 ? assetId : `${assetId}@${scale}x`;
}

function baseAssetEntry(asset, built, variants = built ? [built] : []) {
  return {
    id: asset.id,
    name: asset.name,
    type: asset.type,
    parentId: asset.parentId,
    zIndex: asset.zIndex,
    bounds: asset.bounds,
    transform: asset.transform,
    file: built?.path || null,
    width: built?.width || asset.bounds.width,
    height: built?.height || asset.bounds.height,
    pivot: built?.pivot || asset.exportPolicy.pivot,
    nineSlice: built?.nineSlice || asset.exportPolicy.nineSlice,
    variants: variants.map((entry) => ({
      name: variantName(asset.id, entry.scale),
      scale: entry.scale,
      file: entry.path,
      width: entry.width,
      height: entry.height,
      pivot: entry.pivot,
      nineSlice: entry.nineSlice,
    })),
  };
}

function genericManifest(project, preset, builtAssets) {
  const byId = new Map();
  builtAssets.forEach((entry) => byId.set(entry.assetId, [...(byId.get(entry.assetId) || []), entry]));
  return {
    format: "imagespec-generic-1",
    projectId: project.projectId,
    revision: project.revision,
    canvas: project.canvas,
    preset: { id: preset.id, engine: preset.engine },
    assets: project.assetGraph.nodes.map((asset) => {
      const variants = byId.get(asset.id) || [];
      return baseAssetEntry(asset, variants.find((entry) => entry.scale === 1) || variants[0], variants);
    }),
  };
}

function unityManifest(project, preset, builtAssets) {
  return {
    format: "imagespec-unity-1",
    projectId: project.projectId,
    colorSpace: "sRGB",
    alphaMode: "straight",
    sprites: builtAssets.map((built) => ({
      name: variantName(built.assetId, built.scale),
      assetId: built.assetId,
      scale: built.scale,
      file: built.path,
      rect: { x: 0, y: 0, width: built.width, height: built.height },
      pivot: built.pivot,
      border: built.nineSlice || { left: 0, right: 0, top: 0, bottom: 0 },
      pixelsPerUnit: preset.options.pixelsPerUnit || 100,
    })),
  };
}

function layaManifest(project, preset, builtAssets) {
  return {
    format: "imagespec-laya-1",
    projectId: project.projectId,
    assets: Object.fromEntries(
      builtAssets.map((built) => [
        variantName(built.assetId, built.scale),
        {
          assetId: built.assetId,
          scale: built.scale,
          url: built.path,
          width: built.width,
          height: built.height,
          pivotX: built.pivot.x,
          pivotY: built.pivot.y,
          sizeGrid: built.nineSlice
            ? [built.nineSlice.top, built.nineSlice.right, built.nineSlice.bottom, built.nineSlice.left]
            : null,
        },
      ]),
    ),
  };
}

function fguiManifest(project, preset, builtAssets) {
  return {
    format: "imagespec-fgui-1",
    projectId: project.projectId,
    packageName: preset.options.packageName || project.name,
    packageId: preset.options.packageId || project.projectId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 8).padEnd(8, "0"),
    resources: builtAssets.map((built, index) => ({
      id: String(index + 1).padStart(8, "0"),
      name: variantName(built.assetId, built.scale),
      assetId: built.assetId,
      scale: built.scale,
      file: built.path,
      width: built.width,
      height: built.height,
      pivot: built.pivot,
      scale9grid: built.nineSlice || null,
    })),
  };
}

function cocosManifest(project, preset, builtAssets) {
  return {
    format: "imagespec-cocos-1",
    projectId: project.projectId,
    sprites: builtAssets.map((built) => ({
      name: variantName(built.assetId, built.scale),
      assetId: built.assetId,
      scale: built.scale,
      texture: built.path,
      rect: [0, 0, built.width, built.height],
      pivot: [built.pivot.x, built.pivot.y],
      border: built.nineSlice || null,
    })),
  };
}

function godotManifest(project, preset, builtAssets) {
  return {
    format: "imagespec-godot-1",
    projectId: project.projectId,
    textures: builtAssets.map((built) => ({
      name: variantName(built.assetId, built.scale),
      assetId: built.assetId,
      scale: built.scale,
      path: built.path,
      size: [built.width, built.height],
      pivot: [built.pivot.x, built.pivot.y],
      patchMargin: built.nineSlice || null,
    })),
  };
}

function pixiManifest(project, preset, builtAssets) {
  return {
    format: "imagespec-pixi-1",
    projectId: project.projectId,
    textures: Object.fromEntries(
      builtAssets.map((built) => [
        variantName(built.assetId, built.scale),
        { assetId: built.assetId, scale: built.scale, image: built.path, frame: { x: 0, y: 0, w: built.width, h: built.height }, anchor: built.pivot },
      ]),
    ),
  };
}

const EXPORTERS = {
  generic: genericManifest,
  unity: unityManifest,
  laya: layaManifest,
  fgui: fguiManifest,
  cocos: cocosManifest,
  godot: godotManifest,
  pixi: pixiManifest,
};

function createEngineManifest(project, preset, builtAssets) {
  return (EXPORTERS[preset.engine] || genericManifest)(project, preset, builtAssets);
}

function jsonArtifact(path, value, role = "engine-adapter") {
  return {
    path,
    buffer: Buffer.from(`${JSON.stringify(value, null, 2)}\n`),
    mimeType: "application/json",
    role,
  };
}

function unityArtifacts(project, preset, builtAssets) {
  return builtAssets.map((built) => {
    const border = built.nineSlice || { left: 0, right: 0, top: 0, bottom: 0 };
    const guid = deterministicHex(project.projectId, built.assetId, built.scale, built.path).slice(0, 32);
    const meta = [
      "fileFormatVersion: 2",
      `guid: ${guid}`,
      "TextureImporter:",
      "  internalIDToNameTable: []",
      "  externalObjects: {}",
      "  serializedVersion: 13",
      "  mipmaps:",
      "    enableMipMap: 0",
      "  isReadable: 0",
      "  sRGBTexture: 1",
      "  alphaIsTransparency: 1",
      "  textureType: 8",
      "  spriteMode: 1",
      `  spritePixelsToUnits: ${preset.options.pixelsPerUnit || 100}`,
      `  spritePivot: {x: ${built.pivot.x}, y: ${built.pivot.y}}`,
      `  spriteBorder: {x: ${border.left}, y: ${border.bottom}, z: ${border.right}, w: ${border.top}}`,
      "  spriteGenerateFallbackPhysicsShape: 0",
      "  alphaUsage: 1",
      "  textureShape: 1",
      "  platformSettings: []",
      "  userData: ImageSpec",
      "  assetBundleName: ",
      "  assetBundleVariant: ",
      "",
    ].join("\n");
    return { path: `${built.path}.meta`, buffer: Buffer.from(meta), mimeType: "text/yaml", role: "unity-meta" };
  });
}

function layaArtifacts(project, preset, builtAssets) {
  return [
    jsonArtifact("adapter/laya.resources.json", {
      type: "ImageSpecLayaResourceMap",
      version: 1,
      projectId: project.projectId,
      resources: builtAssets.map((built) => ({
        id: variantName(built.assetId, built.scale),
        assetId: built.assetId,
        scale: built.scale,
        url: built.path,
        width: built.width,
        height: built.height,
        pivot: built.pivot,
        sizeGrid: built.nineSlice ? `${built.nineSlice.top},${built.nineSlice.right},${built.nineSlice.bottom},${built.nineSlice.left}` : null,
      })),
    }),
  ];
}

function fguiArtifacts(project, preset, builtAssets) {
  const packageId = preset.options.packageId || project.projectId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 8).padEnd(8, "0");
  const packageName = preset.options.packageName || project.name;
  const resources = builtAssets.map((built, index) => {
    const resourceId = String(index + 1).padStart(8, "0");
    const fileName = normalizeFileName(built.path);
    const scale = built.nineSlice
      ? ` scale="9grid" scale9grid="${built.nineSlice.left},${built.nineSlice.top},${Math.max(1, built.width - built.nineSlice.left - built.nineSlice.right)},${Math.max(1, built.height - built.nineSlice.top - built.nineSlice.bottom)}"`
      : "";
    return `    <image id="${resourceId}" name="${xmlEscape(variantName(built.assetId, built.scale))}" path="/" file="${xmlEscape(fileName)}" size="${built.width},${built.height}"${scale}/>`;
  });
  const xml = [
    '<?xml version="1.0" encoding="utf-8"?>',
    `<packageDescription id="${xmlEscape(packageId)}" name="${xmlEscape(packageName)}">`,
    "  <publish name=\"res\"/>",
    "  <resources>",
    ...resources,
    "  </resources>",
    "</packageDescription>",
    "",
  ].join("\n");
  return [{ path: "assets/package.xml", buffer: Buffer.from(xml), mimeType: "application/xml", role: "fgui-package" }];
}

function cocosArtifacts(project, preset, builtAssets) {
  return [
    jsonArtifact("adapter/cocos.sprite-frames.json", {
      __type__: "ImageSpecCocosSpriteFrames",
      projectId: project.projectId,
      frames: builtAssets.map((built) => ({
        name: variantName(built.assetId, built.scale),
        assetId: built.assetId,
        scale: built.scale,
        uuid: deterministicHex(project.projectId, built.assetId, built.scale).slice(0, 32),
        texture: built.path,
        rect: { x: 0, y: 0, width: built.width, height: built.height },
        pivot: built.pivot,
        border: built.nineSlice || { left: 0, right: 0, top: 0, bottom: 0 },
      })),
    }),
  ];
}

function godotArtifacts(project, preset, builtAssets) {
  const lines = [
    "; Generated by GameAssetForge ImageSpec. Copy this file with the exported assets into a Godot project.",
    "class_name ImageSpecAssets",
    "",
    `const PROJECT_ID := ${JSON.stringify(project.projectId)}`,
    "const TEXTURES := {",
    ...builtAssets.map((built) => `  ${JSON.stringify(variantName(built.assetId, built.scale))}: ${JSON.stringify(built.path)},`),
    "}",
    "",
  ];
  return [{ path: "adapter/imagespec_assets.gd", buffer: Buffer.from(lines.join("\n")), mimeType: "text/plain", role: "godot-script" }];
}

function pixiArtifacts(project, preset, builtAssets) {
  return [
    jsonArtifact("adapter/pixi.assets.json", {
      bundles: [
        {
          name: preset.options.bundleName || project.projectId,
          assets: builtAssets.map((built) => ({ alias: variantName(built.assetId, built.scale), src: built.path, data: { assetId: built.assetId, scale: built.scale, anchor: built.pivot, nineSlice: built.nineSlice || null } })),
        },
      ],
    }),
  ];
}

const ARTIFACT_EXPORTERS = {
  unity: unityArtifacts,
  laya: layaArtifacts,
  fgui: fguiArtifacts,
  cocos: cocosArtifacts,
  godot: godotArtifacts,
  pixi: pixiArtifacts,
};

function createEngineArtifacts(project, preset, builtAssets) {
  const create = ARTIFACT_EXPORTERS[preset.engine];
  if (!create) return [];
  return create(project, preset, builtAssets).map((artifact) => ({
    ...artifact,
    path: artifact.path.startsWith(`${preset.outputDir}/`) ? artifact.path : `${preset.outputDir}/${artifact.path}`,
  }));
}

module.exports = {
  baseAssetEntry,
  genericManifest,
  unityManifest,
  layaManifest,
  fguiManifest,
  cocosManifest,
  godotManifest,
  pixiManifest,
  createEngineManifest,
  createEngineArtifacts,
  deterministicHex,
  variantName,
};
