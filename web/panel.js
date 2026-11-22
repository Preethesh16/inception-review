"use strict";
const vscode = acquireVsCodeApi();
const $ = (id) => document.getElementById(id);
let reviewId,
  decisions = [];
const post = (type, extra = {}) => vscode.postMessage({ type, ...extra });
const item = (tag, text) => {
  const el = document.createElement(tag);
  el.textContent = text;
  return el;
};
$("composer").addEventListener("submit", (e) => {
  e.preventDefault();
  const prompt = $("request").value.trim();
  if (prompt) post("run", { prompt });
});
for (const action of ["cancel", "apply", "discard", "session"])
  $(action).addEventListener("click", () => post(action));
$("confirm").addEventListener("click", () => {
  if (decisions.every(Boolean)) {
    post("review", { id: reviewId, decisions });
    $("confirm").disabled = true;
  }
});
function renderReview(data) {
  reviewId = data.id;
  decisions = Array(data.hunks.length).fill(null);
  $("filename").textContent = "Review " + data.path;
  $("hunks").replaceChildren();
  $("review").hidden = false;
  $("confirm").disabled = true;
  data.hunks.forEach((h, i) => {
    const row = document.createElement("article");
    row.append(
      item(
        "small",
        "Hunk " + (i + 1) + " of " + data.hunks.length + " · line " + h.line,
      ),
    );
    for (const [kind, body] of [
      ["del", h.old],
      ["add", h.new],
    ])
      if (body) {
        const pre = item("pre", body);
        pre.className = kind;
        pre.setAttribute(
          "aria-label",
          kind === "del" ? "Removed lines" : "Added lines",
        );
        row.append(pre);
      }
    const actions = document.createElement("div");
    actions.className = "actions";
    for (const choice of ["accept", "reject"]) {
      const button = item(
        "button",
        choice === "accept" ? "Accept hunk" : "Reject hunk",
      );
      button.setAttribute("aria-pressed", "false");
      button.onclick = () => {
        decisions[i] = choice;
        for (const sibling of actions.children)
          sibling.setAttribute("aria-pressed", String(sibling === button));
        $("confirm").disabled = !decisions.every(Boolean);
      };
      actions.append(button);
    }
    row.append(actions);
    $("hunks").append(row);
  });
  $("review").scrollIntoView({ block: "nearest" });
}
let commandId;
for (const [id, allow] of [
  ["allowCheck", true],
  ["denyCheck", false],
]) {
  $(id).addEventListener("click", () =>
    post("commandDecision", { id: commandId, allow }),
  );
}
window.addEventListener("message", ({ data }) => {
  switch (data.type) {
    case "start":
      $("request").value = data.prompt;
      $("model").textContent = data.model;
      $("activity").replaceChildren();
      $("stream").textContent = "";
      $("batch").hidden = true;
      $("review").hidden = true;
      $("session").hidden = true;
      break;
    case "status":
      $("status").textContent = data.text;
      $("run").disabled = data.busy;
      $("request").disabled = data.busy;
      $("cancel").hidden = !data.busy;
      break;
    case "session":
      $("session").hidden = false;
      break;
    case "event": {
      const entry = item("li", data.text);
      $("activity").append(entry);
      if (data.details?.length) {
        const box = item("details", "");
        box.append(item("summary", "Selected context"));
        for (const detail of data.details) box.append(item("p", detail));
        entry.append(box);
      }
      $("activity").scrollTop = $("activity").scrollHeight;
      break;
    }
    case "token":
      $("stream").textContent = ($("stream").textContent + data.text).slice(
        -14000,
      );
      $("stream").scrollTop = $("stream").scrollHeight;
      break;
    case "review":
      renderReview(data);
      break;
    case "commandReview":
      commandId = data.id;
      $("commandArgs").textContent = [
        data.program,
        ...data.args.map((a) => JSON.stringify(a)),
      ].join(" ");
      $("commandReview").hidden = false;
      $("commandReview").scrollIntoView({ block: "nearest" });
      break;
    case "reviewDone":
      $("commandReview").hidden = true;
      $("review").hidden = true;
      break;
    case "batch":
      $("files").replaceChildren(...data.files.map((name) => item("li", name)));
      $("batch").hidden = !data.files.length;
      $("apply").disabled = !data.ready;
      $("discard").disabled = !data.ready;
      break;
  }
});
post("ready");
