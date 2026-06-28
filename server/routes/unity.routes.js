const { randomUUID } = require("crypto");
const { requireFile, zipResponse, binaryResponse } = require("../lib/http");
const { safeBaseName } = require("../lib/common");
const { inspectUnityApk, buildUnityApkExtractZip, getUnityToolchainStatus } = require("../tools/unity-apk");

const unityJobs = new Map();
const JOB_TTL_MS = 30 * 60 * 1000;

function unityExportFilename(file) {
  return `unity-apk-${safeBaseName(file?.originalname, "apk")}.zip`;
}

function publicJob(job) {
  return {
    id: job.id,
    status: job.status,
    percent: job.percent,
    phase: job.phase,
    message: job.message,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    finishedAt: job.finishedAt,
    filename: job.filename,
    downloadUrl: job.status === "done" ? `/api/unity/apk-extract/jobs/${job.id}/download` : null,
    error: job.error,
    detail: job.detail,
    resultSummary: job.resultSummary,
    log: job.log,
  };
}

function updateJob(job, update) {
  job.updatedAt = new Date().toISOString();
  job.percent = Math.max(job.percent || 0, Math.min(100, Number(update.percent ?? job.percent ?? 0)));
  job.phase = update.phase || job.phase;
  job.message = update.message || job.message;
  job.detail = update.detail || job.detail;
  if (update.message) {
    job.log.push({
      at: update.at || job.updatedAt,
      phase: job.phase,
      percent: job.percent,
      message: update.message,
    });
    job.log = job.log.slice(-80);
  }
}

function scheduleJobCleanup(job) {
  setTimeout(() => {
    unityJobs.delete(job.id);
  }, JOB_TTL_MS).unref?.();
}

async function runUnityJob(job, file, body) {
  try {
    updateJob(job, { percent: 1, phase: "queued", message: "任务已开始..." });
    const zip = await buildUnityApkExtractZip(file, body, (update) => updateJob(job, update));
    const entries = Object.keys(zip.files).filter((name) => !zip.files[name].dir);
    const manifestText = await zip.file("manifest.json")?.async("string");
    const manifest = manifestText ? JSON.parse(manifestText) : {};
    job.resultSummary = {
      mode: manifest.mode,
      modeLabel: manifest.modeLabel,
      tool: manifest.mode === "full" ? "AssetStudio + jadx + Cpp2IL(when possible)" : "AssetStudio",
      rawIncluded: Boolean(manifest.rawExport?.included),
      rawFileCount: manifest.rawExport?.fileCount || 0,
      externalTool: manifest.externalTool || manifest.resourceExport || manifest.restoreSummary?.tools,
      resourceExport: manifest.resourceExport,
      restoreSummary: manifest.restoreSummary,
      warnings: manifest.warnings || [],
      totalEntries: entries.length,
      toolOutputEntries: entries.filter((entry) => entry.startsWith("tool-output/")).length,
      unityProjectEntries: entries.filter((entry) => entry.startsWith("UnityRestoredProject/")).length,
      javaEntries: entries.filter((entry) => entry.startsWith("Decompiled/AndroidJava/")).length,
      rawEntries: entries.filter((entry) => entry.startsWith("apk-unity-data/")).length,
      setupOnly: entries.every((entry) => ["manifest.json", "TOOL_SETUP.md"].includes(entry)),
    };
    updateJob(job, { percent: 92, phase: "zip", message: "正在压缩 ZIP..." });
    job.result = await zip.generateAsync(
      { type: "nodebuffer", compression: "DEFLATE" },
      (metadata) => {
        updateJob(job, {
          percent: 92 + Math.round((metadata.percent || 0) * 0.07),
          phase: "zip",
          message: `正在压缩 ZIP ${Math.round(metadata.percent || 0)}%`,
        });
      },
    );
    job.status = "done";
    job.finishedAt = new Date().toISOString();
    updateJob(job, { percent: 100, phase: "done", message: "处理完成，可以下载 ZIP。" });
  } catch (error) {
    job.status = "failed";
    job.error = error.message || "Unity APK task failed";
    job.finishedAt = new Date().toISOString();
    updateJob(job, { percent: 100, phase: "failed", message: job.error });
  } finally {
    scheduleJobCleanup(job);
  }
}

function registerUnityRoutes(app, upload) {
  app.get("/api/unity/toolchain", async (req, res, next) => {
    try {
      res.json(await getUnityToolchainStatus());
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/unity/apk-inspect", upload.single("apk"), async (req, res, next) => {
    try {
      res.json(await inspectUnityApk(requireFile(req, "apk")));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/unity/apk-extract", upload.single("apk"), async (req, res, next) => {
    try {
      const file = requireFile(req, "apk");
      await zipResponse(res, await buildUnityApkExtractZip(file, req.body), unityExportFilename(file));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/unity/apk-extract/jobs", upload.single("apk"), async (req, res, next) => {
    try {
      const file = requireFile(req, "apk");
      const job = {
        id: randomUUID(),
        status: "running",
        percent: 0,
        phase: "queued",
        message: "任务已排队...",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        filename: unityExportFilename(file),
        log: [],
      };
      unityJobs.set(job.id, job);
      res.status(202).json(publicJob(job));
      setImmediate(() => runUnityJob(job, file, { ...req.body }));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/unity/apk-extract/jobs/:jobId", (req, res) => {
    const job = unityJobs.get(req.params.jobId);
    if (!job) {
      res.status(404).json({ error: { message: "Unity APK job not found or expired." } });
      return;
    }
    res.json(publicJob(job));
  });

  app.get("/api/unity/apk-extract/jobs/:jobId/download", (req, res) => {
    const job = unityJobs.get(req.params.jobId);
    if (!job) {
      res.status(404).json({ error: { message: "Unity APK job not found or expired." } });
      return;
    }
    if (job.status !== "done" || !job.result) {
      res.status(409).json({ error: { message: "Unity APK job is not complete yet." } });
      return;
    }
    binaryResponse(res, job.result, job.filename, "application/zip");
  });
}

module.exports = { registerUnityRoutes };
