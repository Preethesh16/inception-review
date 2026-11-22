const test = require("node:test");
const assert = require("node:assert/strict");
const { referencedDefinitions } = require("../src/neighbors.cjs");
test("follow a referenced definition including its decorator within the remaining budget", () => {
  const source =
    "registry.add(parse_row)\n\n@timed\ndef parse_row(row):\n    return row.strip()\n";
  const hits = referencedDefinitions(
    "loader.py",
    source,
    "registry.add(parse_row)",
    "parse a row",
    25,
  );
  assert.equal(hits[0].definition, "parse_row");
  assert.equal(hits[0].line, 3);
  assert(hits[0].excerpt.startsWith("@timed"));
  assert(hits[0].excerpt.length <= 25);
  assert.deepEqual(
    referencedDefinitions("loader.py", source, "missing()", "row", 50),
    [],
  );
});
