"use strict";

const { Review } = require("./review.cjs");

function applyAccepted(original, edits) {
  return [...edits]
    .reverse()
    .reduce(
      (current, h) =>
        current.slice(0, h.start) + h.replacement + current.slice(h.end),
      original,
    );
}

class EditBatch {
  constructor() {
    this.files = new Map();
    this.closed = false;
  }
  open(path, snapshot) {
    if (this.closed) throw new Error("This review is closed.");
    const file = this.files.get(path);
    if (
      file &&
      (snapshot.text !== file.original || snapshot.version !== file.version)
    )
      throw new Error(
        "The file changed during review. Discard this batch and retry.",
      );
    return file?.staged ?? snapshot.text;
  }
  prepare(path, snapshot, proposed) {
    const old = this.open(path, snapshot);
    return new Review(old, proposed, snapshot.version);
  }
  stage(path, snapshot, review) {
    const old = this.open(path, snapshot);
    const changes = review.acceptedEdits(old, snapshot.version);
    if (!changes.length) return 0;
    const staged = applyAccepted(old, changes);
    this.files.set(path, {
      original: snapshot.text,
      version: snapshot.version,
      staged,
    });
    return changes.length;
  }
  async commit(getSnapshot, apply) {
    if (this.closed) throw new Error("This review is closed.");
    const files = [];
    for (const [path, record] of this.files) {
      const current = await getSnapshot(path);
      this.open(path, current);
      if (record.original !== record.staged) files.push({ path, ...record });
    }
    // Recheck open documents synchronously in the editor adapter immediately
    // before issuing the single text-only WorkspaceEdit.
    if (this.closed) throw new Error("Review cancelled.");
    this.closed = true;
    if (files.length && !(await apply(files)))
      throw new Error(
        "The editor could not apply the batch. Review the current documents before retrying.",
      );
    return files.length;
  }
  discard() {
    this.closed = true;
    this.files.clear();
  }
}
module.exports = { EditBatch, applyAccepted };
