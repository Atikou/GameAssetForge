"use strict";

const fs = require("fs");
const fsp = require("fs/promises");
const https = require("https");
const path = require("path");
const { spawn } = require("child_process");

const root = path.resolve(__dirname, "..");
const externalRoot = path.join(root, "tools", "external");
const downloadRoot = path.join(externalRoot, ".downloads");
const skipInstall = process.env.GAF_SKIP_TOOL_INSTALL === "1";
const forceInstall = process.env.GAF_FORCE_TOOL_INSTALL === "1";

const tools = [
  {
    id: "assetripper",
    label: "AssetRipper",
    type: "zip",
    url: "https://github.com/AssetRipper/AssetRipper/releases/download/1.3.14/AssetRipper_win_x64.zip",
    archive: "AssetRipper_win_x64.zip",
    targetDir: path.join(externalRoot, "assetripper"),
    check: path.join(externalRoot, "assetripper", "AssetRipper.GUI.Free.exe"),
  },
  {
    id: "assetstudio",
    label: "Razviar / AssetStudio",
    type: "zip",
    url: "https://github.com/Razviar/assetstudio/releases/download/v2.4.1/AssetStudio-net8.0-win.zip",
    archive: "AssetStudio-net8.0-win.zip",
    targetDir: path.join(externalRoot, "assetstudio"),
    check: path.join(externalRoot, "assetstudio", "AssetStudio.CLI.exe"),
  },
  {
    id: "cpp2il",
    label: "Cpp2IL",
    type: "file",
    url: "https://github.com/SamboyCoding/Cpp2IL/releases/download/2022.0.7/Cpp2IL-2022.0.7-Windows.exe",
    archive: "Cpp2IL-2022.0.7-Windows.exe",
    targetDir: path.join(externalRoot, "cpp2il"),
    targetFile: path.join(externalRoot, "cpp2il", "Cpp2IL.exe"),
    check: path.join(externalRoot, "cpp2il", "Cpp2IL.exe"),
  },
  {
    id: "jadx",
    label: "jadx",
    type: "zip",
    url: "https://github.com/skylot/jadx/releases/download/v1.5.5/jadx-1.5.5.zip",
    archive: "jadx-1.5.5.zip",
    targetDir: path.join(externalRoot, "jadx"),
    check: path.join(externalRoot, "jadx", "lib", "jadx-1.5.5-all.jar"),
  },
  {
    id: "java",
    label: "Temurin JRE 17",
    type: "zip",
    url: "https://github.com/adoptium/temurin17-binaries/releases/download/jdk-17.0.19%2B10/OpenJDK17U-jre_x64_windows_hotspot_17.0.19_10.zip",
    archive: "OpenJDK17U-jre_x64_windows_hotspot_17.0.19_10.zip",
    targetDir: path.join(externalRoot, "java"),
    check: path.join(externalRoot, "java", "jdk-17.0.19+10-jre", "bin", "java.exe"),
  },
];

function fileExists(filePath) {
  try {
    return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || root,
      env: { ...process.env, ...(options.env || {}) },
      windowsHide: true,
      stdio: options.stdio || "pipe",
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(stderr || stdout || `${command} exited with ${code}`));
    });
  });
}

function download(url, target, redirects = 0) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers: { "user-agent": "GameAssetForge tool installer" } }, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
        response.resume();
        if (redirects > 8) {
          reject(new Error(`Too many redirects for ${url}`));
          return;
        }
        download(new URL(response.headers.location, url).toString(), target, redirects + 1).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`${url} returned ${response.statusCode}`));
        return;
      }
      const file = fs.createWriteStream(target);
      response.pipe(file);
      file.on("finish", () => file.close(resolve));
      file.on("error", reject);
    });
    request.on("error", reject);
  });
}

async function expandZip(zipPath, targetDir) {
  await fsp.mkdir(targetDir, { recursive: true });
  if (process.platform !== "win32") {
    console.log(`  skip unzip on ${process.platform}: ${zipPath}`);
    console.log("  请手动解压，或在 Windows 上重新运行 npm install。");
    return;
  }
  await run("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${targetDir.replace(/'/g, "''")}' -Force`,
  ]);
}

async function installTool(tool) {
  if (!forceInstall && fileExists(tool.check)) {
    console.log(`[OK] ${tool.label}: ${tool.check}`);
    return { id: tool.id, status: "exists" };
  }

  console.log(`[INSTALL] ${tool.label}`);
  await fsp.mkdir(downloadRoot, { recursive: true });
  await fsp.mkdir(tool.targetDir, { recursive: true });
  const archivePath = path.join(downloadRoot, tool.archive);
  if (forceInstall || !fileExists(archivePath)) {
    console.log(`  download: ${tool.url}`);
    await download(tool.url, archivePath);
  } else {
    console.log(`  cached: ${archivePath}`);
  }

  if (tool.type === "zip") {
    await expandZip(archivePath, tool.targetDir);
  } else {
    await fsp.copyFile(archivePath, tool.targetFile);
  }

  if (!fileExists(tool.check)) {
    throw new Error(`${tool.label} installed but check file was not found: ${tool.check}`);
  }
  console.log(`[OK] ${tool.label}: ${tool.check}`);
  return { id: tool.id, status: "installed" };
}

async function installUnityPy() {
  const python = process.env.GAF_UNITYPY_PYTHON || "python";
  const venvPython = path.join(externalRoot, "unitypy", ".venv", "Scripts", "python.exe");
  if (!forceInstall && fileExists(venvPython)) {
    console.log(`[OK] UnityPy venv: ${venvPython}`);
    return;
  }
  if (process.env.GAF_SKIP_UNITYPY === "1") {
    console.log("[SKIP] UnityPy: GAF_SKIP_UNITYPY=1");
    return;
  }
  if (process.platform !== "win32") {
    console.log("[SKIP] UnityPy venv auto install currently targets Windows.");
    return;
  }
  const unityPyDir = path.join(externalRoot, "unitypy");
  await fsp.mkdir(unityPyDir, { recursive: true });
  console.log("[INSTALL] UnityPy Python venv");
  await run(python, ["-m", "venv", path.join(unityPyDir, ".venv")]);
  await run(venvPython, ["-m", "pip", "install", "--upgrade", "pip"], { stdio: "ignore" });
  await run(venvPython, ["-m", "pip", "install", "UnityPy==1.25.0"], { stdio: "ignore" });
  console.log(`[OK] UnityPy venv: ${venvPython}`);
}

async function writeVersions(results) {
  const data = {
    installedAt: new Date().toISOString(),
    assets: tools.map((tool) => ({
      id: tool.id,
      label: tool.label,
      url: tool.url,
      check: tool.check,
      status: results.find((result) => result.id === tool.id)?.status || "unknown",
    })),
  };
  await fsp.writeFile(path.join(externalRoot, "versions.json"), JSON.stringify(data, null, 2), "utf8");
}

async function main() {
  if (skipInstall) {
    console.log("[SKIP] Unity external tools: GAF_SKIP_TOOL_INSTALL=1");
    return;
  }
  await fsp.mkdir(externalRoot, { recursive: true });
  const results = [];
  for (const tool of tools) {
    results.push(await installTool(tool));
  }
  await installUnityPy();
  await writeVersions(results);
  console.log("Unity external tools are ready.");
}

main().catch((error) => {
  console.warn(`[WARN] Unity external tool install failed: ${error.message}`);
  console.warn("       可重新运行 npm run install-tools，或设置 GAF_SKIP_TOOL_INSTALL=1 跳过。");
});
