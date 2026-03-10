import express from "express";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import cors from "cors";

const app = express();
const server = createServer(app);

app.use(cors());
app.use(express.json());

// REST API
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: Date.now() });
});

// WebSocket
const wss = new WebSocketServer({ server, path: "/ws" });

const clients = new Set();

wss.on("connection", (ws) => {
  clients.add(ws);
  console.log(`[ws] client connected (total: ${clients.size})`);

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw);
      console.log(`[ws] received:`, msg);

      // Broadcast to all other clients
      for (const client of clients) {
        if (client !== ws && client.readyState === 1) {
          client.send(JSON.stringify(msg));
        }
      }
    } catch (e) {
      console.error("[ws] invalid message:", e.message);
    }
  });

  ws.on("close", () => {
    clients.delete(ws);
    console.log(`[ws] client disconnected (total: ${clients.size})`);
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`[agentbox] server running on http://localhost:${PORT}`);
});
