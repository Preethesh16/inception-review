const vscode = require("vscode");
const fs = require("node:fs/promises");
const path = require("node:path");
const assert = require("node:assert/strict");
const { EditBatch } = require("../src/batch.cjs");
const { applyDocuments } = require("../src/editor-apply.cjs");
exports.run = async () => {
  const root = vscode.workspace.workspaceFolders[0].uri;
  assert.equal(
    root.fsPath,
    process.env.INCEPTION_EDITOR_TEST_DIR,
    "Run via npm run test:editor in its generated temporary workspace.",
  );
  assert.deepEqual(await fs.readdir(root.fsPath), []);
  const uriFor = (name) => vscode.Uri.joinPath(root, name);
  const names = ["src.txt", "test.txt", "guide.txt"];
  const docs = new Map();
  const snapshot = (name) => ({
    text: docs.get(name).getText(),
    version: docs.get(name).version,
  });
  for (const name of names) {
    await vscode.workspace.fs.writeFile(
      uriFor(name),
      Buffer.from(name + "\nkeep\nold\n"),
    );
    docs.set(name, await vscode.workspace.openTextDocument(uriFor(name)));
  }
  const batch = new EditBatch();
  for (const name of names) {
    const s = snapshot(name),
      r = batch.prepare(name, s, "accepted " + name + "\nkeep\nrejected\n");
    r.decide(0, "accept");
    r.decide(1, "reject");
    batch.stage(name, s, r);
  }
  assert.equal(
    await batch.commit(snapshot, (entries) => applyDocuments(entries, uriFor)),
    3,
  );
  for (const name of names)
    assert.equal(
      await fs.readFile(uriFor(name).fsPath, "utf8"),
      "accepted " + name + "\nkeep\nold\n",
    );
  await vscode.window.showTextDocument(docs.get("src.txt"));
  await vscode.commands.executeCommand("undo");
  const outcomes = names.map((name) => ({
    name,
    restored: docs.get(name).getText() === name + "\nkeep\nold\n",
  }));
  assert(outcomes.every((row) => row.restored));
  const stale = new EditBatch();
  for (const name of names) {
    const s = snapshot(name),
      r = stale.prepare(name, s, "next");
    r.decide(0, "accept");
    stale.stage(name, s, r);
  }
  const doc = docs.get(names[2]),
    human = new vscode.WorkspaceEdit();
  human.insert(doc.uri, new vscode.Position(0, 0), "manual ");
  assert(await vscode.workspace.applyEdit(human));
  await assert.rejects(
    () => stale.commit(snapshot, (entries) => applyDocuments(entries, uriFor)),
    /changed/,
  );
  assert.equal(docs.get("src.txt").getText(), "src.txt\nkeep\nold\n");
  assert(doc.getText().startsWith("manual "));
  await fs.writeFile(
    path.join(root.fsPath, "../result.json"),
    JSON.stringify({ version: vscode.version }),
  );
};
