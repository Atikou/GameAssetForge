const fs = require("fs/promises");
const path = require("path");
const { runProcess } = require("../lib/process");
const { postProcessTextAssets } = require("./text-asset-postprocess");

const projectRoot = path.resolve(__dirname, "..", "..");
const externalRoot = path.join(projectRoot, "tools", "external");

const assetStudioExe = path.join(externalRoot, "assetstudio", "AssetStudio.CLI.exe");
const javaExe = path.join(externalRoot, "java", "jdk-17.0.19+10-jre", "bin", "java.exe");
const jadxJar = path.join(externalRoot, "jadx", "lib", "jadx-1.5.5-all.jar");
const cpp2ilExe = path.join(externalRoot, "cpp2il", "Cpp2IL.exe");

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function listFilesRecursive(dir) {
  const files = [];
  async function walk(current) {
    let entries = [];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }
  }
  await walk(dir);
  return files;
}

async function addDirectoryToZipAt(zip, dir, zipPrefix = "") {
  const files = await listFilesRecursive(dir);
  for (const file of files) {
    const relative = path.relative(dir, file).replace(/\\/g, "/");
    const name = [zipPrefix, relative].filter(Boolean).join("/");
    zip.file(name, await fs.readFile(file));
  }
  return files.length;
}

function relativeFiles(files, root) {
  return files.map((file) => path.relative(root, file).replace(/\\/g, "/"));
}

function countExtensions(files) {
  return files.reduce((acc, file) => {
    const extension = path.extname(file).toLowerCase() || "(no-ext)";
    acc[extension] = (acc[extension] || 0) + 1;
    return acc;
  }, {});
}

function firstPath(root, names, pattern) {
  const match = names.find((name) => pattern.test(name.replace(/\\/g, "/")));
  return match ? path.join(root, match) : "";
}

function toolStatus() {
  return {
    assetStudio: { path: assetStudioExe, available: false },
    java: { path: javaExe, available: false },
    jadx: { path: jadxJar, available: false },
    cpp2il: { path: cpp2ilExe, available: false },
  };
}

async function getRestoreToolStatus() {
  const status = toolStatus();
  await Promise.all(
    Object.values(status).map(async (entry) => {
      entry.available = await pathExists(entry.path);
    }),
  );
  return status;
}

function report(progress, update) {
  if (typeof progress !== "function") return;
  progress({ at: new Date().toISOString(), ...update });
}

function lastLine(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1);
}

async function runAssetStudioExport({ inputDir, outputDir, progress, timeoutMs, startPercent = 28, donePercent = 58 }) {
  if (!(await pathExists(assetStudioExe))) {
    return {
      ran: false,
      status: "missing",
      warning: `AssetStudio CLI not found: ${assetStudioExe}`,
      outputFileCount: 0,
    };
  }

  await fs.mkdir(outputDir, { recursive: true });
  const args = [
    inputDir,
    outputDir,
    "--game",
    "Normal",
    "--silent",
    "--types",
    "Texture2D",
    "Sprite",
    "AudioClip",
    "TextAsset",
    "Mesh",
    "--group_assets",
    "ByType",
    "--export_type",
    "Convert",
  ];

  report(progress, {
    percent: startPercent,
    phase: "assetstudio",
    message: "AssetStudio 正在导出贴图、音频、模型和文本资源...",
  });

  try {
    const result = await runProcess(assetStudioExe, args, {
      timeoutMs,
      onOutput: (text, stream) => {
        const line = lastLine(text);
        if (!line) return;
        report(progress, {
          percent: Math.min(donePercent - 4, startPercent + 10),
          phase: "assetstudio",
          message: `AssetStudio: ${line}`,
          detail: { stream },
        });
      },
    });
    const files = await listFilesRecursive(outputDir);
    report(progress, {
      percent: donePercent,
      phase: "assetstudio",
      message: `AssetStudio 资源导出完成，共 ${files.length} 个文件。`,
    });
    return {
      ran: true,
      status: "ok",
      executable: assetStudioExe,
      args,
      outputFileCount: files.length,
      outputByExtension: countExtensions(files),
      stdout: result.stdout.slice(-20000),
      stderr: result.stderr.slice(-20000),
    };
  } catch (error) {
    const files = await listFilesRecursive(outputDir);
    report(progress, {
      percent: donePercent,
      phase: "assetstudio",
      message: `AssetStudio 返回失败，但已回收 ${files.length} 个输出文件。`,
    });
    return {
      ran: false,
      status: "failed",
      executable: assetStudioExe,
      args,
      outputFileCount: files.length,
      outputByExtension: countExtensions(files),
      error: error.message,
      stdout: error.result?.stdout?.slice(-20000) || "",
      stderr: error.result?.stderr?.slice(-20000) || "",
    };
  }
}

async function runJadx({ apkPath, outputDir, progress, timeoutMs }) {
  const javaOk = await pathExists(javaExe);
  const jadxOk = await pathExists(jadxJar);
  if (!javaOk || !jadxOk) {
    return {
      ran: false,
      status: "missing",
      warning: `${!javaOk ? `Java not found: ${javaExe}` : ""}${!javaOk && !jadxOk ? "; " : ""}${!jadxOk ? `jadx not found: ${jadxJar}` : ""}`,
      outputFileCount: 0,
      javaFileCount: 0,
    };
  }

  await fs.mkdir(outputDir, { recursive: true });
  const args = [
    "-XX:+IgnoreUnrecognizedVMOptions",
    "-Xms256M",
    "-XX:MaxRAMPercentage=70.0",
    "-XX:ParallelGCThreads=3",
    "-Djdk.util.zip.disableZip64ExtraFieldValidation=true",
    "--enable-native-access=ALL-UNNAMED",
    "-cp",
    jadxJar,
    "jadx.cli.JadxCLI",
    "-d",
    outputDir,
    "--no-res",
    "--show-bad-code",
    "--deobf",
    "--threads-count",
    "4",
    apkPath,
  ];

  report(progress, {
    percent: 60,
    phase: "jadx",
    message: "jadx 正在反编译 Android Java/Dex 层...",
  });

  try {
    const result = await runProcess(javaExe, args, {
      timeoutMs,
      onOutput: (text, stream) => {
        const line = lastLine(text);
        if (!line) return;
        report(progress, {
          percent: 70,
          phase: "jadx",
          message: `jadx: ${line}`,
          detail: { stream },
        });
      },
    });
    const files = await listFilesRecursive(outputDir);
    return {
      ran: true,
      status: "ok",
      executable: javaExe,
      args,
      outputFileCount: files.length,
      javaFileCount: files.filter((file) => file.toLowerCase().endsWith(".java")).length,
      stdout: result.stdout.slice(-20000),
      stderr: result.stderr.slice(-20000),
    };
  } catch (error) {
    const files = await listFilesRecursive(outputDir);
    const javaFileCount = files.filter((file) => file.toLowerCase().endsWith(".java")).length;
    return {
      ran: javaFileCount > 0,
      status: javaFileCount > 0 ? "partial" : "failed",
      executable: javaExe,
      args,
      outputFileCount: files.length,
      javaFileCount,
      error: error.message,
      stdout: error.result?.stdout?.slice(-20000) || "",
      stderr: error.result?.stderr?.slice(-20000) || "",
    };
  }
}

async function runCpp2Il({ inputDir, il2cppPath, metadataPath, outputDir, progress, timeoutMs }) {
  if (!il2cppPath || !metadataPath) {
    const reason =
      !il2cppPath && !metadataPath
        ? "缺少 libil2cpp.so 和 global-metadata.dat，无法生成 IL2CPP Dummy DLL。"
        : !il2cppPath
          ? "缺少 libil2cpp.so，无法生成 IL2CPP Dummy DLL；如果是 App Bundle，请补充 native split APK。"
          : "缺少 global-metadata.dat，无法生成 IL2CPP Dummy DLL。";
    return {
      ran: false,
      status: "skipped",
      reason,
    };
  }
  if (!(await pathExists(cpp2ilExe))) {
    return {
      ran: false,
      status: "missing",
      warning: `Cpp2IL not found: ${cpp2ilExe}`,
    };
  }

  await fs.mkdir(outputDir, { recursive: true });
  const args = [
    "--game-path",
    inputDir,
    "--force-binary-path",
    il2cppPath,
    "--force-metadata-path",
    metadataPath,
    "--output-root",
    outputDir,
    "--skip-analysis",
    "--disable-registration-prompts",
  ];

  report(progress, {
    percent: 76,
    phase: "cpp2il",
    message: "Cpp2IL 正在尝试恢复 IL2CPP 类型结构...",
  });

  try {
    const result = await runProcess(cpp2ilExe, args, { timeoutMs });
    const files = await listFilesRecursive(outputDir);
    return {
      ran: true,
      status: "ok",
      executable: cpp2ilExe,
      args,
      outputFileCount: files.length,
      outputByExtension: countExtensions(files),
      stdout: result.stdout.slice(-20000),
      stderr: result.stderr.slice(-20000),
    };
  } catch (error) {
    const files = await listFilesRecursive(outputDir);
    return {
      ran: false,
      status: files.length ? "partial" : "failed",
      executable: cpp2ilExe,
      args,
      outputFileCount: files.length,
      outputByExtension: countExtensions(files),
      error: error.message,
      stdout: error.result?.stdout?.slice(-20000) || "",
      stderr: error.result?.stderr?.slice(-20000) || "",
    };
  }
}

async function writeText(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
}

async function copyIfExists(source, target) {
  if (!source || !(await pathExists(source))) return false;
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.copyFile(source, target);
  return true;
}

async function copyManagedDlls(unpackedDir, managedDlls, projectDir) {
  let count = 0;
  for (const dll of managedDlls || []) {
    const source = path.join(unpackedDir, dll);
    const target = path.join(projectDir, "Assets", "CodeRecovery", "Mono", path.basename(dll));
    if (await copyIfExists(source, target)) count += 1;
  }
  return count;
}

async function createUnityProjectSkeleton({ projectDir, sourceName, analysis, unpackedDir, assetExportDir, cpp2ilDir }) {
  const extractedDir = path.join(projectDir, "Assets", "Extracted");
  await fs.mkdir(path.dirname(extractedDir), { recursive: true });
  try {
    await fs.rm(extractedDir, { recursive: true, force: true });
    await fs.rename(assetExportDir, extractedDir);
  } catch {
    await fs.mkdir(extractedDir, { recursive: true });
  }

  await writeText(
    path.join(projectDir, "ProjectSettings", "ProjectVersion.txt"),
    ["m_EditorVersion: 2022.3.0f1", "m_EditorVersionWithRevision: 2022.3.0f1 (unknown)", ""].join("\n"),
  );

  await writeText(
    path.join(projectDir, "Packages", "manifest.json"),
    JSON.stringify(
      {
        dependencies: {
          "com.unity.2d.sprite": "1.0.0",
          "com.unity.textmeshpro": "3.0.6",
          "com.unity.timeline": "1.7.6",
          "com.unity.ugui": "1.0.0",
        },
      },
      null,
      2,
    ),
  );

  const metadataPath = firstPath(unpackedDir, analysis.metadataFiles || [], /global-metadata\.dat$/i);
  const metadataCopied = await copyIfExists(
    metadataPath,
    path.join(projectDir, "Assets", "CodeRecovery", "IL2CPP", "global-metadata.dat"),
  );
  const managedDllCount = await copyManagedDlls(unpackedDir, analysis.managedDlls || [], projectDir);

  if (cpp2ilDir && (await pathExists(cpp2ilDir))) {
    const target = path.join(projectDir, "Assets", "CodeRecovery", "IL2CPP", "Cpp2IL");
    await fs.mkdir(path.dirname(target), { recursive: true });
    try {
      await fs.rm(target, { recursive: true, force: true });
      await fs.rename(cpp2ilDir, target);
    } catch {
      await fs.mkdir(target, { recursive: true });
    }
  }

  await writeText(
    path.join(projectDir, "Assets", "CodeRecovery", "IL2CPP", "README_IL2CPP_LIMITATION.md"),
    [
      "# IL2CPP Code Recovery Notes",
      "",
      "This folder stores recoverable IL2CPP artifacts from the APK.",
      "",
      "- `global-metadata.dat` is metadata, not original C# source.",
      "- Dummy DLL/type recovery requires both `global-metadata.dat` and `libil2cpp.so`.",
      "- Android App Bundle builds often place `libil2cpp.so` in a native split APK such as `config.arm64_v8a.apk`.",
      "- Even with Cpp2IL output, original method bodies and project authoring data are not fully restorable.",
      "",
    ].join("\n"),
  );

  await writeText(
    path.join(projectDir, "README_RESTORED_PROJECT.md"),
    [
      "# Restored Unity Inspection Project",
      "",
      `Source APK: ${sourceName}`,
      "",
      "Open this folder with Unity 2022.3+ to inspect exported assets and recovered code artifacts.",
      "",
      "Important limits:",
      "",
      "- This is an inspection/reconstruction project, not the original development project.",
      "- `Assets/Extracted` contains converted assets exported by AssetStudio.",
      "- `Assets/CodeRecovery` contains metadata, Managed DLLs, or Cpp2IL output when available.",
      "- Scenes, Prefabs, MonoBehaviour scripts, build settings, and editor-only project data may be incomplete.",
      "",
    ].join("\n"),
  );

  return { metadataCopied, managedDllCount };
}

function buildReport({ sourceName, analysis, assetStudio, jadx, cpp2il, projectStats, warnings }) {
  return [
    "# Unity APK Reverse Report",
    "",
    `Source: ${sourceName}`,
    `Generated: ${new Date().toISOString()}`,
    "",
    "## APK Signals",
    "",
    `- Scripting backend: ${analysis.scriptingBackend || "Unknown"}`,
    `- assets/bin/Data files: ${analysis.unityDataFiles || 0}`,
    `- AssetBundle files: ${(analysis.assetBundles || []).length}`,
    `- global-metadata.dat files: ${(analysis.metadataFiles || []).length}`,
    `- libil2cpp.so files: ${(analysis.il2cppLibraries || []).length}`,
    `- Managed DLL files: ${(analysis.managedDlls || []).length}`,
    "",
    "## Outputs",
    "",
    `- Extracted Unity assets: ${assetStudio.outputFileCount || 0}`,
    `- Decompiled Android Java files: ${jadx.javaFileCount || 0}`,
    `- Cpp2IL output files: ${cpp2il.outputFileCount || 0}`,
    `- Unity project files: ${projectStats.fileCount || 0}`,
    "",
    "## Limitations",
    "",
    "- Converted resources are usable for inspection, but original import settings and authoring references can be incomplete.",
    "- IL2CPP builds cannot be restored to original C# source directly.",
    "- If this APK came from an Android App Bundle, native code may be in split APK files not present here.",
    "",
    warnings.length ? "## Warnings" : "",
    ...warnings.map((warning) => `- ${warning}`),
    "",
  ]
    .filter((line, index, arr) => line || arr[index - 1] !== "")
    .join("\n");
}

async function exportResourcesOnly({ outputZip, unpackedDir, progress, timeoutMs }) {
  const exportDir = path.join(path.dirname(unpackedDir), "assetstudio-output");
  const assetStudio = await runAssetStudioExport({
    inputDir: unpackedDir,
    outputDir: exportDir,
    progress,
    timeoutMs,
    startPercent: 34,
    donePercent: 78,
  });
  const textAssetPostProcess = await postProcessTextAssets(exportDir);
  const outputCount = await addDirectoryToZipAt(outputZip, exportDir, "tool-output");
  return { assetStudio: { ...assetStudio, outputFileCount: outputCount }, textAssetPostProcess };
}

async function restoreFullProject({ outputZip, apkPath, unpackedDir, analysis, sourceName, progress, timeoutMs }) {
  const rootDir = path.dirname(unpackedDir);
  const projectDir = path.join(rootDir, "UnityRestoredProject");
  const assetExportDir = path.join(rootDir, "assetstudio-output");
  const decompiledDir = path.join(rootDir, "Decompiled");
  const javaDir = path.join(decompiledDir, "AndroidJava");
  const cpp2ilTempDir = path.join(rootDir, "cpp2il-output");
  const warnings = [];

  const assetStudio = await runAssetStudioExport({
    inputDir: unpackedDir,
    outputDir: assetExportDir,
    progress,
    timeoutMs,
    startPercent: 28,
    donePercent: 55,
  });
  if (assetStudio.warning) warnings.push(assetStudio.warning);
  if (assetStudio.status === "failed") warnings.push("AssetStudio failed; project will contain any partial resources that were recovered.");
  const textAssetPostProcess = await postProcessTextAssets(assetExportDir);

  const jadx = await runJadx({ apkPath, outputDir: javaDir, progress, timeoutMs: Math.min(timeoutMs, 300000) });
  if (jadx.warning) warnings.push(jadx.warning);
  if (jadx.status === "partial") warnings.push("jadx reported errors but produced partial Java output.");
  if (jadx.status === "failed") warnings.push("jadx failed and no Java output was recovered.");

  const il2cppPath = firstPath(unpackedDir, analysis.il2cppLibraries || [], /^lib\/[^/]+\/libil2cpp\.so$/i);
  const metadataPath = firstPath(unpackedDir, analysis.metadataFiles || [], /global-metadata\.dat$/i);
  const cpp2il = await runCpp2Il({
    inputDir: unpackedDir,
    il2cppPath,
    metadataPath,
    outputDir: cpp2ilTempDir,
    progress,
    timeoutMs,
  });
  if (cpp2il.reason) warnings.push(cpp2il.reason);
  if (cpp2il.warning) warnings.push(cpp2il.warning);
  if (cpp2il.status === "failed" || cpp2il.status === "partial") warnings.push("Cpp2IL did not complete cleanly; check ReverseSummary.json for details.");

  report(progress, {
    percent: 82,
    phase: "project",
    message: "正在生成 Unity 可打开的工程骨架...",
  });
  const projectRecovery = await createUnityProjectSkeleton({
    projectDir,
    sourceName,
    analysis,
    unpackedDir,
    assetExportDir,
    cpp2ilDir: cpp2ilTempDir,
  });

  await writeText(
    path.join(decompiledDir, "README_ANDROID_JAVA.md"),
    [
      "# Android Java/Dex Layer",
      "",
      "This folder is generated by jadx from the APK dex files.",
      "",
      "For Unity IL2CPP games, gameplay code is usually native IL2CPP rather than Java.",
      "Java output mainly covers Android glue code, SDKs, plugins, launchers, and platform integrations.",
      "",
    ].join("\n"),
  );

  const projectFiles = await listFilesRecursive(projectDir);
  const javaFiles = await listFilesRecursive(javaDir);
  const summary = {
    source: sourceName,
    createdAt: new Date().toISOString(),
    mode: "full",
    outputs: {
      unityProjectRoot: "UnityRestoredProject/",
      androidJavaRoot: "Decompiled/AndroidJava/",
      report: "REVERSING_REPORT.md",
    },
    counts: {
      extractedAssets: assetStudio.outputFileCount || 0,
      generatedTextAssetFiles: textAssetPostProcess.created || 0,
      projectFiles: projectFiles.length,
      androidLayerTotalFiles: javaFiles.length,
      javaFiles: javaFiles.filter((file) => file.toLowerCase().endsWith(".java")).length,
      managedDllsCopied: projectRecovery.managedDllCount,
    },
    recovery: {
      metadataCopied: projectRecovery.metadataCopied,
      libil2cppFound: Boolean(il2cppPath),
      metadataFound: Boolean(metadataPath),
      scriptingBackend: analysis.scriptingBackend || "Unknown",
    },
    tools: { assetStudio, textAssetPostProcess, jadx, cpp2il },
    warnings,
  };

  const reportText = buildReport({
    sourceName,
    analysis,
    assetStudio,
    jadx,
    cpp2il,
    projectStats: { fileCount: projectFiles.length },
    warnings,
  });
  await writeText(path.join(rootDir, "REVERSING_REPORT.md"), reportText);
  await writeText(path.join(rootDir, "ReverseSummary.json"), JSON.stringify(summary, null, 2));

  report(progress, {
    percent: 88,
    phase: "collect",
    message: "正在收集 Unity 工程、Java 反编译结果和报告...",
  });
  const projectEntryCount = await addDirectoryToZipAt(outputZip, projectDir, "UnityRestoredProject");
  const javaEntryCount = await addDirectoryToZipAt(outputZip, decompiledDir, "Decompiled");
  outputZip.file("REVERSING_REPORT.md", reportText);
  outputZip.file("ReverseSummary.json", JSON.stringify(summary, null, 2));
  summary.zipEntries = {
    unityProject: projectEntryCount,
    decompiled: javaEntryCount,
  };
  return summary;
}

module.exports = {
  addDirectoryToZipAt,
  exportResourcesOnly,
  getRestoreToolStatus,
  restoreFullProject,
};
