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

// ---- WebSocket: Client (frontend) ----

const clientWss = new WebSocketServer({ server, path: "/ws" });
clientWss.on("connection", handleClientConnection);

// ---- WebSocket: Agent ----

const agentWss = new WebSocketServer({ server, path: "/agent" });
agentWss.on("connection", handleAgentConnection);

// ---- Start ----

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`[agentbox] server running on http://localhost:${PORT}`);
  console.log(`[agentbox] client ws:  ws://localhost:${PORT}/ws`);
  console.log(`[agentbox] agent ws:   ws://localhost:${PORT}/agent`);
});
