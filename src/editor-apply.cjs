"use strict";

const vscode = require("vscode");
const { Review } = require("./review.cjs");

// Open-document versions are rechecked after all asynchronous file opens.
async function applyDocuments(entries, uriFor) {
  const opened = await Promise.all(
    entries.map(async (item) => ({
      item,
      doc: await vscode.workspace.openTextDocument(uriFor(item.path)),
    })),
  );
  const edit = new vscode.WorkspaceEdit();
  const clean = [];
  for (const { item, doc } of opened) {
    if (doc.version !== item.version || doc.getText() !== item.original)
      throw new Error(
        "Review is stale for " + item.path + ". The batch was not applied.",
      );
    const review = new Review(item.original, item.staged, item.version);
    for (const h of review.hunks) {
      edit.replace(
        doc.uri,
        new vscode.Range(doc.positionAt(h.start), doc.positionAt(h.end)),
        h.replacement,
      );
    }
    if (!doc.isDirty) clean.push(doc);
  }
  if (!(await vscode.workspace.applyEdit(edit))) return false;
  const failed = [];
  for (const doc of clean) {
    if (doc.isDirty && !(await doc.save())) failed.push(doc.fileName);
  }
  if (failed.length)
    throw new Error(
      "The editor applied the changes, but could not save " +
        failed.join(", ") +
        ". The edits are available in the editor.",
    );
  return true;
}
module.exports = { applyDocuments };
