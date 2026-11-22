const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync, execFileSync } = require("node:child_process");
const fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path");
const { verify } = require("../src/verify.cjs");
const supported =
  process.platform === "linux" &&
  spawnSync("bwrap", ["--version"]).status === 0;
test(
  "the isolated command sees a broken staged edit and leaves the project alone",
  { skip: !supported },
  async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "inception-test-"));
    try {
      execFileSync("git", ["init", "-q", root]);
      await fs.writeFile(path.join(root, "sample.py"), "value = 1\n");
      const result = await verify(
        root,
        new Map([["sample.py", { staged: "= invalid" }]]),
        "python",
        ["-c", "import sample"],
      );
      assert.notEqual(result.code, 0);
      assert.match(result.output, /SyntaxError/);
      assert.equal(
        await fs.readFile(path.join(root, "sample.py"), "utf8"),
        "value = 1\n",
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  },
);
