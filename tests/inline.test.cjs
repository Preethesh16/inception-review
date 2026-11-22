const test = require("node:test");
const assert = require("node:assert/strict");
const { rejectsSchema, replacementText } = require("../src/inline.cjs");
test("inline transport fallback is restricted to schema incompatibility", () => {
  assert(
    rejectsSchema({
      status: "error",
      message: "Unsupported response_format: json_schema",
    }),
  );
  assert(!rejectsSchema({ status: "error", message: "Invalid API key" }));
  assert.equal(replacementText('{"replacement":""}', false), "");
  assert.equal(replacementText("```py\n  return 4\n```", true), "  return 4");
  for (const text of [
    "Try this",
    "Here is code:\n```py\na\n```",
    "```\na\n```\n```\nb\n```",
  ])
    assert.throws(() => replacementText(text, true));
  assert.throws(() => replacementText("null", false));
});
