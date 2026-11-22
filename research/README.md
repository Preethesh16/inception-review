# Why show where the context came from?

A reviewer can assess a proposed command more quickly if the implementation, test, and user-facing documentation are visible together. Whether this actually saves review time requires a controlled study with engineers. We measured the first dependency of that idea, whether the retriever can find those files within a small input budget.

## Retrieval experiment

Run these with the path to a clean Flask 3.1.3 checkout. The Python pilot uses the standard library. The Node experiment runs the extension's ranking code.

```sh
python3 research/retrieval.py ../flask-3.1.3
node research/measure.cjs ../flask-3.1.3
```

The pilot considers 168 Python, Markdown and reStructuredText files and four hand-labeled maintenance requests. For each request, 20 seeded trials independently drop each input word with probability 0.2. This measures sensitivity to wording. The ranking experiment does not sample a language model.

| Mean fraction of labeled files in the first five | Lexical | Shared filename boost |
|---|---:|---:|
| New CLI command | 0.400 | 0.767 |
| Environment configuration | 0.650 | 1.000 |
| Template resolution | 0.600 | 0.600 |
| Streaming request context | 0.975 | 0.950 |

The original CLI prompt ranked its test file seventeenth on lexical evidence alone. Boosting files that share the first implementation's name moved it to fourth. The streaming regression led us to reserve two slots for direct text matches before expanding filenames. With a 2,000-character excerpt allowance, the resulting retriever recovered ten of eleven hand-labeled files across the four unperturbed prompts. It missed the template implementation. Explicit symbol lookup gives reviewers a way to supply that location.

These are development cases from one repository. A separate benchmark on unfamiliar repositories, blind labels, and timed human reviews would be needed to estimate adoption value. RepoCoder studied completion, while this experiment studies retrieval for edits. SWE-agent studied the agent's tool interface, while this extension adds a human decision before a reviewed change reaches a local workspace.

## Model experiments

Two quantized open-weight models ran locally through llama.cpp and TrueForge. Both used Q4_K_M weights. Paid model API charges for these runs were zero. Electricity and development time were not metered.

- Qwen2.5-Coder-3B-Instruct described a search in text without producing a native tool event. Requiring a structured inline replacement produced executable candidates at temperatures 0 and 0.4. Both passed eleven debug-flag behavior cases. Only the zero-temperature candidate documented all five explicit false strings in that trial.
- Qwen3-4B-Instruct-2507 executed a real workspace search at temperature zero. One run at temperature 0.4 reached the tool but encountered a response-header timeout. Some CPU inference requests took longer than TrueForge's default 20-second model header timeout. The documented setup raises that limit. These small samples cannot establish a causal temperature effect.
- Model evaluation and editor evaluation were separate. The regression suite uses deterministic tools and inputs. The submitted demo uses actual TrueForge model responses and editor approvals.

## Sources

- [RepoCoder, Zhang et al.](https://arxiv.org/abs/2303.12570) and its [alphaXiv entry](https://www.alphaxiv.org/abs/2303.12570)
- [SWE-agent, Yang et al.](https://arxiv.org/abs/2405.15793)
- [Agentless, Xia et al.](https://arxiv.org/abs/2407.01489)
- [Aider repository map](https://aider.chat/docs/repomap.html)
- [Continue selection edit](https://docs.continue.dev/ide-extensions/edit/quick-start)

## What broke in the editor trial

The first complete Qwen3 editor run discovered all three Flask paths and produced reviewed edits, but its new test raised a NameError and the built-in command was absent from help. The visible three-file diff and the model's final message were insufficient evidence of success. A rerun also exposed a line insertion that joined two Python statements when the model omitted a trailing newline.

The extension now follows references from retrieved passages to nearby declarations when there is space left in the same excerpt budget. It supports insertion around exact anchors, preserves full-line separators, asks for an anchored edit before a Python script entry point, and rejects a new Python syntax error when a local parser is available. The panel reports whether the current staged revision has a check result. A later edit invalidates the previous result. The isolated verifier allows the agent to repair its own candidate while the original working tree remains available.

A later live agent paged sequentially through a long documentation file. The first read of a Markdown or reStructuredText document now includes up to 35 section titles and line numbers. The unit test covers fenced Markdown examples, reStructuredText headings and subsequent reads without redundant headings. In a separate native VS Code test, the panel returned the correct decisions for accepting, declining and cancelling a proposed verification command.

For the fixed CLI request, the highest-ranked passage in the test file showed imports. We used identifier parts from the retrieved implementation to choose a test that exercises a related function. The additional 282-character excerpt contains the app factory, invocation and assertions. The selected test was `test_no_routes` at line 495 on the pinned checkout. This is evidence of a more informative passage on one task. It does not establish a general improvement in model success rate.

A Qwen3.5-4B session made 12 real workspace tool calls, then the editor's event stream ended during a long silent interval before any edit. The extension can now resubscribe to that same turn from the last event cursor on a transient connection loss. A regression test interrupts the iterator after a completed read and confirms that the original turn supplies the final event.
