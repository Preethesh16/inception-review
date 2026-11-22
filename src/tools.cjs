"use strict";

const { z } = require("zod");
const { createReplacement } = require("./review.cjs");
const { findText } = require("./trace-search.cjs");

function editorTools({
  workspace,
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
    let proposed;
    if (args.placement === "append") proposed = current + args.replacement;
    else if (args.placement === "prepend")
      proposed = args.replacement + current;
    else proposed = createReplacement(current, args.original, args.replacement);
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
        "Read existing or staged file text. Start at a line number, or near the first occurrence of a literal anchor. Returns exact text suitable for an original edit anchor.",
      inputSchema: {
        path: z.string(),
        start: z.number().int().positive().optional(),
        near: z.string().min(1).optional(),
        count: z.number().int().min(1).max(120).optional(),
      },
      annotations: { readOnlyHint: true },
      run: async ({ path, start = 1, near, count = 45 }) => {
        signal.throwIfAborted();
        const snap = await snapshot(path),
          text = batch.open(path, snap),
          lines = text.split(/\r?\n/);
        if (near) {
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
        "Propose one code, test or documentation edit. For replace, original is an exact unique substring from the file. For append or prepend use an empty original. The user reviews each hunk before staging.",
      inputSchema: {
        path: z.string(),
        placement: z.enum(["replace", "append", "prepend"]),
        original: z.string(),
        replacement: z.string(),
      },
      run: async (args) => {
        signal.throwIfAborted();
        const { proposal } = consume("propose_edit", args);
        const n = batch.stage(args.path, await snapshot(args.path), proposal);
        report({ kind: "staged", path: args.path, hunks: n });
        return {
          path: args.path,
          acceptedHunks: n,
          stagedFiles: batch.files.size,
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
        return result;
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
