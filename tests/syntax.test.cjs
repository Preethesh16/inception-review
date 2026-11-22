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

test(
  "reject a partial hunk selection that leaves a Python block unfinished",
  {
    skip: spawnSync("python3", ["-V"]).status !== 0,
  },
  async () => {
    const { Review } = require("../src/review.cjs");
    const { checkReviewedPython } = require("../src/syntax.cjs");
    const review = new Review(
      "value = 1\n# separator\nprint(value)\n",
      "if True:\n# separator\n    print(1)\n",
      1,
    );
    assert.equal(review.hunks.length, 2);
    review.decide(0, "accept");
    review.decide(1, "reject");
    await assert.rejects(
      () => checkReviewedPython("demo.py", review),
      /syntax error/,
    );
    review.decide(1, "accept");
    await checkReviewedPython("demo.py", review);
  },
);
