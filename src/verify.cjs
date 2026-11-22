"use strict";

const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { execFile, spawn } = require("node:child_process");
const exec = require("node:util").promisify(execFile);

async function snapshot(root, staged, temp) {
  const { stdout } = await exec(
    "git",
    [
      "-C",
      root,
      "ls-files",
      "-z",
      "--cached",
      "--others",
      "--exclude-standard",
    ],
    { maxBuffer: 16 * 1024 * 1024 },
  );
  const trackedFixtures = new Set(
    (
      await exec(
        "git",
        ["-C", root, "ls-files", "-z", "--", "tests", "test", "spec"],
        { maxBuffer: 16 * 1024 * 1024 },
      )
    ).stdout.split("\0"),
  );
  let copied = 0;
  const ignored =
    /(^|\/)(\.env($|\.)|\.git\/|node_modules\/|\.venv\/|\.npmrc$|\.pypirc$)|\.(pem|p12|key)$/i;
  for (const name of stdout.split("\0").filter(Boolean)) {
    if (
      ignored.test(name) &&
      !(trackedFixtures.has(name) && path.basename(name) === ".env")
    )
      continue;
    const source = path.resolve(root, name);
    if (!source.startsWith(root + path.sep))
      throw new Error("Unexpected workspace path.");
    let stat;
    try {
      stat = await fs.lstat(source);
    } catch (e) {
      if (e.code === "ENOENT") continue;
      throw e;
    }
    if (!stat.isFile() || (await fs.realpath(source)) !== source) continue;
    if ((copied += stat.size) > 128 * 1024 * 1024)
      throw new Error("Verification snapshot exceeds 128 MB.");
    const target = path.join(temp, name);
    await fs.mkdir(path.dirname(target), { recursive: true });
    if (staged.has(name)) await fs.writeFile(target, staged.get(name).staged);
    else await fs.copyFile(source, target);
  }
}

async function verify(root, staged, program, args, pythonEnv, signal) {
  if (!["pytest", "python", "flask", "node", "npm"].includes(program))
    throw new Error(
      "Choose a supported verification program: pytest, python, flask, node or npm.",
    );
  if (
    !Array.isArray(args) ||
    args.length > 32 ||
    args.some((a) => typeof a !== "string" || a.length > 4096)
  )
    throw new Error("Invalid command arguments.");
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "forge-review-"));
  try {
    await snapshot(root, staged, temp);
    signal?.throwIfAborted();
    const settings = [
      "--die-with-parent",
      "--new-session",
      "--unshare-all",
      "--ro-bind",
      "/usr",
      "/usr",
      "--dev",
      "/dev",
      "--proc",
      "/proc",
      "--tmpfs",
      "/tmp",
      "--dir",
      "/home",
      "--dir",
      "/home/runner",
      "--bind",
      temp,
      "/workspace",
      "--chdir",
      "/workspace",
      "--clearenv",
      "--setenv",
      "HOME",
      "/home/runner",
      "--setenv",
      "PATH",
      "/usr/bin:/bin",
      "--setenv",
      "PYTHONPATH",
      "/workspace/src:/workspace",
      "--setenv",
      "LANG",
      "C.UTF-8",
    ];
    for (const dir of ["lib", "lib64", "bin", "sbin"]) {
      try {
        const p = "/" + dir;
        if ((await fs.lstat(p)).isSymbolicLink())
          settings.push("--symlink", await fs.readlink(p), p);
        else settings.push("--ro-bind", p, p);
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
      }
    }
    let exe = program,
      argv = args;
    if (["pytest", "flask", "python"].includes(program)) {
      exe = "/usr/bin/python3";
      if (pythonEnv) {
        settings.push("--ro-bind", pythonEnv, "/venv");
        exe = "/venv/bin/python";
      }
      if (program !== "python") argv = ["-m", program, ...args];
    }
    const result = await new Promise((resolve, reject) => {
      const proc = spawn("bwrap", [...settings, "--", exe, ...argv], {
        stdio: ["ignore", "pipe", "pipe"],
        signal,
      });
      let output = "",
        timedOut = false;
      const append = (chunk) => {
        output = (output + chunk.toString()).slice(-14000);
      };
      proc.stdout.on("data", append);
      proc.stderr.on("data", append);
      const deadline = setTimeout(() => {
        timedOut = true;
        proc.kill("SIGKILL");
      }, 45000);
      proc.once("error", (error) => {
        clearTimeout(deadline);
        reject(error);
      });
      proc.once("close", (code) => {
        clearTimeout(deadline);
        resolve({ code, timedOut, output });
      });
    });
    return result;
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
}
module.exports = { verify };
