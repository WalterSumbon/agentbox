/**
 * Handles Agent connections and dispatching.
 * Implements the Agent Protocol with authentication and multi-agent support.
 */
import type { WebSocket } from "ws";
import type {
  AgentDescriptor,
  AgentRequest,
  AgentResponse,
  Message,
} from "@agentbox/shared";
import { v4 as uuid } from "uuid";
import * as store from "./store/sqlite.js";
import { sendToClient, broadcastAgentsUpdate } from "./client-handler.js";
import { AGENT_API_KEY } from "./index.js";

// ---------------------------------------------------------------------------
// Agent WebSocket connections
// ---------------------------------------------------------------------------

interface ConnectedAgent {
  descriptor: AgentDescriptor;
  ws: WebSocket;
}

const connectedAgents = new Map<string, ConnectedAgent>();

/** Pending requests waiting for agent responses */
const pendingRequests = new Map<
  string,
  {
    clientWs: WebSocket;
    conversationId: string;
    messageId: string;
    agentId: string;
    agentName: string;
    content: string;
  }
>();

/** Get the set of currently connected agent IDs */
export function getConnectedAgentIds(): Set<string> {
  return new Set(connectedAgents.keys());
}

/** Get a connected agent by ID */
export function getConnectedAgent(id: string): ConnectedAgent | undefined {
  return connectedAgents.get(id);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const AGENT_ID_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;
const MAX_NAME_LENGTH = 128;
const MAX_DESC_LENGTH = 512;

function validateDescriptor(descriptor: any): AgentDescriptor | null {
  if (!descriptor || typeof descriptor !== "object") return null;
  if (!descriptor.id || typeof descriptor.id !== "string") return null;
  if (!AGENT_ID_REGEX.test(descriptor.id)) return null;
  if (!descriptor.name || typeof descriptor.name !== "string") return null;
  if (descriptor.name.length > MAX_NAME_LENGTH) return null;
  if (descriptor.description && descriptor.description.length > MAX_DESC_LENGTH) {
    descriptor.description = descriptor.description.slice(0, MAX_DESC_LENGTH);
  }
  if (!Array.isArray(descriptor.capabilities)) {
    descriptor.capabilities = ["text"];
  }
  if (!descriptor.transport) {
    descriptor.transport = "websocket";
  }
  return descriptor as AgentDescriptor;
}

// ---------------------------------------------------------------------------
// Rate limiting (per-connection)
// ---------------------------------------------------------------------------

const WS_RATE_LIMIT_WINDOW_MS = 10_000; // 10 seconds
const WS_RATE_LIMIT_MAX_MESSAGES = 100;  // max 100 messages per 10 seconds

interface RateLimitState {
  timestamps: number[];
}

function checkRateLimit(state: RateLimitState): boolean {
  const now = Date.now();
  state.timestamps = state.timestamps.filter(t => now - t < WS_RATE_LIMIT_WINDOW_MS);
  if (state.timestamps.length >= WS_RATE_LIMIT_MAX_MESSAGES) {
    return false; // rate limited
  }
  state.timestamps.push(now);
  return true;
}

// ---------------------------------------------------------------------------
// Agent connection handler
// ---------------------------------------------------------------------------

export function handleAgentConnection(ws: WebSocket, key: string | null): void {
  // Authenticate agent connection
  if (key !== AGENT_API_KEY) {
    console.log(`[agent] rejected: invalid API key`);
    ws.send(JSON.stringify({
      type: "error",
      error: { code: "AUTH_FAILED", message: "Invalid agent API key" },
    }));
    ws.close(4001, "Invalid agent API key");
    return;
  }

  let agentId: string | null = null;
  const rateLimit: RateLimitState = { timestamps: [] };

  ws.on("message", (raw) => {
    try {
      // Rate limiting
      if (!checkRateLimit(rateLimit)) {
        ws.send(JSON.stringify({
          type: "error",
          error: { code: "RATE_LIMITED", message: "Too many messages" },
        }));
        return;
      }

      const data = JSON.parse(raw.toString());

      // First message must be registration
      if (!agentId && data.type === "register") {
        const descriptor = validateDescriptor(data.descriptor);
        if (!descriptor) {
          ws.send(JSON.stringify({
            type: "error",
            error: { code: "INVALID_DESCRIPTOR", message: "Invalid agent descriptor" },
          }));
          ws.close(4002, "Invalid agent descriptor");
          return;
        }

        // Prevent hijacking: reject if agent ID is already connected
        if (connectedAgents.has(descriptor.id)) {
          ws.send(JSON.stringify({
            type: "error",
            error: { code: "AGENT_ID_TAKEN", message: `Agent ID "${descriptor.id}" is already connected` },
          }));
          ws.close(4003, "Agent ID already taken");
          return;
        }

        agentId = descriptor.id;
        store.registerAgent(descriptor);
        connectedAgents.set(agentId, { descriptor, ws });
        console.log(`[agent] registered: ${descriptor.name} (${agentId})`);
        ws.send(JSON.stringify({ type: "registered", agentId }));

        // Notify all clients about updated agent list
        broadcastAgentsUpdate();
        return;
      }

      if (!agentId) {
        ws.send(JSON.stringify({
          type: "error",
          error: { code: "NOT_REGISTERED", message: "First message must be registration" },
        }));
        return;
      }

      // Agent response
      if (data.requestId) {
        handleAgentResponse(data as AgentResponse);
      }
    } catch (e: any) {
      console.error("[agent] invalid message:", e.message);
    }
  });

  ws.on("close", () => {
    if (agentId) {
      connectedAgents.delete(agentId);
      store.unregisterAgent(agentId);
      console.log(`[agent] disconnected: ${agentId}`);

      // Notify all clients about updated agent list
      broadcastAgentsUpdate();
    }
  });

  // Heartbeat: ping every 30 seconds
  const pingInterval = setInterval(() => {
    if (ws.readyState === ws.OPEN) {
      ws.ping();
    } else {
      clearInterval(pingInterval);
    }
  }, 30_000);

  ws.on("close", () => clearInterval(pingInterval));
}

// ---------------------------------------------------------------------------
// Agent response handler
// ---------------------------------------------------------------------------

function handleAgentResponse(res: AgentResponse): void {
  const pending = pendingRequests.get(res.requestId);
  if (!pending) return;

  switch (res.type) {
    case "text_delta": {
      sendToClient(pending.clientWs, {
        type: "message_delta",
        conversationId: pending.conversationId,
        delta: {
          messageId: pending.messageId,
          content: res.content ?? "",
          agentId: pending.agentId,
          agentName: pending.agentName,
        },
      });
      pending.content += res.content ?? "";
      break;
    }

    case "text": {
      pending.content = res.content ?? "";
      // Fall through to done
    }
    // falls through
    case "done": {
      const assistantMsg: Message = {
        id: pending.messageId,
        role: "assistant",
        content: pending.content,
        agentId: pending.agentId,
        agentName: pending.agentName,
        timestamp: Date.now(),
      };
      store.addMessage(pending.conversationId, assistantMsg);

      sendToClient(pending.clientWs, {
        type: "message",
        conversationId: pending.conversationId,
        message: assistantMsg,
      });
      sendToClient(pending.clientWs, {
        type: "message_done",
        conversationId: pending.conversationId,
      });

      pendingRequests.delete(res.requestId);
      break;
    }

    case "error": {
      sendToClient(pending.clientWs, {
        type: "error",
        conversationId: pending.conversationId,
        error: res.error ?? { code: "AGENT_ERROR", message: "Unknown error" },
      });
      pendingRequests.delete(res.requestId);
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Stop generation — cancel pending requests for a conversation
// ---------------------------------------------------------------------------

export function stopGeneration(conversationId: string, clientWs: WebSocket): void {
  for (const [requestId, pending] of pendingRequests) {
    if (pending.conversationId === conversationId && pending.clientWs === clientWs) {
      // Save partial content if any
      if (pending.content) {
        const partialMsg: Message = {
          id: pending.messageId,
          role: "assistant",
          content: pending.content + "\n\n_(generation stopped)_",
          agentId: pending.agentId,
          agentName: pending.agentName,
          timestamp: Date.now(),
        };
        store.addMessage(pending.conversationId, partialMsg);
        sendToClient(pending.clientWs, {
          type: "message",
          conversationId: pending.conversationId,
          message: partialMsg,
        });
      }
      sendToClient(pending.clientWs, {
        type: "message_done",
        conversationId: pending.conversationId,
      });
      pendingRequests.delete(requestId);
    }
  }
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

/**
 * Dispatch a conversation to an agent for processing.
 */
export async function dispatchToAgent(
  conversationId: string,
  clientWs: WebSocket,
  targetAgentId?: string,
): Promise<void> {
  const messages = store.getMessages(conversationId);
  const requestId = uuid();
  const messageId = uuid();

  // Find the target agent
  let agent: ConnectedAgent | undefined;

  if (targetAgentId) {
    agent = connectedAgents.get(targetAgentId);
  }

  // Fallback: first available agent
  if (!agent) {
    agent = connectedAgents.values().next().value as ConnectedAgent | undefined;
  }

  if (agent) {
    // Dispatch to real agent
    const request: AgentRequest = {
      requestId,
      conversationId,
      messages,
    };

    pendingRequests.set(requestId, {
      clientWs,
      conversationId,
      messageId,
      agentId: agent.descriptor.id,
      agentName: agent.descriptor.name,
      content: "",
    });

    agent.ws.send(JSON.stringify(request));
    console.log(`[agent] dispatched to ${agent.descriptor.name}`);
  } else {
    // Fallback: echo agent
    const lastUserMsg = messages.filter((m) => m.role === "user").pop();
    const echoContent = lastUserMsg
      ? `Echo: ${lastUserMsg.content}\n\n_(No agent connected. Connect an agent via the /agent WebSocket endpoint.)_`
      : "No message to echo.";

    const assistantMsg: Message = {
      id: messageId,
      role: "assistant",
      content: echoContent,
      agentName: "Echo",
      timestamp: Date.now(),
    };
    store.addMessage(conversationId, assistantMsg);

    sendToClient(clientWs, {
      type: "message",
      conversationId,
      message: assistantMsg,
    });
    sendToClient(clientWs, {
      type: "message_done",
      conversationId,
    });
  }
}
