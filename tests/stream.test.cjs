const test = require("node:test");
const assert = require("node:assert/strict");

test("resume a quiet stream from its last durable event without creating another turn", async () => {
  const { ForgeTurn } = await import("../src/session.mjs");
  const notifications = [];
  const run = new ForgeTurn("http://localhost:8790", {
    onEvent: (event) => notifications.push(event.type),
  });
  run.session = "session-under-test";
  async function* interrupted() {
    yield { type: "turn.created", id: "created", turnId: "existing-turn" };
    yield { type: "tool.response", id: "completed-read" };
    throw new TypeError("terminated");
  }
  const subscriptions = [];
  run.client = {
    sessions: {
      subscribeToTurn: async (session, turn, cursor) => {
        subscriptions.push([session, turn, cursor]);
        return [
          { type: "turn.done", id: "done", state: { status: "completed" } },
        ];
      },
    },
  };
  const types = [];
  for await (const event of run.observe(interrupted())) types.push(event.type);
  assert.deepEqual(subscriptions, [
    ["session-under-test", "existing-turn", { afterEventId: "completed-read" }],
  ]);
  assert.deepEqual(types, ["turn.created", "tool.response", "turn.done"]);
  assert.deepEqual(notifications, ["stream.reconnected"]);
});

test("use the actual final event when the live stream has already expired", async () => {
  const { ForgeTurn } = await import("../src/session.mjs");
  const run = new ForgeTurn("http://localhost:8790", { onEvent() {} });
  run.session = "existing-session";
  const final = {
    type: "turn.done",
    id: "final-event",
    state: { status: "done", output: { content: "verified" } },
  };
  const old = { type: "tool.response", id: "last-seen" };
  async function* dropped() {
    yield old;
    throw new TypeError("terminated");
  }
  run.client = {
    sessions: {
      subscribeToTurn: async () => {
        throw Object.assign(new Error("expired"), { statusCode: 412 });
      },
      listTurnEvents: async (session, turn, opts) => {
        assert.deepEqual(
          [session, turn, opts],
          ["existing-session", "original-turn", { order: "desc", limit: 1 }],
        );
        return [final];
      },
    },
  };
  const observed = [];
  for await (const event of run.observe(dropped(), "original-turn"))
    observed.push(event);
  assert.deepEqual(observed, [old, final]);
});
