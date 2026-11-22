"use strict";

const { z } = require("zod");
const { checkPythonSyntax } = require("./syntax.cjs");
const { createReplacement, insertAtAnchor } = require("./review.cjs");
const { findText } = require("./trace-search.cjs");
const { definitions } = require("./mentions.cjs");

function editorTools({
  workspace,
  initialLocations = new Map(),
  batch,
  snapshot,
  review,
  confirmCommand,
  runCheck,
  signal,
  report,
}) {
  const permitted = new Map();
  const consume = (tool, args) => {
    const key = JSON.stringify([tool, args]);
    const record = permitted.get(key);
    if (!record)
      throw new Error("This operation requires a matching TrueForge approval.");
    permitted.delete(key);
    return record;
  };
  const prepare = async (args) => {
    const snap = await snapshot(args.path);
    const current = batch.open(args.path, snap);
    if (
      args.path.endsWith(".py") &&
      args.placement === "append" &&
      /^if __name__ *== *["']__main__["'] *:/m.test(current)
    ) {
      throw new Error(
        "This Python module has a script entry point. Read the nearest existing declaration and insert_before an exact anchor above its first use.",
      );
    }
    let proposed;
    if (args.placement === "append") proposed = current + args.replacement;
    else if (args.placement === "prepend")
      proposed = args.replacement + current;
    else if (
      args.placement === "insert_before" ||
      args.placement === "insert_after"
    )
      proposed = insertAtAnchor(
        current,
        args.original,
        args.replacement,
        args.placement,
      );
    else proposed = createReplacement(current, args.original, args.replacement);
    await checkPythonSyntax(args.path, current, proposed, signal);
    return { snap, proposal: batch.prepare(args.path, snap, proposed) };
  };
  const toolset = {
    search_workspace: {
      description:
        "Find relevant implementation, tests and documentation for an engineering question. Optionally search a literal text fragment in one path.",
      inputSchema: { query: z.string().min(1), path: z.string().optional() },
      annotations: { readOnlyHint: true },
      run: async ({ query, path }) => {
        signal.throwIfAborted();
        let hits;
        if (path) {
          const snap = await snapshot(path);
          hits = findText(
            [{ name: path, text: batch.open(path, snap) }],
            query,
            path,
          );
        } else {
          hits = workspace
            .search(query, 900)
            .map(({ name, line, reason, excerpt }) => ({
              path: name,
              line,
              reason,
              excerpt,
            }));
        }
        report({ kind: "search", query, hits });
        return hits;
      },
    },
    read_file: {
      description:
        "Read existing or staged file text. Supply a line number, a declaration symbol, or a literal anchor. With neither, the initial retrieval location is used if available. Returns exact text suitable for an original edit anchor.",
      inputSchema: {
        path: z.string(),
        start: z.number().int().positive().optional(),
        near: z.string().min(1).optional(),
        symbol: z.string().min(1).optional(),
        count: z.number().int().min(1).max(120).optional(),
      },
      annotations: { readOnlyHint: true },
      run: async ({
        path,
        start = initialLocations.get(path) || 1,
        near,
        symbol,
        count = 32,
      }) => {
        signal.throwIfAborted();
        const snap = await snapshot(path),
          text = batch.open(path, snap),
          lines = text.split(/\r?\n/);
        if (symbol) {
          const matches = definitions(
            { files: [{ name: path, text }] },
            symbol,
          );
          if (matches.length !== 1)
            throw new Error(
              matches.length
                ? "More than one declaration matches; use its exact start line."
                : "No matching declaration in this file.",
            );
          start = Math.max(1, matches[0].line - 4);
        } else if (near) {
          const i = lines.findIndex((l) => l.includes(near));
          if (i < 0) throw new Error("No matching line in this path.");
          start = Math.max(1, i - 4);
        }
        if (start > lines.length)
          throw new Error("Start line exceeds " + lines.length + ".");
        report({ kind: "read", path, start });
        return {
          path,
          start,
          lines: lines.length,
          text: lines
            .slice(start - 1, start - 1 + count)
            .join("\n")
            .slice(0, 10000),
        };
      },
    },
    propose_edit: {
      description:
        "Propose one code, test or documentation edit. For replace or insert_before/insert_after, original is an exact unique substring from read_file. Insertions preserve that anchor. Insert declarations above the first code that uses them. For append or prepend use an empty original. The user reviews each hunk before staging.",
      inputSchema: {
        path: z.string(),
        placement: z.enum([
          "replace",
          "insert_before",
          "insert_after",
          "append",
          "prepend",
        ]),
        original: z.string(),
        replacement: z.string(),
      },
      run: async (args) => {
        signal.throwIfAborted();
        const { proposal } = consume("propose_edit", args);
        const n = batch.stage(args.path, await snapshot(args.path), proposal);
        report({ kind: "staged", path: args.path, hunks: n });
        const tests = [...batch.files.keys()].filter((name) =>
          /(?:^|\/)(?:test_[^/]+|[^/]+_test)\.py$/.test(name),
        );
        return {
          path: args.path,
          acceptedHunks: n,
          stagedFiles: [...batch.files.keys()],
          verification:
            "Staged changes have not yet been checked. Review the run_check result before reporting success.",
          ...(tests.length
            ? {
                suggestedCheck: {
                  program: "pytest",
                  args: [...tests.slice(0, 16), "-q"],
                },
              }
            : {}),
        };
      },
    },
    run_check: {
      description:
        'Run a verification command with argument array against the staged workspace snapshot. Example program pytest with args ["tests/test_example.py","-q"].',
      inputSchema: {
        program: z.enum(["pytest", "flask", "python", "node", "npm"]),
        args: z.array(z.string()).max(32),
      },
      run: async (args) => {
        signal.throwIfAborted();
        consume("run_check", args);
        const result = await runCheck(args);
        report({ kind: "check", ...args, ...result });
        return { ...result, output: result.output.slice(-3500) };
      },
    },
  };
  async function approve(call) {
    signal.throwIfAborted();
    const key = call.toolInfo?.name || call.function.name;
    let args = JSON.parse(call.function.arguments);
    if (!toolset[key])
      return { status: "deny", reason: "Unrecognized workspace operation." };
    args = z.object(toolset[key].inputSchema).parse(args);
    let record;
    if (key === "propose_edit") {
      record = await prepare(args);
      if (!record.proposal.hunks.length)
        return { status: "deny", reason: "No changes in the proposal." };
      await review(args.path, record.proposal, signal);
      if (!record.proposal.hunks.some((h) => h.decision === "accept"))
        return { status: "deny", reason: "User rejected the proposed edits." };
    } else if (key === "run_check") {
      if (!(await confirmCommand(args, signal)))
        return { status: "deny", reason: "User declined the command." };
      record = {};
    } else return { status: "allow" };
    signal.throwIfAborted();
    permitted.set(JSON.stringify([key, args]), record);
    return { status: "allow" };
  }
  return { toolset, approve };
}
module.exports = { editorTools };
