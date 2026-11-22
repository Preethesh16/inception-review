const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EditBatch } = require("../src/batch.cjs");

test("stage progressive edits, reject a distant hunk, and commit once", async () => {
  const batch = new EditBatch();
  const first = { text: "one\nkeep\nlast\n", version: 1 },
    second = { text: "B", version: 2 };
  const stage = (name, snapshot, next, decisions) => {
    const r = batch.prepare(name, snapshot, next);
    decisions.forEach((d, i) => r.decide(i, d));
    return batch.stage(name, snapshot, r);
  };
  stage("a", first, "new\nkeep\nbad\n", ["accept", "reject"]);
  stage("a", first, "new\nkeep\nfinal\n", ["accept"]);
  stage("b", second, "BB", ["accept"]);
  let calls = 0;
  const count = await batch.commit(
    async (path) => (path === "a" ? first : second),
    async (entries) => {
      calls++;
      assert.deepEqual(
        entries.map((e) => e.staged),
        ["new\nkeep\nfinal\n", "BB"],
      );
      return true;
    },
  );
  assert.equal(count, 2);
  assert.equal(calls, 1);
  await assert.rejects(
    () =>
      batch.commit(
        () => first,
        () => true,
      ),
    /closed/,
  );
});
test("changing the last file prevents dispatch of the entire batch", async () => {
  const batch = new EditBatch(),
    snapshot = { text: "old", version: 1 };
  for (const name of ["one", "two", "three"]) {
    const r = batch.prepare(name, snapshot, "new");
    r.decide(0, "accept");
    batch.stage(name, snapshot, r);
  }
  let applied = false;
  await assert.rejects(
    () =>
      batch.commit(
        async (name) =>
          name === "three" ? { text: "human edit", version: 2 } : snapshot,
        async () => {
          applied = true;
          return true;
        },
      ),
    /changed/,
  );
  assert.equal(applied, false);
  batch.discard();
  assert.throws(() => batch.open("one", snapshot), /closed/);
});
test("cancellation during the preflight prevents dispatch", async () => {
  const batch = new EditBatch(),
    snapshot = { text: "a", version: 1 };
  const r = batch.prepare("p", snapshot, "b");
  r.decide(0, "accept");
  batch.stage("p", snapshot, r);
  await assert.rejects(
    () =>
      batch.commit(
        async () => {
          batch.discard();
          return snapshot;
        },
        () => {
          throw Error("unexpected write");
        },
      ),
    /closed|cancelled/,
  );
});
