import express from "express";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import cors from "cors";
import { handleClientConnection } from "./client-handler.js";
import { handleAgentConnection } from "./agent-handler.js";
import * as store from "./store/memory.js";

const app = express();
const server = createServer(app);

app.use(cors());
app.use(express.json());

// ---- REST API ----

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: Date.now() });
});

app.get("/api/agents", (_req, res) => {
  res.json(store.listAgents());
});

app.get("/api/conversations", (_req, res) => {
  res.json(store.listConversations());
});

// ---- WebSocket (noServer mode to support multiple paths) ----

const clientWss = new WebSocketServer({ noServer: true });
clientWss.on("connection", handleClientConnection);

const agentWss = new WebSocketServer({ noServer: true });
agentWss.on("connection", handleAgentConnection);

server.on("upgrade", (request, socket, head) => {
  const { pathname } = new URL(request.url ?? "/", `http://${request.headers.host}`);

  if (pathname === "/ws") {
    clientWss.handleUpgrade(request, socket, head, (ws) => {
      clientWss.emit("connection", ws, request);
    });
  } else if (pathname === "/agent") {
    agentWss.handleUpgrade(request, socket, head, (ws) => {
      agentWss.emit("connection", ws, request);
    });
  } else {
    socket.destroy();
  }
});

// ---- Start ----

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`[agentbox] server running on http://localhost:${PORT}`);
  console.log(`[agentbox] client ws:  ws://localhost:${PORT}/ws`);
  console.log(`[agentbox] agent ws:   ws://localhost:${PORT}/agent`);
});
