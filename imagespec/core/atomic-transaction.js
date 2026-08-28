"use strict";

const fs = require("fs/promises");
const path = require("path");
const { randomUUID } = require("crypto");

const { assertSafeRelativePath, resolveProjectPath, toProtocolPath } = require("../protocol");
const { TRANSACTION_DIR } = require("./project-layout");
const { ImageSpecError } = require("./errors");

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function transactionRoot(projectDir, transactionId) {
  return resolveProjectPath(projectDir, `${TRANSACTION_DIR}/${transactionId}`);
}

class AtomicProjectTransaction {
  constructor(projectDir, options = {}) {
    this.projectDir = path.resolve(projectDir);
    this.id = options.id || `transaction.${randomUUID().replaceAll("-", "")}`;
    this.root = transactionRoot(this.projectDir, this.id);
    this.writes = new Map();
    this.prepared = false;
  }

  stageWrite(relativePath, value) {
    if (this.prepared) throw new ImageSpecError("IMAGESPEC_TRANSACTION_PREPARED", "Cannot add writes after transaction preparation.");
    const safePath = assertSafeRelativePath(relativePath);
    if (safePath.startsWith(`${TRANSACTION_DIR}/`) || safePath === ".imagespec.lock") {
      throw new ImageSpecError("IMAGESPEC_RESERVED_PATH", `Cannot write reserved ImageSpec path: ${safePath}`);
    }
    const buffer = Buffer.isBuffer(value) ? value : Buffer.from(String(value));
    this.writes.set(safePath, buffer);
    return safePath;
  }

  stageJson(relativePath, value) {
    return this.stageWrite(relativePath, `${JSON.stringify(value, null, 2)}\n`);
  }

  getStaged(relativePath) {
    return this.writes.get(toProtocolPath(relativePath)) || null;
  }

  listWrites() {
    return [...this.writes.entries()].map(([pathName, buffer]) => ({ path: pathName, size: buffer.length }));
  }

  async prepare() {
    if (this.prepared) return;
    await fs.mkdir(this.root, { recursive: true });
    const entries = [];
    for (const [relativePath, buffer] of this.writes) {
      const target = resolveProjectPath(this.projectDir, relativePath);
      const staged = path.join(this.root, "staged", ...relativePath.split("/"));
      const backup = path.join(this.root, "backups", ...relativePath.split("/"));
      const hadOriginal = await exists(target);
      await fs.mkdir(path.dirname(staged), { recursive: true });
      await fs.writeFile(staged, buffer);
      if (hadOriginal) {
        const stat = await fs.stat(target);
        if (!stat.isFile()) throw new ImageSpecError("IMAGESPEC_NON_FILE_TARGET", `Transaction target is not a file: ${relativePath}`);
        await fs.mkdir(path.dirname(backup), { recursive: true });
        await fs.copyFile(target, backup);
      }
      entries.push({ relativePath, hadOriginal });
    }
    await writeJson(path.join(this.root, "journal.json"), {
      transactionId: this.id,
      projectDir: this.projectDir,
      state: "prepared",
      createdAt: new Date().toISOString(),
      entries,
    });
    this.prepared = true;
  }

  async commit() {
    await this.prepare();
    const journalPath = path.join(this.root, "journal.json");
    const journal = JSON.parse(await fs.readFile(journalPath, "utf8"));
    try {
      for (const entry of journal.entries) {
        const target = resolveProjectPath(this.projectDir, entry.relativePath);
        const staged = path.join(this.root, "staged", ...entry.relativePath.split("/"));
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.rm(target, { force: true });
        await fs.rename(staged, target);
      }
      journal.state = "committed";
      journal.committedAt = new Date().toISOString();
      await writeJson(journalPath, journal);
      await fs.rm(this.root, { recursive: true, force: true });
    } catch (error) {
      await rollbackTransactionDirectory(this.projectDir, this.root);
      throw new ImageSpecError("IMAGESPEC_TRANSACTION_FAILED", "ImageSpec atomic transaction failed and was rolled back.", { transactionId: this.id }, { cause: error, statusCode: 500 });
    }
  }

  async abort() {
    await fs.rm(this.root, { recursive: true, force: true });
  }
}

async function rollbackTransactionDirectory(projectDir, root) {
  const journalPath = path.join(root, "journal.json");
  if (!(await exists(journalPath))) {
    await fs.rm(root, { recursive: true, force: true });
    return { recovered: false, reason: "missing-journal" };
  }
  const journal = JSON.parse(await fs.readFile(journalPath, "utf8"));
  if (journal.state === "committed") {
    await fs.rm(root, { recursive: true, force: true });
    return { recovered: false, reason: "committed" };
  }
  for (const entry of journal.entries || []) {
    const target = resolveProjectPath(projectDir, entry.relativePath);
    const backup = path.join(root, "backups", ...entry.relativePath.split("/"));
    if (entry.hadOriginal && (await exists(backup))) {
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.rm(target, { force: true });
      await fs.copyFile(backup, target);
    } else if (!entry.hadOriginal) {
      await fs.rm(target, { force: true });
    }
  }
  await fs.rm(root, { recursive: true, force: true });
  return { recovered: true, transactionId: journal.transactionId };
}

async function inspectTransactions(projectDir) {
  const root = resolveProjectPath(projectDir, TRANSACTION_DIR);
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    const transactions = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const journalPath = path.join(root, entry.name, "journal.json");
      let journal = null;
      try {
        journal = JSON.parse(await fs.readFile(journalPath, "utf8"));
      } catch {
        // An orphaned transaction without a journal has not modified project files.
      }
      transactions.push({ id: entry.name, journal });
    }
    return transactions;
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function recoverTransactions(projectDir) {
  const pending = await inspectTransactions(projectDir);
  const results = [];
  for (const entry of pending) {
    results.push(await rollbackTransactionDirectory(projectDir, transactionRoot(projectDir, entry.id)));
  }
  return results;
}

module.exports = {
  AtomicProjectTransaction,
  inspectTransactions,
  recoverTransactions,
  rollbackTransactionDirectory,
};
