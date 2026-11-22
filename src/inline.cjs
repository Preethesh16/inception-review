"use strict";

function rejectsSchema(state) {
  return (
    state.status === "error" &&
    /(?:json.?schema|response.?format|structured output)/i.test(
      state.message || "",
    ) &&
    /(?:unsupported|not support|not available|not permitted|invalid|unknown)/i.test(
      state.message || "",
    )
  );
}

function replacementText(content, fenced) {
  if (fenced) {
    const match =
      typeof content === "string" &&
      /^(`{3,})[^\r\n`]*\r?\n([\s\S]*?)\r?\n\1[ \t]*(?:\r?\n)?$/.exec(content);
    if (
      !match ||
      match[2].split(/\r?\n/).some((line) => line.trim() === match[1])
    )
      throw new Error(
        "Model must return one complete replacement block. No changes were staged.",
      );
    return match[2];
  }
  let value;
  try {
    value = JSON.parse(content);
  } catch {
    throw new Error(
      "Model returned an invalid selection response. No changes were staged.",
    );
  }
  if (typeof value?.replacement !== "string")
    throw new Error("Model did not return a replacement string.");
  return value.replacement;
}
module.exports = { rejectsSchema, replacementText };
