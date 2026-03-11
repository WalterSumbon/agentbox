import express from "express";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import cors from "cors";
import crypto from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { resolve, dirname, join } from "path";
import { fileURLToPath } from "url";
import { handleClientConnection } from "./client-handler.js";
import { handleAgentConnection } from "./agent-handler.js";
import { register, login, loginWithToken, provisionUser, verifyToken, AuthError } from "./auth.js";
import * as store from "./store/sqlite.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();
const server = createServer(app);

// ---------------------------------------------------------------------------
// Agent API Key — used to authenticate agent WebSocket connections.
// Set AGENTBOX_AGENT_KEY env var, or a key is auto-generated and persisted.
// ---------------------------------------------------------------------------
function resolveAgentKey(): string {
  if (process.env.AGENTBOX_AGENT_KEY) {
    return process.env.AGENTBOX_AGENT_KEY;
  }
  // Auto-generate and persist in data directory
  const dataDir = resolve(process.cwd(), "data");
  mkdirSync(dataDir, { recursive: true });
  const keyFile = join(dataDir, ".agent-key");
  try {
    const existing = readFileSync(keyFile, "utf-8").trim();
    if (existing) return existing;
  } catch { /* file doesn't exist */ }
  const key = `agk_${crypto.randomBytes(24).toString("hex")}`;
  writeFileSync(keyFile, key, "utf-8");
  console.log(`[agentbox] generated agent API key: ${key}`);
  return key;
}

export const AGENT_API_KEY = resolveAgentKey();

// ---------------------------------------------------------------------------
// CORS — restrict origins in production, permissive in dev
// ---------------------------------------------------------------------------
const ALLOWED_ORIGINS = process.env.AGENTBOX_CORS_ORIGINS
  ? process.env.AGENTBOX_CORS_ORIGINS.split(",").map(s => s.trim())
  : undefined; // undefined = allow all (dev mode)

app.use(cors({
  origin: ALLOWED_ORIGINS ?? true,
  credentials: true,
}));
app.use(express.json({ limit: "64kb" }));

// ---------------------------------------------------------------------------
// Rate limiting (in-memory, per-IP sliding window)
// ---------------------------------------------------------------------------

interface RateLimitEntry {
  timestamps: number[];
}

const rateLimitMap = new Map<string, RateLimitEntry>();

/**
 * Simple in-memory rate limiter.
 * @param windowMs  Sliding window in milliseconds.
 * @param maxHits   Maximum requests allowed within the window.
 */
function rateLimit(windowMs: number, maxHits: number) {
  return (req: express.Request, res: express.Response, next: express.NextFunction): void => {
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    const now = Date.now();

    let entry = rateLimitMap.get(ip);
    if (!entry) {
      entry = { timestamps: [] };
      rateLimitMap.set(ip, entry);
    }

    // Remove expired entries
    entry.timestamps = entry.timestamps.filter((t) => now - t < windowMs);

    if (entry.timestamps.length >= maxHits) {
      res.status(429).json({
        error: {
          code: "RATE_LIMITED",
          message: "Too many requests. Please try again later.",
        },
      });
      return;
    }

    entry.timestamps.push(now);
    next();
  };
}

// Clean up stale rate limit entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitMap) {
    entry.timestamps = entry.timestamps.filter((t) => now - t < 900_000);
    if (entry.timestamps.length === 0) {
      rateLimitMap.delete(ip);
    }
  }
}, 300_000);

// ---- REST API: Public ----

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: Date.now() });
});

// ---- REST API: Auth ----

// Provision user — protected by agent API key (for Better-Claw CLI integration)
app.post("/api/auth/provision", rateLimit(15 * 60 * 1000, 100), (req, res) => {
  try {
    // Authenticate with agent API key
    const authKey = extractBearerToken(req) || req.body?.agentKey;
    if (authKey !== AGENT_API_KEY) {
      res.status(403).json({ error: { code: "FORBIDDEN", message: "Invalid agent API key" } });
      return;
    }

    const { username, displayName, loginToken } = req.body;
    const result = provisionUser(username, displayName, loginToken);
    res.status(201).json(result);
  } catch (err: any) {
    const status = err instanceof AuthError ? 400 : 500;
    res.status(status).json({ error: { code: err.code ?? "SERVER_ERROR", message: err.message } });
  }
});

// Login — accepts { token } for token-based login (primary), or { username, password } (legacy)
app.post("/api/auth/login", rateLimit(15 * 60 * 1000, 20), async (req, res) => {
  try {
    const { token, username, password } = req.body;

    let result;
    if (token) {
      // Token-based login (primary method)
      result = loginWithToken(token);
    } else if (username && password) {
      // Legacy username+password login
      result = await login(username, password);
    } else {
      res.status(400).json({ error: { code: "INVALID_INPUT", message: "Token is required" } });
      return;
    }

    res.json(result);
  } catch (err: any) {
    const status = err instanceof AuthError ? 401 : 500;
    res.status(status).json({ error: { code: err.code ?? "SERVER_ERROR", message: err.message } });
  }
});

app.get("/api/auth/me", (req, res) => {
  try {
    const token = extractBearerToken(req);
    if (!token) {
      res.status(401).json({ error: { code: "NO_TOKEN", message: "No token provided" } });
      return;
    }
    const user = verifyToken(token);
    res.json(user);
  } catch (err: any) {
    res.status(401).json({ error: { code: err.code ?? "INVALID_TOKEN", message: err.message } });
  }
});

// ---- REST API: Protected ----

app.get("/api/agents", (req, res) => {
  // Require authentication to list agents
  try {
    const token = extractBearerToken(req);
    if (!token) {
      res.status(401).json({ error: { code: "NO_TOKEN", message: "Authentication required" } });
      return;
    }
    verifyToken(token);
    res.json(store.listAgents());
  } catch (err: any) {
    res.status(401).json({ error: { code: err.code ?? "INVALID_TOKEN", message: err.message } });
  }
});

app.get("/api/conversations", (req, res) => {
  try {
    const token = extractBearerToken(req);
    if (!token) {
      res.status(401).json({ error: { code: "NO_TOKEN", message: "Authentication required" } });
      return;
    }
    const user = verifyToken(token);
    res.json(store.listConversations(user.id));
  } catch (err: any) {
    res.status(401).json({ error: { code: err.code ?? "INVALID_TOKEN", message: err.message } });
  }
});

// ---- Helper ----

function extractBearerToken(req: express.Request): string | null {
  const header = req.headers.authorization;
  if (header && header.startsWith("Bearer ")) {
    return header.slice(7);
  }
  return null;
}

// ---- Static files: serve frontend build ----
const webDistPath = resolve(__dirname, "../../web/dist");
if (existsSync(webDistPath)) {
  app.use(express.static(webDistPath));
  // SPA fallback: all non-API/WS paths return index.html.
  app.use((_req, res) => {
    res.sendFile(resolve(webDistPath, "index.html"));
  });
  console.log(`[agentbox] serving web frontend from ${webDistPath}`);
}

// ---- WebSocket (noServer mode to support multiple paths) ----
// Max payload: 256 KB to prevent oversized messages
const WS_MAX_PAYLOAD = 256 * 1024;

const clientWss = new WebSocketServer({ noServer: true, maxPayload: WS_MAX_PAYLOAD });
clientWss.on("connection", (ws, request) => {
  // Extract token from query string for WebSocket auth
  const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
  const token = url.searchParams.get("token");
  handleClientConnection(ws, token);
});

const agentWss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 }); // 1 MB for agents (they may send larger payloads)
agentWss.on("connection", (ws, request) => {
  // Extract agent key from query string
  const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
  const key = url.searchParams.get("key");
  handleAgentConnection(ws, key);
});

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

// ---- Graceful shutdown ----

function shutdown() {
  console.log("[agentbox] shutting down...");
  store.closeDb();
  server.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// ---- Start ----

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`[agentbox] server running on http://localhost:${PORT}`);
  console.log(`[agentbox] client ws:  ws://localhost:${PORT}/ws`);
  console.log(`[agentbox] agent ws:   ws://localhost:${PORT}/agent?key=<AGENT_API_KEY>`);
  console.log(`[agentbox] agent key:  ${AGENT_API_KEY}`);
  if (ALLOWED_ORIGINS) {
    console.log(`[agentbox] CORS origins: ${ALLOWED_ORIGINS.join(", ")}`);
  } else {
    console.log(`[agentbox] CORS: permissive (dev mode) — set AGENTBOX_CORS_ORIGINS for production`);
  }
});
