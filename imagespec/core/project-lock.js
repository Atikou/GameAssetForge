"use strict";

const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { randomUUID } = require("crypto");

const { LOCK_FILE } = require("./project-layout");
const { ImageSpecError } = require("./errors");

function wait(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function readLock(lockPath) {
  try {
    return JSON.parse(await fs.readFile(lockPath, "utf8"));
  } catch {
    return null;
  }
}

async function acquireProjectLock(projectDir, options = {}) {
  const lockPath = path.join(path.resolve(projectDir), LOCK_FILE);
  const timeoutMs = options.timeoutMs ?? 10_000;
  const staleMs = options.staleMs ?? 5 * 60_000;
  const pollMs = options.pollMs ?? 50;
  const startedAt = Date.now();
  const token = randomUUID();

  while (Date.now() - startedAt <= timeoutMs) {
    try {
      const handle = await fs.open(lockPath, "wx");
      const record = {
        token,
        pid: process.pid,
        hostname: os.hostname(),
        acquiredAt: new Date().toISOString(),
      };
      await handle.writeFile(`${JSON.stringify(record, null, 2)}\n`, "utf8");
      await handle.close();
      let released = false;
      const heartbeatMs = options.heartbeatMs ?? Math.max(25, Math.floor(staleMs / 3));
      const heartbeat = setInterval(async () => {
        try {
          const current = await readLock(lockPath);
          if (current?.token !== token) return clearInterval(heartbeat);
          const now = new Date();
          await fs.utimes(lockPath, now, now);
        } catch {
          clearInterval(heartbeat);
        }
      }, heartbeatMs);
      heartbeat.unref?.();
      return {
        path: lockPath,
        record,
        async release() {
          if (released) return;
          released = true;
          clearInterval(heartbeat);
          const current = await readLock(lockPath);
          if (current?.token === token) await fs.rm(lockPath, { force: true });
        },
      };
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const current = await readLock(lockPath);
      let stale = false;
      try {
        const stat = await fs.stat(lockPath);
        stale = Date.now() - stat.mtimeMs > staleMs;
      } catch (statError) {
        if (statError.code === "ENOENT") continue;
        throw statError;
      }
      if (stale) {
        await fs.rm(lockPath, { force: true });
        continue;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        throw new ImageSpecError("IMAGESPEC_PROJECT_LOCKED", "ImageSpec project is locked by another writer.", { lock: current }, { statusCode: 409 });
      }
      await wait(pollMs);
    }
  }
  throw new ImageSpecError("IMAGESPEC_PROJECT_LOCKED", "Timed out waiting for the ImageSpec project lock.", {}, { statusCode: 409 });
}

module.exports = {
  acquireProjectLock,
  readLock,
};
