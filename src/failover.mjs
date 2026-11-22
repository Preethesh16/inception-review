import { ForgeTurn } from "./session.mjs";

export class ModelRun {
  constructor(url, { onEvent, onApproval, canRetry }) {
    this.url = url;
    this.onEvent = onEvent;
    this.onApproval = onApproval;
    this.canRetry = canRetry;
    this.controller = new AbortController();
  }
  async cancel() {
    this.controller.abort();
    await this.active?.cancel();
  }
  async run(spec, content, fallback) {
    const primary = spec.model.name;
    const choices =
      fallback && primary !== fallback ? [primary, fallback] : [primary];
    for (const [index, name] of choices.entries()) {
      this.controller.signal.throwIfAborted();
      const turn = new ForgeTurn(this.url, {
        onEvent: (e) => this.onEvent({ ...e, activeModel: name }),
        onApproval: this.onApproval,
      });
      this.active = turn;
      const state = await turn.run(
        { ...spec, model: { ...spec.model, name } },
        content,
      );
      this.controller.signal.throwIfAborted();
      const modelFailure =
        state.status === "error" &&
        /\[model error\]|model (?:provider|endpoint)|api key|rate limit/i.test(
          state.message || "",
        );
      if (
        index === 0 &&
        choices.length === 2 &&
        modelFailure &&
        this.canRetry()
      ) {
        this.onEvent({
          type: "model.failover",
          from: name,
          to: fallback,
          message: state.message,
        });
        continue;
      }
      return { state, model: name, session: turn.session };
    }
  }
}
