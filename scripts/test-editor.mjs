import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("..", import.meta.url));
const dir = await fs.mkdtemp(path.join(os.tmpdir(), "inception-editor-test-"));
const workspace = path.join(dir, "workspace");
try {
  await fs.mkdir(workspace);
  await fs.mkdir(path.join(dir, "profile", "User"), { recursive: true });
  await fs.writeFile(
    path.join(dir, "profile", "User", "settings.json"),
    JSON.stringify({
      "security.workspace.trust.enabled": false,
      "telemetry.telemetryLevel": "off",
      "workbench.startupEditor": "none",
    }),
  );
  const result = await new Promise((resolve, reject) => {
    const child = spawn(
      "code",
      [
        "--new-window",
        "--wait",
        "--disable-gpu",
        "--disable-extensions",
        "--user-data-dir",
        path.join(dir, "profile"),
        "--extensions-dir",
        path.join(dir, "extensions"),
        "--extensionDevelopmentPath=" + repo,
        "--extensionTestsPath=" + path.join(repo, "tests", "editor-host.cjs"),
        workspace,
      ],
      {
        stdio: "inherit",
        env: { ...process.env, INCEPTION_EDITOR_TEST_DIR: workspace },
      },
    );
    child.once("error", reject);
    child.once("exit", (code) => resolve(code));
  });
  if (result !== 0)
    throw new Error("VS Code test host exited with status " + result);
  const report = JSON.parse(
    await fs.readFile(path.join(dir, "result.json"), "utf8"),
  );
  console.log(
    "VS Code " +
      report.version +
      ": native multi-file Undo, partial hunk review and stale-batch rejection passed.",
  );
} finally {
  await fs.rm(dir, { recursive: true, force: true });
}
