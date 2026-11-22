const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Review, createReplacement } = require("../src/review.cjs");

function applied(source, edits) {
  return [...edits]
    .reverse()
    .reduce(
      (current, e) =>
        current.slice(0, e.start) + e.replacement + current.slice(e.end),
      source,
    );
}
test("mixed accept/reject works across emoji, CRLF, and a missing final newline", () => {
  const old = "🪴 first\r\nkeep\r\nlast";
  const review = new Review(old, "🌱 grow\r\nkeep\r\nend", 3);
  assert.equal(review.hunks.length, 2);
  review.decide(0, "accept");
  assert.throws(() => review.acceptedEdits(old, 3), /each hunk/);
  review.decide(1, "reject");
  assert.equal(
    applied(old, review.acceptedEdits(old, 3)),
    "🌱 grow\r\nkeep\r\nlast",
  );
  assert.throws(() => review.acceptedEdits(old, 4), /changed/);
  assert.throws(() => review.acceptedEdits(old + "x", 3), /changed/);
});
test("exact replacement requires one unambiguous anchor, including overlapping matches", () => {
  assert.throws(() => createReplacement("aaa", "aa", "z"), /multiple/);
  assert.throws(() => createReplacement("abc", "x", "z"), /does not match/);
  assert.throws(() => createReplacement("abc", "", "z"), /nonempty/);
  assert.equal(createReplacement("", "", "first"), "first");
  assert.equal(createReplacement("axb", "x", ""), "ab");
});
test("all-accepted hunks reconstruct the intended text under randomized edits", () => {
  let state = 7;
  const random = (n) =>
    (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) % n;
  let base = "first\nsecond\nthird\n";
  const pieces = ["z", "\n", "🌿", "\r\n", "word", ""];
  for (let i = 0; i < 300; ++i) {
    const start = random(base.length + 1);
    const next =
      base.slice(0, start) +
      pieces[random(pieces.length)] +
      base.slice(start + random(4));
    const review = new Review(base, next, 1);
    review.hunks.forEach((_, index) => review.decide(index, "accept"));
    assert.equal(applied(base, review.acceptedEdits(base, 1)), next);
    base = next;
  }
});
