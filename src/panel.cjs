"use strict";
const vscode = require("vscode");
const fs = require("node:fs");
const { randomBytes, randomUUID } = require("node:crypto");

class ReviewPanel {
  constructor(assetRoot, onAction, onClose) {
    this.ready = false;
    this.outbox = [];
    this.pending = null;
    this.view = vscode.window.createWebviewPanel(
      "inceptionReview",
      "Inception Review",
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [assetRoot],
      },
    );
    const w = this.view.webview;
    const asset = (name) => vscode.Uri.joinPath(assetRoot, name);
    this.view.onDidDispose(() => {
      this.closed = true;
      this.pending?.finish(null);
      onClose();
    });
    w.onDidReceiveMessage(async (msg) => {
      if (!msg || typeof msg.type !== "string") return;
      if (msg.type === "ready") {
        if (this.ready) return;
        this.ready = true;
        for (const e of this.outbox) await w.postMessage(e);
        this.outbox = [];
      } else if (msg.type === "review") {
        if (
          this.pending?.type !== "review" ||
          msg.id !== this.pending.id ||
          !Array.isArray(msg.decisions)
        )
          return;
        this.pending.finish(msg.decisions);
      } else if (msg.type === "commandDecision") {
        if (
          this.pending?.type === "commandReview" &&
          msg.id === this.pending.id &&
          typeof msg.allow === "boolean"
        )
          this.pending.finish(msg.allow);
      } else {
        try {
          await onAction(msg);
        } catch (e) {
          vscode.window.showErrorMessage(e.message);
        }
      }
    });
    w.html = fs
      .readFileSync(asset("panel.html").fsPath, "utf8")
      .replaceAll("{{source}}", w.cspSource)
      .replaceAll("{{nonce}}", randomBytes(16).toString("hex"))
      .replace("{{css}}", w.asWebviewUri(asset("panel.css")).toString())
      .replace("{{js}}", w.asWebviewUri(asset("panel.js")).toString());
  }
  post(data) {
    if (this.closed) return;
    if (!this.ready) this.outbox.push(data);
    else void this.view.webview.postMessage(data);
  }
  reveal() {
    this.view.reveal(vscode.ViewColumn.Beside);
  }
  ask(type, payload, signal) {
    signal.throwIfAborted();
    if (this.closed) throw new Error("Review panel closed.");
    if (this.pending) throw new Error("Finish the current approval first.");
    const id = randomUUID();
    return new Promise((resolve) => {
      const abort = () => finish(null);
      const finish = (value) => {
        signal.removeEventListener("abort", abort);
        this.pending = null;
        this.post({ type: "reviewDone" });
        resolve(value);
      };
      this.pending = { type, id, finish };
      signal.addEventListener("abort", abort, { once: true });
      this.post({ type, id, ...payload });
    });
  }
  async confirmCommand(args, signal) {
    return (await this.ask("commandReview", args, signal)) === true;
  }
  async review(path, proposal, signal) {
    const decisions = await this.ask(
      "review",
      {
        path,
        hunks: proposal.hunks.map((h) => ({
          line: proposal.original.slice(0, h.start).split("\n").length,
          old: proposal.original.slice(h.start, h.end),
          new: h.replacement,
        })),
      },
      signal,
    );
    if (
      !decisions ||
      decisions.length !== proposal.hunks.length ||
      decisions.some((d) => !["accept", "reject"].includes(d))
    )
      throw new Error("Review cancelled.");
    decisions.forEach((d, i) => proposal.decide(i, d));
  }
}
module.exports = { ReviewPanel };
