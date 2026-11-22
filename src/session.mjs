"use strict";

import {
  TrueForge,
  isEventDelta,
  mergeEventDelta,
} from "@truefoundry/trueforge-sdk";

class ForgeTurn {
  constructor(baseUrl, { onEvent, onApproval }) {
    this.client = new TrueForge({ baseUrl, timeoutInSeconds: 600 });
    this.onEvent = onEvent;
    this.onApproval = onApproval;
    this.controller = new AbortController();
  }

  async cancel() {
    this.controller.abort();
    if (this.session)
      await this.client.sessions.cancel(
        this.session,
        {},
        { timeoutInSeconds: 8 },
      );
  }

  // A local model can be quiet longer than an HTTP connection's idle limit.
  // Resume the same server-side turn instead of starting another generation.
  async *observe(stream, turnId) {
    let cursor;
    let partial = false;
    let attempts = 0;
    for (;;) {
      try {
        for await (const event of stream) {
          if (event.type === "turn.created") turnId = event.turnId;
          if (event.id) cursor = event.id;
          partial = isEventDelta(event) || event.type === "model.message";
          yield event;
        }
        return;
      } catch (error) {
        this.controller.signal.throwIfAborted();
        const reason = [error.message, error.cause?.code, error.code].join(" ");
        if (
          !turnId ||
          !cursor ||
          attempts >= 3 ||
          !/terminated|socket|ECONNRESET|UND_ERR_BODY_TIMEOUT|network/i.test(
            reason,
          )
        )
          throw error;
        attempts++;
        this.onEvent({ type: "stream.reconnected" });
        const options = { abortSignal: this.controller.signal };
        try {
          stream = await this.client.sessions.subscribeToTurn(
            this.session,
            turnId,
            partial ? { fromEventId: cursor } : { afterEventId: cursor },
            options,
          );
        } catch (resumeError) {
          if (resumeError.statusCode !== 412) throw resumeError;
          // The live stream may already have expired after normal completion.
          // Only consume its persisted terminal event, never replay approvals.
          const last = await this.client.sessions.listTurnEvents(
            this.session,
            turnId,
            { order: "desc", limit: 1 },
            options,
          );
          for await (const event of last) {
            if (event.type === "turn.done") {
              yield event;
              return;
            }
            break;
          }
          throw resumeError;
        }
      }
    }
  }

  async run(spec, content) {
    const options = { abortSignal: this.controller.signal };
    const { data } = await this.client.sessions.create(
      { agent: { spec } },
      options,
    );
    this.session = data.id;
    this.controller.signal.throwIfAborted();
    this.onEvent({ type: "session.open", session: this.session });
    let stream = await this.client.sessions.createTurnStream(
      this.session,
      { input: [{ type: "user.message", content }] },
      options,
    );
    const events = new Map();
    let turn;
    for (;;) {
      const requested = [];
      let pausedAt;
      for await (const event of this.observe(stream, turn)) {
        this.controller.signal.throwIfAborted();
        if (isEventDelta(event)) {
          const message = events.get(event.id);
          if (message) mergeEventDelta(message, event);
        } else if (event.type === "model.message") {
          events.set(event.id, event);
        }
        this.onEvent(event);
        if (event.type === "turn.created") turn = event.turnId;
        if (event.type === "turn.done") return event.state;
        if (event.type === "tool.approval_required") requested.push(event);
        if (event.type === "turn.update" && event.state.status === "paused") {
          pausedAt = event.id;
          break;
        }
      }
      if (!pausedAt || !requested.length)
        throw new Error(
          "TrueForge ended the stream before a final result or an actionable approval.",
        );
      const decisions = [];
      for (const request of requested) {
        for (const ref of request.toolCalls) {
          const message = events.get(ref.sourceEventId);
          const call = message?.toolCalls?.find((entry) => entry.id === ref.id);
          const verdict = call
            ? await this.onApproval(call, this.controller.signal)
            : {
                status: "deny",
                reason: "Tool arguments unavailable for review.",
              };
          decisions.push({
            type: "user.tool_approval",
            threadId: request.threadId,
            toolCallId: ref.id,
            approval: verdict,
          });
        }
      }
      this.controller.signal.throwIfAborted();
      stream = await this.client.sessions.subscribeToTurn(
        this.session,
        turn,
        { afterEventId: pausedAt },
        options,
      );
      await this.client.sessions.createTurnEvents(
        this.session,
        turn,
        { events: decisions },
        options,
      );
    }
  }
}
export { ForgeTurn };
