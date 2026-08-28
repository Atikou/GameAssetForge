"use strict";

const path = require("path");
const JSZip = require("jszip");
const sharp = require("sharp");

const { trimTransparent } = require("../../server/tools/image");
const { buildPackedAtlasZip } = require("../../server/tools/atlas");
const { assertSafeRelativePath, sha256 } = require("../protocol");
const { ImageSpecError } = require("../core/errors");
const { findPreset } = require("../core/operations");
const { validateProjectFiles } = require("../validator");
const { createEngineArtifacts, createEngineManifest } = require("./exporters");

function outputName(fileName, scale, format) {
  const parsed = path.posix.parse(String(fileName).replaceAll("\\", "/"));
  const extension = format === "jpg" ? ".jpg" : `.${format}`;
  return `${parsed.name}${scale === 1 ? "" : `@${scale}x`}${extension}`;
}

async function encodeImage(buffer, format, options = {}) {
  let image = sharp(buffer, { animated: false });
  if (format === "webp") return image.webp({ quality: options.quality || 90, effort: 4 }).toBuffer();
  if (format === "jpg") return image.flatten({ background: options.background || "#000000" }).jpeg({ quality: options.quality || 90, mozjpeg: true }).toBuffer();
  return image.png().toBuffer();
}

async function prepareAssetImage(buffer, asset, preset, scale) {
  const policy = asset.exportPolicy;
  const sourceMetadata = await sharp(buffer, { animated: false }).metadata();
  const sourceWidth = sourceMetadata.width || asset.bounds.width;
  const sourceHeight = sourceMetadata.height || asset.bounds.height;
  let working = buffer;
  let trim = { x: 0, y: 0 };
  const warnings = [];
  if (policy.trimTransparent && asset.type !== "nineSlice" && !policy.preserveTransparentPadding) {
    const trimmed = await trimTransparent(working, { alphaThreshold: 1, padding: 0 });
    working = trimmed.output;
    trim = { x: trimmed.metadata.x, y: trimmed.metadata.y };
  } else if (policy.trimTransparent && asset.type === "nineSlice") {
    warnings.push(`nineSlice asset ${asset.id} was not trimmed because its borders use source coordinates.`);
  }
  if (policy.padding > 0) {
    working = await sharp(working)
      .extend({ top: policy.padding, bottom: policy.padding, left: policy.padding, right: policy.padding, background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
  }
  if (scale !== 1) {
    const metadata = await sharp(working).metadata();
    working = await sharp(working)
      .resize(Math.max(1, Math.round((metadata.width || 1) * scale)), Math.max(1, Math.round((metadata.height || 1) * scale)), {
        kernel: preset.options.pixelArt ? sharp.kernel.nearest : sharp.kernel.lanczos3,
      })
      .png()
      .toBuffer();
  }
  const format = policy.format || preset.format;
  const output = await encodeImage(working, format, preset.options);
  const metadata = await sharp(output).metadata();
  const originalPivot = {
    x: sourceWidth * policy.pivot.x,
    y: sourceHeight * policy.pivot.y,
  };
  const outputPivot = {
    x: Math.max(0, Math.min(1, ((originalPivot.x - trim.x + policy.padding) * scale) / (metadata.width || 1))),
    y: Math.max(0, Math.min(1, ((originalPivot.y - trim.y + policy.padding) * scale) / (metadata.height || 1))),
  };
  const nineSlice = policy.nineSlice
    ? {
        left: Math.round((policy.nineSlice.left + policy.padding) * scale),
        right: Math.round((policy.nineSlice.right + policy.padding) * scale),
        top: Math.round((policy.nineSlice.top + policy.padding) * scale),
        bottom: Math.round((policy.nineSlice.bottom + policy.padding) * scale),
      }
    : null;
  return {
    output,
    format,
    width: metadata.width || 1,
    height: metadata.height || 1,
    pivot: outputPivot,
    nineSlice,
    trim,
    warnings,
  };
}

async function buildProjectOutputs(projectDir, project, presetId, context = {}) {
  const preset = findPreset(project, presetId);
  const readFile = context.readFile;
  if (!readFile) throw new ImageSpecError("IMAGESPEC_BUILDER_READ_REQUIRED", "Builder requires readFile().");
  const validation = await validateProjectFiles(projectDir, project, { readFile, forBuild: true });
  if (!validation.ok) throw new ImageSpecError("IMAGESPEC_BUILD_VALIDATION_FAILED", "Project is not valid for build.", validation);
  const generatedFiles = [];
  const outputFiles = [];
  const builtAssets = [];
  const warnings = [];
  const outputDir = assertSafeRelativePath(preset.outputDir);

  const stageOutput = (relativePath, buffer, mimeType, role) => {
    const safePath = assertSafeRelativePath(relativePath);
    const contents = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
    context.transaction.stageWrite(safePath, contents);
    const record = { path: safePath, sha256: sha256(contents), size: contents.length, mimeType, role };
    generatedFiles.push(record);
    outputFiles.push({ record, buffer: contents });
    return record;
  };

  for (const asset of project.assetGraph.nodes.filter((candidate) => candidate.exportPolicy.enabled)) {
    if (!asset.source.path) throw new ImageSpecError("IMAGESPEC_BUILD_SOURCE_MISSING", `Exportable asset has no source: ${asset.id}`, { assetId: asset.id });
    const source = await readFile(asset.source.path);
    for (const scale of [...new Set([...(preset.scales || [1]), ...(asset.exportPolicy.scales || [1])])].sort((a, b) => a - b)) {
      const prepared = await prepareAssetImage(source, asset, preset, scale);
      const relativePath = assertSafeRelativePath(`${outputDir}/assets/${outputName(asset.exportPolicy.fileName, scale, prepared.format)}`);
      const record = stageOutput(relativePath, prepared.output, prepared.format === "jpg" ? "image/jpeg" : `image/${prepared.format}`, "build");
      builtAssets.push({
        assetId: asset.id,
        scale,
        path: relativePath,
        width: prepared.width,
        height: prepared.height,
        pivot: prepared.pivot,
        nineSlice: prepared.nineSlice,
        trim: prepared.trim,
        fileRecord: record,
        buffer: prepared.output,
      });
      warnings.push(...prepared.warnings);
    }
  }

  let atlas = null;
  if (preset.atlas.enabled && builtAssets.length) {
    const scaleGroups = new Map();
    builtAssets.forEach((entry) => scaleGroups.set(entry.scale, [...(scaleGroups.get(entry.scale) || []), entry]));
    const variants = [];
    for (const [scale, entries] of [...scaleGroups.entries()].sort(([a], [b]) => a - b)) {
      const zip = await buildPackedAtlasZip(
        entries.map((entry) => ({ originalname: `${entry.assetId}.png`, buffer: entry.buffer })),
        {
          padding: preset.atlas.padding,
          extrude: preset.atlas.extrude,
          maxSize: preset.atlas.maxSize,
          trim: false,
          powerOfTwo: preset.atlas.powerOfTwo,
          engine: preset.engine === "laya" || preset.engine === "fgui" ? "generic" : preset.engine,
        },
      );
      const atlasPng = await zip.file("atlas.png").async("nodebuffer");
      const atlasJson = await zip.file("atlas.json").async("nodebuffer");
      const suffix = scale === 1 ? "" : `@${scale}x`;
      const atlasPath = `${outputDir}/atlas/atlas${suffix}.png`;
      const atlasJsonPath = `${outputDir}/atlas/atlas${suffix}.json`;
      stageOutput(atlasPath, atlasPng, "image/png", "atlas");
      stageOutput(atlasJsonPath, atlasJson, "application/json", "atlas");
      if (preset.engine === "laya") stageOutput(`${outputDir}/atlas/atlas${suffix}.atlas`, atlasJson, "application/json", "laya-atlas");
      variants.push({ scale, image: atlasPath, manifest: atlasJsonPath });
    }
    const primary = variants.find((entry) => entry.scale === 1) || variants[0];
    atlas = { image: primary.image, manifest: primary.manifest, variants };
  }

  const manifest = createEngineManifest(project, preset, builtAssets);
  manifest.atlas = atlas;
  const manifestBuffer = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  const manifestPath = `${outputDir}/${preset.engine}-manifest.json`;
  stageOutput(manifestPath, manifestBuffer, "application/json", "manifest");
  for (const artifact of createEngineArtifacts(project, preset, builtAssets)) {
    stageOutput(artifact.path, artifact.buffer, artifact.mimeType, artifact.role);
  }
  return { preset, builtAssets, generatedFiles, outputFiles, manifest, warnings };
}

async function exportProjectArchive(projectDir, project, presetId, destinationPath, context = {}) {
  const build = await buildProjectOutputs(projectDir, project, presetId, context);
  const safeDestination = assertSafeRelativePath(destinationPath);
  if (!safeDestination.startsWith("build/")) throw new ImageSpecError("IMAGESPEC_EXPORT_PATH_INVALID", "Project export archive must be written below build/.", { destinationPath: safeDestination });
  const zip = new JSZip();
  for (const entry of build.outputFiles) zip.file(entry.record.path, entry.buffer);
  const archive = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  context.transaction.stageWrite(safeDestination, archive);
  const fileRecord = { path: safeDestination, sha256: sha256(archive), size: archive.length, mimeType: "application/zip", role: "export" };
  return { ...build, archive, archiveRecord: fileRecord, generatedFiles: [...build.generatedFiles, fileRecord] };
}

module.exports = {
  outputName,
  encodeImage,
  prepareAssetImage,
  buildProjectOutputs,
  exportProjectArchive,
};
