const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..", "..", "..");
const externalRoot = path.join(projectRoot, "tools", "external");

const toolDefinitions = {
  assetripper: {
    label: "AssetRipper",
    purpose: "按引用结构还原 Unity 工程、场景、Prefab 和资源关系。",
    envPath: "GAF_ASSETRIPPER_PATH",
    envArgs: "GAF_ASSETRIPPER_ARGS",
    envCommand: "GAF_ASSETRIPPER_COMMAND",
    dir: "assetripper",
    candidates: ["AssetRipper.CLI.exe", "AssetRipper.exe", "AssetRipper.GUI.Free.exe"],
    quickArgs: [],
    manual: true,
    manualReason: "当前 AssetRipper 官方 Windows 包主要以 Web/GUI sidecar 运行；快速模式不会自动等待其导出工程。可在专家模式提供可退出的命令模板。",
    accepts: ["project", "assets"],
  },
  assetstudio: {
    label: "Razviar / AssetStudio",
    purpose: "快速浏览和导出贴图、音频、模型、文本等资源。",
    envPath: "GAF_ASSETSTUDIO_PATH",
    envArgs: "GAF_ASSETSTUDIO_ARGS",
    envCommand: "GAF_ASSETSTUDIO_COMMAND",
    dir: "assetstudio",
    candidates: ["AssetStudio.CLI.exe", "AssetStudioModCLI.exe", "AssetStudioCLI.exe", "AssetStudio.exe"],
    quickArgs: [
      '"{inputDir}"',
      '"{output}"',
      "--game",
      "Normal",
      "--silent",
      "--types",
      "Texture2D",
      "Sprite",
      "AudioClip",
      "TextAsset",
      "Mesh",
    ],
    accepts: ["assets"],
  },
  cpp2il: {
    label: "Cpp2IL",
    purpose: "分析 IL2CPP metadata、恢复类型信息和 Dummy DLL。",
    envPath: "GAF_CPP2IL_PATH",
    envArgs: "GAF_CPP2IL_ARGS",
    envCommand: "GAF_CPP2IL_COMMAND",
    dir: "cpp2il",
    candidates: ["Cpp2IL.exe"],
    quickArgs: [
      "--game-path",
      '"{inputDir}"',
      "--force-binary-path",
      '"{il2cppPath}"',
      "--force-metadata-path",
      '"{metadataPath}"',
      "--output-root",
      '"{output}"',
      "--skip-analysis",
      "--disable-registration-prompts",
    ],
    accepts: ["code"],
  },
  unitypy: {
    label: "UnityPy",
    purpose: "Python 批量自动化提取贴图、音频、Mesh、文本等资源。",
    envPath: "GAF_UNITYPY_PYTHON",
    envArgs: "GAF_UNITYPY_ARGS",
    envCommand: "GAF_UNITYPY_COMMAND",
    dir: "unitypy",
    candidates: [path.join(".venv", "Scripts", "python.exe"), "python.exe"],
    quickArgs: ['"{script}"', '"{inputDir}"', '"{output}"', "--types", '"{assetTypes}"'],
    accepts: ["assets"],
    script: path.join(externalRoot, "unitypy", "export_unitypy.py"),
  },
};

function fileExists(filePath) {
  try {
    return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function splitCommandLine(command) {
  const args = [];
  let current = "";
  let quote = "";
  for (const char of String(command || "")) {
    if ((char === '"' || char === "'") && !quote) {
      quote = char;
      continue;
    }
    if (char === quote) {
      quote = "";
      continue;
    }
    if (/\s/.test(char) && !quote) {
      if (current) args.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  if (current) args.push(current);
  return args;
}

function fillCommandTemplate(template, values) {
  return String(template || "").replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key) => values[key] ?? "");
}

function localToolDir(kind) {
  const definition = toolDefinitions[kind];
  return definition ? path.join(externalRoot, definition.dir) : externalRoot;
}

function findLocalExecutable(kind) {
  const definition = toolDefinitions[kind];
  if (!definition) return null;
  const dir = localToolDir(kind);
  for (const candidate of definition.candidates) {
    const fullPath = path.join(dir, candidate);
    if (fileExists(fullPath)) return fullPath;
  }
  return null;
}

function resolveExecutable(kind, body = {}) {
  const definition = toolDefinitions[kind];
  if (!definition) return null;
  const explicit = body.toolPath || process.env[definition.envPath];
  if (explicit) return path.resolve(explicit);
  return findLocalExecutable(kind);
}

function commandFromTemplate(template, values, source) {
  const parts = splitCommandLine(fillCommandTemplate(template, values));
  if (!parts.length) return null;
  return { executable: parts[0], args: parts.slice(1), source };
}

function resolveUnityAdapterConfig(kind, body = {}, values = {}) {
  const definition = toolDefinitions[kind];
  if (!definition) return null;

  const commandTemplate =
    body.commandTemplate ||
    process.env[definition.envCommand] ||
    process.env.GAF_UNITY_EXTRACT_COMMAND ||
    "";
  if (commandTemplate.trim()) {
    return commandFromTemplate(commandTemplate, values, body.commandTemplate ? "expertCommandTemplate" : "envCommandTemplate");
  }

  const executable = resolveExecutable(kind, body);
  if (!executable) return null;

  const expertArgs = body.toolArgs || process.env[definition.envArgs] || "";
  if (!expertArgs.trim() && definition.manual) return null;
  const argsTemplate = expertArgs.trim() ? expertArgs : definition.quickArgs.join(" ");
  const resolvedValues = {
    ...values,
    script: definition.script,
  };
  return {
    executable,
    args: splitCommandLine(fillCommandTemplate(argsTemplate, resolvedValues)),
    source: expertArgs.trim() ? "expertArgs" : "builtInQuickPreset",
    label: definition.label,
  };
}

function unityToolKindForMode(mode, requestedTool) {
  if (requestedTool && requestedTool !== "auto") return requestedTool;
  if (mode === "project") return "assetripper";
  if (mode === "code") return "cpp2il";
  if (mode === "assets") return "assetstudio";
  return "raw";
}

function getUnityToolStatus(kind) {
  const definition = toolDefinitions[kind];
  if (!definition) return null;
  const executable = resolveExecutable(kind);
  const scriptOk = !definition.script || fileExists(definition.script);
  return {
    kind,
    label: definition.label,
    purpose: definition.purpose,
    directory: localToolDir(kind),
    executable,
    available: Boolean(executable && scriptOk),
    automationAvailable: Boolean(executable && scriptOk && !definition.manual),
    manual: Boolean(definition.manual),
    manualReason: definition.manualReason,
    script: definition.script,
    scriptAvailable: scriptOk,
    accepts: definition.accepts,
    env: {
      path: definition.envPath,
      args: definition.envArgs,
      command: definition.envCommand,
    },
    candidates: definition.candidates,
    quickArgs: definition.quickArgs.join(" "),
  };
}

function getUnityToolchainStatus() {
  return {
    externalRoot,
    tools: Object.keys(toolDefinitions).map(getUnityToolStatus),
  };
}

module.exports = {
  externalRoot,
  toolDefinitions,
  fillCommandTemplate,
  splitCommandLine,
  resolveUnityAdapterConfig,
  unityToolKindForMode,
  getUnityToolchainStatus,
};
