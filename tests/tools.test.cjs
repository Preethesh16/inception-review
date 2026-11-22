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
