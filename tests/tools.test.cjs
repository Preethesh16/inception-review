const { test } = require("node:test");
const assert = require("node:assert/strict");
const { editorTools } = require("../src/tools.cjs");
const { EditBatch } = require("../src/batch.cjs");
test("MCP writes require the matching approved payload and consume approval once", async () => {
  const batch = new EditBatch(),
    snapshot = async () => ({ version: 1, text: "first\nstable\nlast\n" });
  const { toolset, approve } = editorTools({
    workspace: {},
    batch,
    snapshot,
    review: async (_, r) => {
      r.decide(0, "accept");
      r.decide(1, "reject");
    },
    signal: new AbortController().signal,
    report() {},
  });
  const args = {
    path: "sample.py",
    placement: "replace",
    original: "first\nstable\nlast",
    replacement: "next\nstable\nbad",
  };
  const call = {
    function: { name: "propose_edit", arguments: JSON.stringify(args) },
  };
  await assert.rejects(() => toolset.propose_edit.run(args), /approval/);
  assert.deepEqual(await approve(call), { status: "allow" });
  await assert.rejects(
    () => toolset.propose_edit.run({ ...args, replacement: "different" }),
    /approval/,
  );
  assert.equal((await toolset.propose_edit.run(args)).acceptedHunks, 1);
  assert.equal(batch.open(args.path, await snapshot()), "next\nstable\nlast\n");
  await assert.rejects(() => toolset.propose_edit.run(args), /approval/);
});
test("rejected command gets no dispatch capability", async () => {
  let runs = 0;
  const signal = new AbortController();
  const { toolset, approve } = editorTools({
    signal: signal.signal,
    confirmCommand: async () => false,
    runCheck: async () => {
      runs++;
    },
    report() {},
  });
  const args = { program: "pytest", args: [] };
  assert.equal(
    (
      await approve({
        function: { name: "run_check", arguments: JSON.stringify(args) },
      })
    ).status,
    "deny",
  );
  await assert.rejects(() => toolset.run_check.run(args), /approval/);
  assert.equal(runs, 0);
});
test("symbol reads find a declaration after an earlier use and staged tests suggest a check", async () => {
  const base =
    "register(handle)\n" +
    Array(8).fill("# filler").join("\n") +
    "\ndef handle():\n    pass\n";
  const { toolset, approve } = editorTools({
    batch: new EditBatch(),
    snapshot: async () => ({ version: 1, text: base }),
    signal: new AbortController().signal,
    report() {},
    review: async (_, r) => r.hunks.forEach((_, i) => r.decide(i, "accept")),
  });
  const hit = await toolset.read_file.run({
    path: "tests/test_jobs.py",
    symbol: "handle",
    count: 10,
  });
  assert(hit.start > 1);
  assert(hit.text.includes("def handle():"));
  const args = {
    path: "tests/test_jobs.py",
    placement: "insert_before",
    original: "def handle():",
    replacement: "# checked\n",
  };
  await approve({
    function: { name: "propose_edit", arguments: JSON.stringify(args) },
  });
  const result = await toolset.propose_edit.run(args);
  assert.deepEqual(result.suggestedCheck, {
    program: "pytest",
    args: ["tests/test_jobs.py", "-q"],
  });
});
test("a blind append beyond a Python entry point is returned for a scoped proposal", async () => {
  const batch = new EditBatch();
  const { approve } = editorTools({
    batch,
    snapshot: async () => ({
      version: 1,
      text: 'if __name__ == "__main__":\n    execute()\n',
    }),
    signal: new AbortController().signal,
  });
  const args = {
    path: "main.py",
    placement: "append",
    original: "",
    replacement: "def added(): pass",
  };
  await assert.rejects(
    () =>
      approve({
        function: { name: "propose_edit", arguments: JSON.stringify(args) },
      }),
    /entry point/,
  );
  assert.equal(batch.files.size, 0);
});
