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
