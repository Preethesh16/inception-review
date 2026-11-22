const test = require("node:test"),
  assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { checkPythonSyntax } = require("../src/syntax.cjs");
test(
  "new syntax errors are caught without executing proposed source",
  { skip: spawnSync("python3", ["-V"]).status !== 0 },
  async () => {
    await assert.rejects(
      () => checkPythonSyntax("app.py", "x=1", "def = 3"),
      /syntax error on line 1/,
    );
    await checkPythonSyntax(
      "app.py",
      "x=1",
      'raise Exception("must never run")',
    );
    await checkPythonSyntax("app.py", "def =", "def :");
  },
);
