const test = require("node:test");
const assert = require("node:assert/strict");
const { RepositoryIndex } = require("../src/context.cjs");
const { references, definitions } = require("../src/mentions.cjs");
test("file and symbol mentions locate explicit evidence within an excerpt budget", () => {
  const index = new RepositoryIndex([
    {
      name: "src/request.py",
      text: "def dispatch(request):\n    return request.method\n",
    },
    { name: "docs/routing.md", text: "Routing requests and dispatch behavior" },
    {
      name: "tests/test_dispatch.py",
      text: "def test_dispatch():\n    assert dispatch(request)",
    },
  ]);
  const prompt = "Update @symbol:dispatch and @file(docs/routing.md)";
  assert.deepEqual(references(prompt), [
    { kind: "symbol", value: "dispatch" },
    { kind: "file", value: "docs/routing.md" },
  ]);
  assert.equal(definitions(index, "dispatch")[0].name, "src/request.py");
  const matches = index.retrieve(prompt, {
    budget: 32,
    pinned: ["docs/routing.md"],
  });
  assert.equal(matches[0].name, "docs/routing.md");
  assert(matches.reduce((sum, hit) => sum + hit.excerpt.length, 0) <= 32);
});
