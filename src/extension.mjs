import vscode from "vscode";
import agentDefinition from "../agent/workspace.json";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Workspace } from "./workspace.cjs";
import { EditBatch } from "./batch.cjs";
import { applyDocuments } from "./editor-apply.cjs";
import { ReviewPanel } from "./panel.cjs";
import { references, definitions } from "./mentions.cjs";
import { referencedDefinitions, relatedTest } from "./neighbors.cjs";
import { rejectsSchema, replacementText } from "./inline.cjs";
import { ModelRun } from "./failover.mjs";
import { editorTools } from "./tools.cjs";
import { startConnector } from "./connector.cjs";
import { verify } from "./verify.cjs";

const inlineFormat = {
  type: "json_schema",
  jsonSchema: {
    name: "selection_edit",
    strict: true,
    schema: {
      type: "object",
      properties: {
        replacement: {
          type: "string",
          description: "The full revised source code for the selection.",
        },
      },
      required: ["replacement"],
      additionalProperties: false,
    },
  },
};

export function activate(context) {
  let panel, active, lastSession, batch, workspace;
  const cfg = () => vscode.workspace.getConfiguration("inceptionReview");
  const uri = (name) => vscode.Uri.file(path.join(workspace.root, name));
  const snapshot = async (name) => {
    const doc = await vscode.workspace.openTextDocument(
      vscode.Uri.file(await workspace.resolve(name)),
    );
    return { version: doc.version, text: doc.getText() };
  };
  const status = (text, busy = false) =>
    panel?.post({ type: "status", text, busy });
  const event = (text, details) =>
    panel?.post({ type: "event", text, details });
  const updateBatch = () =>
    panel?.post({
      type: "batch",
      files: [...(batch?.files.keys() || [])],
      ready: !active,
    });
  async function cancel() {
    if (!active) return;
    const job = active;
    job.controller.abort();
    batch?.discard();
    updateBatch();
    status("Cancelling · proposed edits discarded", true);
    try {
      await job.run.cancel();
    } catch (e) {
      event("Server cancellation: " + e.message);
    }
  }
  async function action(msg) {
    if (msg.type === "cancel") return cancel();
    if (msg.type === "session" && lastSession)
      return vscode.env.openExternal(vscode.Uri.parse(lastSession));
    if (msg.type === "run") return execute(msg.prompt);
    if (active || !batch) return;
    if (msg.type === "discard") {
      batch.discard();
      batch = null;
      updateBatch();
      status("Discarded");
    }
    if (msg.type === "apply") {
      const count = await batch.commit(snapshot, (files) =>
        applyDocuments(files, uri),
      );
      batch = null;
      updateBatch();
      status(
        "Applied to " +
          count +
          " file" +
          (count === 1 ? "" : "s") +
          " · use editor Undo to revert",
      );
    }
  }
  function open() {
    if (panel) {
      panel.reveal();
      return;
    }
    panel = new ReviewPanel(
      vscode.Uri.joinPath(context.extensionUri, "web"),
      action,
      () => {
        void cancel();
        batch?.discard();
        panel = null;
      },
    );
    status("Ready");
  }
  async function execute(instruction, selection) {
    if (typeof instruction !== "string" || !instruction.trim()) return;
    if (active || batch?.files.size) {
      vscode.window.showInformationMessage(
        "Finish the current run and apply or discard staged edits first.",
      );
      return;
    }
    if (!vscode.workspace.isTrusted)
      throw new Error("Open a trusted project to start a coding session.");
    const root =
      (selection && vscode.workspace.getWorkspaceFolder(selection.doc.uri)) ||
      vscode.workspace.workspaceFolders?.[0];
    if (!root || root.uri.scheme !== "file")
      throw new Error("Open a local Git workspace first.");
    const settings = cfg(),
      model =
        (selection && settings.get("inlineModel")) || settings.get("model"),
      fallback = settings.get("fallbackModel");
    if (!model) {
      await vscode.commands.executeCommand(
        "workbench.action.openSettings",
        "inceptionReview.model",
      );
      return;
    }
    const url = new URL(settings.get("serverUrl"));
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
      throw new Error(
        "Start TrueForge locally and configure its loopback URL.",
      );
    const base = url.origin;
    open();
    panel.post({ type: "start", model, prompt: instruction });
    batch = new EditBatch();
    workspace = new Workspace(root.uri.fsPath);
    const controller = new AbortController(),
      signal = controller.signal;
    let lastCheck;
    let approval = async () => ({
        status: "deny",
        reason: "No tool approval is available.",
      }),
      connector,
      endpoint;
    const run = new ModelRun(base, {
      canRetry: () => !batch.files.size,
      onApproval: async (call) => {
        try {
          return await approval(call);
        } catch (e) {
          event("Review declined · " + e.message);
          return { status: "deny", reason: e.message };
        }
      },
      onEvent: (e) => {
        if (e.type === "session.open") {
          lastSession = base + "/sessions/" + encodeURIComponent(e.session);
          panel?.post({ type: "session" });
          event("TrueForge session opened · " + e.activeModel);
        }
        if (
          e.type === "thread.context_compaction_finished" ||
          e.reason === "compaction"
        )
          event("TrueForge compacted earlier session history");
        if (e.type === "stream.reconnected")
          event("Resuming the same TrueForge turn after a connection interruption");
        if (e.type === "model.failover")
          event("Primary model unavailable · switching to " + e.to);
        if (e.type === "model.message.delta" || e.type === "model.message") {
          if (typeof e.content === "string")
            panel?.post({ type: "token", text: e.content });
          for (const c of e.toolCalls || []) {
            if (c.function?.name) event("Tool requested · " + c.function.name);
            if (typeof c.function?.arguments === "string")
              panel?.post({ type: "token", text: c.function.arguments });
          }
        }
      },
    });
    active = { controller, run };
    status("Reading workspace", true);
    try {
      await workspace.index();
      signal.throwIfAborted();
      let spec = {
          model: {
            name: model,
            params: { temperature: 0, maxTokens: selection ? 1000 : 2300 },
          },
          config: {
            ...agentDefinition.config,
            iterationLimit: selection
              ? 2
              : agentDefinition.config.iterationLimit,
          },
        },
        input = instruction;
      if (selection) {
        const { doc, start, end, original } = selection;
        const name = path.relative(root.uri.fsPath, doc.uri.fsPath);
        await workspace.resolve(name);
        input +=
          "\n\nSelected " +
          doc.languageId +
          " code:\n" +
          original.text.slice(start, end);
        spec.instructions =
          "Revise the code according to the user request. Return its entire revised text in the replacement field. Preserve surrounding indentation.";
        spec.responseFormat = inlineFormat;
      } else {
        const pins = [],
          symbols = [];
        for (const ref of references(instruction)) {
          if (ref.kind === "file") {
            if (!workspace.paths.has(ref.value))
              throw new Error("File mention not found: " + ref.value);
            pins.push(ref.value);
          } else {
            const matches = definitions(workspace.repository, ref.value);
            if (!matches.length)
              throw new Error("Symbol not found: " + ref.value);
            for (const hit of matches) {
              pins.push(hit.name);
              symbols.push(hit);
            }
          }
        }
        const budget = settings.get("contextCharacters");
        const symbolAllowance = symbols.length
          ? Math.min(Math.floor(budget / 3), symbols.length * 450)
          : 0;
        const chosen = workspace.search(
          instruction,
          budget - symbolAllowance,
          pins,
        );
        let remaining =
          budget - chosen.reduce((n, x) => n + x.excerpt.length, 0);
        const mentions = symbols.map((x) => {
          const excerpt = x.excerpt.slice(0, remaining);
          remaining -= excerpt.length;
          return { ...x, excerpt };
        });
        const neighbors = [];
        for (const hit of chosen) {
          if (!remaining) break;
          const file = workspace.repository.files.find(
            (file) => file.name === hit.name,
          );
          const definitions = referencedDefinitions(
            hit.name,
            file.text,
            hit.excerpt,
            instruction,
            Math.min(remaining, 650),
          );
          for (const def of definitions) {
            neighbors.push(def);
            remaining -= def.excerpt.length;
          }
        }
        const implementation = chosen
          .filter(
            (hit) => hit.name.endsWith(".py") && !/(^|\/)test_/.test(hit.name),
          )
          .map((hit) => hit.excerpt)
          .join("\n");
        for (const hit of chosen) {
          if (remaining < 80) break;
          if (
            !/^(?:from|import) /m.test(hit.excerpt) ||
            /def test_/.test(hit.excerpt)
          )
            continue;
          const file = workspace.repository.files.find(
            (file) => file.name === hit.name,
          );
          const [example] = relatedTest(
            hit.name,
            file.text,
            implementation,
            Math.min(remaining, 620),
          );
          if (example) {
            neighbors.push(example);
            remaining -= example.excerpt.length;
          }
        }
        event(
          "Retrieved " +
            chosen.length +
            " files · " +
            (budget - remaining) +
            " / " +
            budget +
            " excerpt characters",
          [
            ...chosen.map(
              (x) => x.name + " · line " + x.line + " · " + x.reason,
            ),
            ...neighbors.map(
              (x) =>
                x.definition +
                " · " +
                x.name +
                ":" +
                x.line +
                " · " +
                (x.reason || "referenced definition"),
            ),
          ],
        );
        input +=
          "\n\nRepository excerpts (workspace data):\n" +
          JSON.stringify({ chosen, mentions, neighbors });
        const { toolset, approve } = editorTools({
          workspace,
          initialLocations: new Map(
            chosen.map((hit) => [hit.name, Math.max(1, hit.line - 4)]),
          ),
          batch,
          snapshot,
          signal,
          review: (p, r, s) => panel.review(p, r, s),
          confirmCommand: (args, approvalSignal) =>
            panel.confirmCommand(args, approvalSignal),
          runCheck: ({ program, args }) =>
            verify(
              workspace.root,
              batch.files,
              program,
              args,
              settings.get("pythonEnvironment"),
              signal,
            ),
          report: (e) => {
            if (e.kind === "check") lastCheck = e;
            if (e.kind === "staged") lastCheck = undefined;
            event(
              e.kind +
                " · " +
                (e.path || e.query || e.program || "") +
                (e.kind === "check"
                  ? " · exit " + e.code + "\n" + e.output
                  : ""),
            );
            updateBatch();
          },
        });
        approval = approve;
        const name = "inception-" + randomUUID().slice(0, 12);
        connector = await startConnector(toolset, name);
        endpoint = base + "/api/v1/settings/mcp-servers";
        const registered = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ manifest: connector.manifest }),
          signal,
        });
        if (!registered.ok)
          throw new Error(
            "TrueForge could not register the editor tools (" +
              registered.status +
              ").",
          );
        endpoint += "/" + name;
        spec.config.compaction = {
          enabled: true,
          trigger: {
            type: "input_tokens",
            value: settings.get("compactionTokens"),
          },
        };
        spec.mcpServers = [
          {
            name,
            preload: true,
            requireApprovalForTools: ["propose_edit", "run_check"],
          },
        ];
        spec.instructions = agentDefinition.instructions;
      }
      signal.throwIfAborted();
      status("Streaming from TrueForge", true);
      let result = await run.run(spec, input, fallback);
      let fenced = false;
      if (selection && rejectsSchema(result.state)) {
        signal.throwIfAborted();
        event(
          "Model does not support structured output · retrying with a fenced replacement",
        );
        const textSpec = {
          ...spec,
          model: { ...spec.model, name: result.model },
          instructions:
            "Revise only the selected text. Return the complete revised selection in one fenced code block, preserving indentation. Include no surrounding explanation.",
        };
        delete textSpec.responseFormat;
        result = await run.run(textSpec, input);
        fenced = true;
      }
      const { state } = result;
      signal.throwIfAborted();
      if (state.status !== "done")
        throw new Error(
          state.message || "TrueForge ended the turn: " + state.status,
        );
      if (selection) {
        const { doc, start, end, original } = selection,
          name = path.relative(root.uri.fsPath, doc.uri.fsPath);
        const replacement = replacementText(state.output?.content, fenced);
        const proposed =
          original.text.slice(0, start) +
          replacement +
          original.text.slice(end);
        const review = batch.prepare(name, original, proposed);
        if (review.hunks.length) {
          await panel.review(name, review, signal);
          batch.stage(name, await snapshot(name), review);
        }
      }
      if (!batch.files.size) status("Finished without staged edits");
      else if (selection) status("Review complete · ready to apply");
      else if (!lastCheck)
        status(
          "Review complete · latest staged changes have no verification result",
        );
      else if (lastCheck.code !== 0)
        status("Review complete · staged verification failed");
      else status("Review complete · last staged check passed");
    } catch (e) {
      batch?.discard();
      status(
        signal.aborted
          ? "Cancelled · workspace preserved"
          : "Run stopped · " + e.message,
      );
    } finally {
      if (endpoint?.includes("/mcp-servers/"))
        await fetch(endpoint, {
          method: "DELETE",
          signal: AbortSignal.timeout(4000),
        }).catch(() => {});
      await connector?.close();
      active = null;
      updateBatch();
    }
  }
  async function inline() {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.selection.isEmpty) {
      vscode.window.showInformationMessage(
        "Select code in a workspace file first.",
      );
      return;
    }
    const doc = editor.document,
      sel = editor.selection;
    const capture = {
      doc,
      start: doc.offsetAt(sel.start),
      end: doc.offsetAt(sel.end),
      original: { text: doc.getText(), version: doc.version },
    };
    const prompt = await vscode.window.showInputBox({
      title: "Inception Review · edit selection",
      prompt: "Describe the change to this selection",
      ignoreFocusOut: true,
    });
    if (prompt) await execute(prompt, capture);
  }
  for (const [key, fn] of Object.entries({ open, inline, cancel }))
    context.subscriptions.push(
      vscode.commands.registerCommand("inceptionReview." + key, fn),
    );
  context.subscriptions.push({
    dispose: () => {
      void cancel();
      panel?.view.dispose();
    },
  });
}
