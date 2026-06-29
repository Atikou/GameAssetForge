const fs = require("fs/promises");
const path = require("path");
const JSZip = require("jszip");
const { parseNumber, parseBoolean, safeBaseName } = require("../lib/common");
const { withTempDir } = require("../lib/process");
const { getUnityToolchainStatus: getLegacyUnityToolchainStatus } = require("./unity-adapters");
const {
  addDirectoryToZipAt,
  exportResourcesOnly,
  getRestoreToolStatus,
  restoreFullProject,
} = require("./unity-restore-pipeline");

function normalizeZipEntryName(name) {
  return String(name || "")
    .replace(/\\/g, "/")
    .split("/")
    .filter((part) => part && part !== "." && part !== "..")
    .join("/");
}

function isUnityApkEntry(name) {
  const normalized = normalizeZipEntryName(name);
  const lower = normalized.toLowerCase();
  if (!normalized) return false;
  if (["androidmanifest.xml", "resources.arsc"].includes(lower)) return true;
  if (lower.startsWith("assets/bin/data/")) return true;
  if (lower.startsWith("assets/assetbundles/")) return true;
  if (lower.startsWith("assets/streamingassets/")) return true;
  if (/^lib\/[^/]+\/libil2cpp\.so$/.test(lower)) return true;
  if (/^lib\/[^/]+\/libunity\.so$/.test(lower)) return true;
  if (/\.(assets|bundle|unity3d|resource|ress|ress)$/i.test(normalized)) return true;
  if (/global-metadata\.dat$/i.test(normalized)) return true;
  return false;
}

function analyzeUnityApkEntries(names) {
  const files = names.map(normalizeZipEntryName).filter(Boolean);
  const lowerFiles = files.map((name) => name.toLowerCase());
  const startsWith = (prefix) => lowerFiles.filter((name) => name.startsWith(prefix));
  const contains = (pattern) => files.filter((name) => pattern.test(name));
  const assetFiles = contains(/\.(assets|sharedassets\d*\.assets)$/i);
  const assetBundles = files.filter((name) => {
    const lower = name.toLowerCase();
    return lower.startsWith("assets/assetbundles/") || lower.includes("/assetbundles/") || /\.(bundle|unity3d|ab)$/i.test(name);
  });
  const resourceFiles = contains(/\.(resource|ress|ress)$/i);
  const managedDlls = contains(/^assets\/bin\/data\/managed\/.+\.dll$/i);
  const il2cppLibraries = contains(/^lib\/[^/]+\/libil2cpp\.so$/i);
  const unityLibraries = contains(/^lib\/[^/]+\/libunity\.so$/i);
  const metadataFiles = contains(/global-metadata\.dat$/i);
  const sceneFiles = files.filter((name) => /^assets\/bin\/data\/level\d+$/i.test(name) || /\.unity$/i.test(name));

  return {
    isUnityLike:
      lowerFiles.some((name) => name.startsWith("assets/bin/data/")) ||
      il2cppLibraries.length > 0 ||
      unityLibraries.length > 0 ||
      managedDlls.length > 0 ||
      metadataFiles.length > 0 ||
      assetFiles.length > 0 ||
      assetBundles.length > 0 ||
      sceneFiles.length > 0,
    fileCount: files.length,
    unityDataFiles: startsWith("assets/bin/data/").length,
    streamingAssets: startsWith("assets/streamingassets/").length,
    assetFiles,
    assetBundles,
    resourceFiles,
    sceneFiles,
    managedDlls,
    il2cppLibraries,
    unityLibraries,
    metadataFiles,
    scriptingBackend: il2cppLibraries.length || metadataFiles.length ? "IL2CPP" : managedDlls.length ? "Mono" : "Unknown",
  };
}

function normalizeMode(mode) {
  const value = String(mode || "resources").toLowerCase();
  if (value === "assets") return "resources";
  if (value === "project" || value === "code") return "full";
  if (value === "raw") return "raw";
  return ["resources", "full"].includes(value) ? value : "resources";
}

function modeLabel(mode) {
  if (mode === "full") return "导出全部并复原为 Unity 可打开结构";
  if (mode === "raw") return "仅导出 APK 内 Unity 原始结构";
  return "只导出资源";
}

async function writeZipEntriesToDir(zip, dir, names) {
  for (const name of names) {
    const normalized = normalizeZipEntryName(name);
    const entry = normalized && zip.file(normalized);
    if (!entry) continue;
    const outputPath = path.join(dir, normalized);
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, await entry.async("nodebuffer"));
  }
}

async function addRawUnityEntries(output, sourceZip, unityNames, progress) {
  for (let index = 0; index < unityNames.length; index += 1) {
    const name = unityNames[index];
    const entry = sourceZip.file(name);
    if (entry) output.file(`apk-unity-data/${normalizeZipEntryName(name)}`, await entry.async("nodebuffer"));
    if (index % 50 === 0 || index === unityNames.length - 1) {
      reportProgress(progress, {
        percent: Math.min(32, 16 + Math.round(((index + 1) / Math.max(unityNames.length, 1)) * 16)),
        phase: "raw",
        message: `正在导出 Unity 原始结构 ${index + 1}/${unityNames.length}`,
      });
    }
  }
}

function reportProgress(progress, update) {
  if (typeof progress !== "function") return;
  progress({
    at: new Date().toISOString(),
    ...update,
  });
}

async function inspectUnityApk(file) {
  const zip = await JSZip.loadAsync(file.buffer);
  const allNames = Object.keys(zip.files).filter((name) => !zip.files[name].dir);
  const unityNames = allNames.filter(isUnityApkEntry);
  const analysis = analyzeUnityApkEntries(allNames);
  const warnings = [];
  const notes = [];

  if (!analysis.isUnityLike) {
    warnings.push("未检测到典型 Unity APK 结构。");
  }
  if (analysis.metadataFiles.length && !analysis.il2cppLibraries.length) {
    notes.push("检测到 IL2CPP metadata，但当前 APK 内没有 libil2cpp.so；如果需要 Cpp2IL 类型恢复，请同时导入包含 native library 的 split APK。");
  }
  if (analysis.isUnityLike && !analysis.assetFiles.length && !analysis.assetBundles.length && !analysis.unityDataFiles) {
    notes.push("Unity 信号较弱，建议确认 APK 是否为完整包。");
  }

  return {
    source: file.originalname,
    size: file.size || file.buffer.length,
    createdAt: new Date().toISOString(),
    isUnityLike: analysis.isUnityLike,
    canExtract: analysis.isUnityLike,
    unityFileCount: analysis.isUnityLike ? unityNames.length : 0,
    analysis,
    warnings,
    notes,
    nextAction: analysis.isUnityLike ? "可以继续执行资源提取或完整复原。" : "已阻止工具链执行，请选择 Unity Android APK。",
  };
}

async function getUnityToolchainStatus() {
  return {
    ...getLegacyUnityToolchainStatus(),
    restorePipeline: await getRestoreToolStatus(),
  };
}

async function buildUnityApkExtractZip(file, body = {}, progress) {
  const mode = normalizeMode(body.mode);
  const includeRaw = parseBoolean(body.includeRaw, false);
  const timeoutMs = parseNumber(body.timeoutMs, 600000, 10000, 30 * 60 * 1000);
  const output = new JSZip();

  reportProgress(progress, { percent: 4, phase: "read", message: "正在解析 APK/ZIP 文件结构..." });
  const zip = await JSZip.loadAsync(file.buffer);
  const allNames = Object.keys(zip.files).filter((name) => !zip.files[name].dir);
  const unityNames = allNames.filter(isUnityApkEntry);
  const analysis = analyzeUnityApkEntries(allNames);
  const restoreToolchain = await getRestoreToolStatus();
  const manifest = {
    source: file.originalname,
    mode,
    modeLabel: modeLabel(mode),
    createdAt: new Date().toISOString(),
    analysis,
    toolchain: await getUnityToolchainStatus(),
    restoreToolchain,
    rawExport: {
      included: includeRaw || mode === "raw",
      fileCount: includeRaw || mode === "raw" ? unityNames.length : 0,
      root: "apk-unity-data/",
    },
    resourceExport: null,
    restoreSummary: null,
    warnings: [],
  };

  reportProgress(progress, {
    percent: 12,
    phase: "analyze",
    message: analysis.isUnityLike ? "已识别 Unity APK 结构。" : "未识别到 Unity APK 结构，已跳过工具链。",
    detail: {
      fileCount: allNames.length,
      unityFileCount: analysis.isUnityLike ? unityNames.length : 0,
      unityDataFiles: analysis.unityDataFiles,
      assetBundles: analysis.assetBundles.length,
      metadataFiles: analysis.metadataFiles.length,
    },
  });

  if (!analysis.isUnityLike) {
    manifest.warnings.push("未检测到典型 Unity APK 结构，请确认输入文件是否为 Unity Android 包。");
    output.file("manifest.json", JSON.stringify(manifest, null, 2));
    return output;
  }

  if (manifest.rawExport.included) {
    reportProgress(progress, { percent: 16, phase: "raw", message: `正在导出 APK 内 Unity 原始结构，共 ${unityNames.length} 个文件...` });
    await addRawUnityEntries(output, zip, unityNames, progress);
  }

  if (mode === "raw") {
    output.file("manifest.json", JSON.stringify(manifest, null, 2));
    return output;
  }

  await withTempDir(async (dir) => {
    const apkPath = path.join(dir, `${safeBaseName(file.originalname, "game")}.apk`);
    const unpackedDir = path.join(dir, "apk-unpacked");
    await fs.writeFile(apkPath, file.buffer);
    await fs.mkdir(unpackedDir, { recursive: true });

    reportProgress(progress, { percent: 22, phase: "unpack", message: "正在完整解包 APK，供 AssetStudio / jadx 扫描..." });
    await writeZipEntriesToDir(zip, unpackedDir, allNames);

    if (mode === "resources") {
      const resourceResult = await exportResourcesOnly({
        outputZip: output,
        unpackedDir,
        progress,
        timeoutMs,
      });
      manifest.resourceExport = resourceResult.assetStudio;
      manifest.textAssetPostProcess = resourceResult.textAssetPostProcess;
      if (resourceResult.assetStudio.warning) manifest.warnings.push(resourceResult.assetStudio.warning);
      if (resourceResult.assetStudio.status === "failed") manifest.warnings.push("AssetStudio 执行失败，ZIP 中只包含已回收的部分输出。");
      return;
    }

    manifest.restoreSummary = await restoreFullProject({
      outputZip: output,
      apkPath,
      unpackedDir,
      analysis,
      sourceName: file.originalname,
      body,
      progress,
      timeoutMs,
    });
    manifest.warnings.push(...(manifest.restoreSummary.warnings || []));
  });

  reportProgress(progress, { percent: 90, phase: "manifest", message: "正在写入 manifest.json..." });
  output.file("manifest.json", JSON.stringify(manifest, null, 2));
  return output;
}

module.exports = {
  inspectUnityApk,
  buildUnityApkExtractZip,
  getUnityToolchainStatus,
  addDirectoryToZipAt,
};
