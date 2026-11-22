"use strict";

const { diffLines } = require("diff");

function createReplacement(original, before, after) {
  if (!before && original)
    throw new Error("Choose a nonempty original passage to anchor this edit.");
  const start = original.indexOf(before);
  if (start < 0)
    throw new Error(
      "The original passage does not match. Read the current file again.",
    );
  if (before && original.indexOf(before, start + 1) >= 0)
    throw new Error(
      "The passage occurs multiple times. Include more surrounding lines.",
    );
  return (
    original.slice(0, start) + after + original.slice(start + before.length)
  );
}

function insertAtAnchor(source, anchor, text, placement) {
  const start = source.indexOf(anchor);
  const before = source.slice(0, start);
  const after = source.slice(start + anchor.length);
  const fullLines =
    start >= 0 &&
    (!before || before.endsWith("\n")) &&
    (!after || /^(?:\r?\n)/.test(after) || anchor.endsWith("\n"));
  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  if (fullLines && text) {
    if (placement === "insert_before" && !text.endsWith("\n")) text += eol;
    if (
      placement === "insert_after" &&
      !anchor.endsWith("\n") &&
      !/^\r?\n/.test(text)
    )
      text = eol + text;
    if (
      placement === "insert_after" &&
      anchor.endsWith("\n") &&
      after &&
      !text.endsWith("\n")
    )
      text += eol;
  }
  return createReplacement(
    source,
    anchor,
    placement === "insert_before" ? text + anchor : anchor + text,
  );
}

// Offsets are UTF-16 units, as used by VS Code's TextDocument.positionAt.
function makeHunks(original, proposed) {
  const changes = diffLines(original, proposed, { timeout: 1000 });
  if (!changes)
    throw new Error("Diff exceeded its time budget. Propose a smaller change.");
  const hunks = [];
  let start = 0;
  let current;
  for (const change of changes) {
    if (!change.added && !change.removed) {
      current = undefined;
      start += change.value.length;
      continue;
    }
    if (!current) {
      current = { start, end: start, replacement: "", decision: "pending" };
      hunks.push(current);
    }
    if (change.removed) {
      start += change.value.length;
      current.end = start;
    } else {
      current.replacement += change.value;
    }
  }
  return hunks;
}

class Review {
  constructor(original, proposed, version) {
    this.original = original;
    this.version = version;
    this.hunks = makeHunks(original, proposed);
  }

  decide(index, decision) {
    if (!["accept", "reject"].includes(decision) || !this.hunks[index])
      throw new Error("Invalid review decision.");
    this.hunks[index].decision = decision;
  }

  acceptedEdits(current, version) {
    if (version !== this.version || current !== this.original)
      throw new Error("The file changed during review. Refresh the proposal.");
    if (this.hunks.some((hunk) => hunk.decision === "pending"))
      throw new Error("Review each hunk before applying.");
    return this.hunks
      .filter((hunk) => hunk.decision === "accept")
      .map(({ start, end, replacement }) => ({ start, end, replacement }));
  }
}

module.exports = { Review, createReplacement, insertAtAnchor };
