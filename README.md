# Inception Review

A VS Code extension for reviewing a coding agent's work before it reaches your files. Ask for a change, see which passages the agent used, and decide which hunks to keep. TrueForge runs the model and its tools. Accepted changes stay in a staging area until you apply the batch.

## Run from a clean clone

Use Node 22 or 24, npm, Git, and desktop VS Code 1.102 or later. The optional staged command verifier currently requires Linux with bubblewrap and enabled user namespaces. Model inference can run locally or through a provider configured in TrueForge.

1. Build the extension.

   ```sh
   git clone https://github.com/Preethesh16/inception-review.git
   cd inception-review
   npm ci
   npm test
   npm run build
   ```

2. Start the local harness in a separate terminal. The loopback allowlist permits TrueForge to reach the extension's short-lived MCP connector and a local inference endpoint. The model header timeout accommodates cold CPU inference.

   ```sh
   OUTBOUND_URL_ALLOWED_HOSTS='["127.0.0.1"]' \
   MODEL_HTTP_HEADERS_TIMEOUT_MS=240000 \
   npx --yes @truefoundry/trueforge@0.185.1 --port 8790
   ```

3. Configure a model in the TrueForge dashboard under Settings → Model providers. For the example local configuration, start an OpenAI-compatible inference server at port 8080 with model alias `instruct`, then register the included example from the extension repository.

   ```sh
   curl --fail-with-body http://localhost:8790/api/v1/settings/model-providers \
     -H 'Content-Type: application/json' --data-binary @examples/model-provider.json
   ```

   A model used for agent mode must support native tool calls. The inline model must support JSON-schema output. You can configure different models for these jobs. Credentials belong in TrueForge.

4. From the extension repository, open a local Git checkout in a development host.

   ```sh
   git clone --branch 3.1.3 --depth 1 https://github.com/pallets/flask.git ../flask-3.1.3
   code --new-window --extensionDevelopmentPath="$PWD" ../flask-3.1.3
   ```

   In that window, open user Settings and search for **Inception Review**. Set **Model** to the model identifier from TrueForge, such as `local-editor/instruct`. The sample settings are in [examples/settings.json](examples/settings.json). To use F5, open the extension repository in VS Code, build once, then launch **Run Inception Review** and open the target project in the development host.

5. Open **Inception Review: Open Agent** from the Command Palette. The extension loads [the agent definition](agent/workspace.json) into each new TrueForge session. It adds the selected model, context limit, current workspace connector and approval policy at runtime. **Open session** shows the corresponding TrueForge trace.

## Use the editor

- **Inline edit.** Select a code region and run **Inception Review: Edit Selection**. The default shortcut is Ctrl+Alt+I (Cmd+Alt+I on macOS) when a selection is active. Enter an instruction, review the highlighted changes beside the source, choose Accept or Reject for each hunk, then confirm. **Apply reviewed changes** issues a single native editor operation.
- **Agent mode.** Enter an instruction without paths, or include `@file(src/example.py)` and `@symbol:example`. Expand **Selected context** to inspect the initial locations and ranking reasons. Search, read, edit and verification calls appear as they happen.
- **Verification.** A proposed command requires approval. The Linux verifier copies eligible workspace files into a disposable directory, overlays the accepted changes, disables networking, and runs the selected program there. Supported programs are pytest, Python, Flask, Node and npm. Set **Python Environment** to an absolute trusted virtual environment path when dependencies are required.
- **Undo and cancel.** Use editor Undo after applying a batch. Cancel during generation or review to discard staged edits. If a file changes during review, the editor refuses the stale batch.
- **Fallback.** Configure a second model under **Fallback Model**. A classified model failure can start a new TrueForge session on the fallback before any edit has been staged. Every switch appears in the activity list.

## Exercise the Flask fixture

From the pinned Flask checkout, create a virtual environment outside the repository and install the test dependencies. Use Python 3.11 or later, then configure that environment in the extension.

```sh
python3 -m venv ../flask-review-env
. ../flask-review-env/bin/activate
python -m pip install -e '.[async,dotenv]' 'pytest>=8,<9' blinker
python -m pytest tests/test_cli.py -q
```

## Starting point and dependencies

Team Inception built the extension from scratch. The Flask tag is the demonstration target. The extension uses the TrueForge TypeScript SDK, the Model Context Protocol SDK, Zod, jsdiff, and esbuild. The MIT licence covers our source. Each ordinary dependency retains its own licence.

## Design and evidence

The initial retriever scores text with BM25-style term weighting and filename matches, reserves two places for direct matches, then looks for companion files sharing an implementation filename. It splits a configurable character budget across short passages. Any remaining room can hold a Python declaration referenced by a retrieved passage, including its nearby decorators. Ranking reasons, paths and line numbers accompany the excerpts. The cap covers excerpt text. Tool schemas, user messages and metadata also consume model context. TrueForge can compact older turns as a session grows.

The MCP connector binds to loopback and authenticates each request with an ephemeral bearer token. TrueForge pauses for approval before an edit or verification call. The editor binds that approval to the exact arguments and consumes it once. It validates document versions and contents when staging and immediately before the native multi-file edit. Clean documents are saved. Existing unsaved editor changes stay available for the user to save.

One warm local benchmark on Flask indexed 215 text files and 1.14 MB in 344 ms. Across 25 repetitions of the fixed CLI question the median retrieval time was 20.7 ms and the 95th percentile was 27.7 ms. The selected files included implementation, tests and documentation in 2,165 excerpt characters. Following a reference to a neighboring declaration added 456 characters and preserved the 3,500-character cap. These are local measurements, not a forecast of hours or money saved. The engineering goal is to let one reviewer reject a risky hunk or test a candidate without first cleaning up their working tree.

The design draws on iterative retrieval in [RepoCoder](https://arxiv.org/abs/2303.12570), the editor/tool interface in [SWE-agent](https://arxiv.org/abs/2405.15793), localization and validation in [Agentless](https://arxiv.org/abs/2407.01489), [Aider's repository map](https://aider.chat/docs/repomap.html), and [Continue's selection editing](https://docs.continue.dev/ide-extensions/edit/quick-start). Codex assisted with research, implementation, tests and recording.

The [retrieval study](research/README.md) includes runnable benchmarks and model-trial results.

For the native editor integration test, run `npm run test:editor` with desktop VS Code available on your PATH and a graphical display. It creates a temporary profile and workspace, applies a partial three-file batch, performs native Undo, and verifies that a manual edit stops a later batch from overwriting any file.
