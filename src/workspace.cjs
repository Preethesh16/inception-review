"use strict";

const path = require("node:path");
const fs = require("node:fs/promises");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { RepositoryIndex } = require("./context.cjs");
const exec = promisify(execFile);
const source =
  /\.(?:[cm]?[jt]sx?|pyi?|rs|go|rb|java|kt|cs|c|h|cpp|hpp|swift|md|rst|txt|toml|yaml|yml|json|html|css|sh)$/i;
const skip =
  /(?:^|\/)(?:\.git|\.env(?:\..*)?|node_modules|dist|build|coverage|\.venv|\.cache|vendor)(?:\/|$)|(?:^|\/)(?:package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$/i;

class Workspace {
  constructor(root) {
    this.root = root;
    this.paths = new Set();
  }
  async index() {
    this.root = await fs.realpath(this.root);
    const { stdout } = await exec(
      "git",
      [
        "-C",
        this.root,
        "ls-files",
        "--cached",
        "--others",
        "--exclude-standard",
        "-z",
      ],
      { maxBuffer: 16 * 1024 * 1024 },
    );
    const paths = stdout
      .split("\0")
      .filter((name) => source.test(name) && !skip.test(name));
    const files = [];
    let totalBytes = 0;
    for (const name of paths) {
      if (files.length >= 3000 || totalBytes >= 20 * 1024 * 1024) break;
      const disk = path.resolve(this.root, name);
      try {
        const real = await fs.realpath(disk);
        if (real !== disk || !real.startsWith(this.root + path.sep)) continue;
        const stat = await fs.stat(real);
        if (!stat.isFile() || stat.size > 256 * 1024) continue;
        const text = await fs.readFile(real, "utf8");
        if (text.includes("\0")) continue;
        files.push({ name, text });
        totalBytes += stat.size;
      } catch (e) {
        if (!["ENOENT", "EACCES", "ENOTDIR"].includes(e.code)) throw e;
      }
    }
    this.paths = new Set(files.map((f) => f.name));
    this.repository = new RepositoryIndex(files);
    return { files: files.length, bytes: totalBytes };
  }
  async resolve(name) {
    if (!this.paths.has(name))
      throw new Error("Choose an indexed workspace path returned by search.");
    const file = path.resolve(this.root, name);
    if ((await fs.realpath(file)) !== file)
      throw new Error("Workspace path changed. Refresh the index.");
    return file;
  }
  async read(name, start = 1, count = 60) {
    const text = await fs.readFile(await this.resolve(name), "utf8");
    const lines = text.split(/\r?\n/);
    if (!Number.isSafeInteger(start) || start < 1 || start > lines.length)
      throw new Error("Start line outside the file.");
    const size = Math.min(120, Math.max(1, count));
    return {
      path: name,
      start,
      totalLines: lines.length,
      text: lines
        .slice(start - 1, start - 1 + size)
        .join("\n")
        .slice(0, 12000),
    };
  }
  search(query, budget = 3500, pinned = []) {
    if (!this.repository)
      throw new Error("Workspace indexing is still in progress.");
    return this.repository.retrieve(query, { budget, limit: 5, pinned });
  }
}
module.exports = { Workspace };
