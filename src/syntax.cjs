"use strict";
const { spawn } = require("node:child_process");
const { applyAccepted } = require("./batch.cjs");

const parser = [
  "import ast, json, sys",
  "def inspect(source):",
  "    try: ast.parse(source)",
  "    except SyntaxError as error: return {'line': error.lineno, 'message': error.msg}",
  "    return None",
  "print(json.dumps([inspect(s) for s in json.load(sys.stdin)]))",
].join("\n");

class ProposalSyntaxError extends Error {}

async function checkPythonSyntax(path, original, proposed, signal) {
  if (!path.endsWith(".py")) return;
  const detail = await new Promise((resolve, reject) => {
    // Isolated mode excludes the open repository and user site-packages.
    // Only the parser runs. No code from the proposal is imported or executed.
    const child = spawn("python3", ["-I", "-S", "-c", parser], {
      stdio: ["pipe", "pipe", "ignore"],
      signal,
      timeout: 4000,
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stdin.on("error", () => {});
    child.on("error", (e) => (e.code === "ENOENT" ? resolve(null) : reject(e)));
    child.on("close", (code) => {
      if (code !== 0) return resolve(null);
      try {
        resolve(JSON.parse(output));
      } catch {
        resolve(null);
      }
    });
    child.stdin.end(JSON.stringify([original, proposed]));
  });
  if (detail && !detail[0] && detail[1])
    throw new ProposalSyntaxError(
      "The proposal introduces a Python syntax error on line " +
        detail[1].line +
        ": " +
        detail[1].message +
        ". Read the surrounding lines and revise the edit.",
    );
  return !!detail && !detail[1];
}
async function checkReviewedPython(path, review, signal) {
  if (
    !path.endsWith(".py") ||
    !review.hunks.some((h) => h.decision === "reject")
  )
    return;
  const accepted = review.acceptedEdits(review.original, review.version);
  if (!accepted.length) return;
  await checkPythonSyntax(
    path,
    review.original,
    applyAccepted(review.original, accepted),
    signal,
  );
}

module.exports = {
  checkPythonSyntax,
  checkReviewedPython,
  ProposalSyntaxError,
};
