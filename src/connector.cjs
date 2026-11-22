"use strict";

const { randomBytes } = require("node:crypto");
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const {
  createMcpExpressApp,
} = require("@modelcontextprotocol/sdk/server/express.js");
const {
  StreamableHTTPServerTransport,
} = require("@modelcontextprotocol/sdk/server/streamableHttp.js");

async function startConnector(toolset, name) {
  const token = randomBytes(32).toString("hex");
  const app = createMcpExpressApp({ host: "127.0.0.1" });
  app.post("/mcp", async (req, res) => {
    if (req.headers.origin || req.headers.authorization !== "Bearer " + token) {
      res.sendStatus(403);
      return;
    }
    const mcp = new McpServer({ name, version: "0.1.0" });
    for (const [key, definition] of Object.entries(toolset)) {
      const { run, ...config } = definition;
      mcp.registerTool(key, config, async (args) => {
        try {
          const result = await run(args);
          return {
            content: [
              {
                type: "text",
                text:
                  typeof result === "string" ? result : JSON.stringify(result),
              },
            ],
          };
        } catch (error) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: error.message || "Workspace operation failed.",
              },
            ],
          };
        }
      });
    }
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => {
      void mcp.close().catch(() => {});
    });
    try {
      await mcp.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch {
      if (!res.headersSent) res.status(500).end();
    }
  });
  const listener = await new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
    server.once("error", reject);
  });
  return {
    manifest: {
      type: "remote",
      name,
      url: "http://127.0.0.1:" + listener.address().port + "/mcp",
      description:
        "Editor workspace search, file reads, proposed edits and verification.",
      auth: { type: "header", headers: { Authorization: "Bearer " + token } },
    },
    close: () =>
      new Promise((resolve) => {
        listener.close(resolve);
        listener.closeAllConnections();
      }),
  };
}
module.exports = { startConnector };
