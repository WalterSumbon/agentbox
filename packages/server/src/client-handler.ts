/**
 * Handles WebSocket connections from frontend clients.
 * Implements the Client Protocol with authentication and rate limiting.
 */
import type { WebSocket } from "ws";
import type { ClientMessage, ServerEvent, Message, UserInfo } from "@agentbox/shared";
import { v4 as uuid } from "uuid";
import * as store from "./store/sqlite.js";
import { dispatchToAgent, getConnectedAgentIds, stopGeneration } from "./agent-handler.js";
import { verifyToken } from "./auth.js";
import { stripHtml, MAX_MESSAGE_LENGTH, MAX_TITLE_LENGTH } from "./sanitize.js";

// ---------------------------------------------------------------------------
// Client connection state
// ---------------------------------------------------------------------------

interface AuthenticatedClient {
  ws: WebSocket;
  user: UserInfo;
}

/** All authenticated client connections, keyed by WebSocket */
const authenticatedClients = new Map<WebSocket, AuthenticatedClient>();

/** All connected WebSocket clients (including unauthenticated) */
const allClients = new Set<WebSocket>();

// ---------------------------------------------------------------------------
// Rate limiting (per-connection)
// ---------------------------------------------------------------------------

const WS_RATE_LIMIT_WINDOW_MS = 60_000; // 60 seconds
const WS_RATE_LIMIT_MAX_MESSAGES = 120;  // max 120 messages per minute

interface RateLimitState {
  timestamps: number[];
}

function checkRateLimit(state: RateLimitState): boolean {
  const now = Date.now();
  state.timestamps = state.timestamps.filter(t => now - t < WS_RATE_LIMIT_WINDOW_MS);
  if (state.timestamps.length >= WS_RATE_LIMIT_MAX_MESSAGES) {
    return false;
  }
  state.timestamps.push(now);
  return true;
}

// ---------------------------------------------------------------------------
// Connection handler
// ---------------------------------------------------------------------------

export function handleClientConnection(ws: WebSocket, token: string | null): void {
  allClients.add(ws);
  const rateLimit: RateLimitState = { timestamps: [] };

  // Authenticate via token passed in query string
  let user: UserInfo | null = null;
  if (token) {
    try {
      user = verifyToken(token);
      authenticatedClients.set(ws, { ws, user });
      console.log(`[client] authenticated: ${user.username} (total: ${authenticatedClients.size})`);

      // Only send agents list to authenticated clients
      sendToClient(ws, {
        type: "agents_updated",
        data: store.listAgents(),
      });
    } catch {
      console.log(`[client] rejected: invalid token`);
      allClients.delete(ws);
      ws.close(4001, "Invalid or expired token");
      return;
    }
  } else {
    console.log(`[client] rejected: no token`);
    allClients.delete(ws);
    ws.close(4001, "Token required");
    return;
  }

  ws.on("message", (raw) => {
    try {
      const msg: ClientMessage = JSON.parse(raw.toString());

      // Ignore ping messages — don't count towards rate limit
      if ((msg as any).type === "ping") return;

      // Rate limiting (after ping filter)
      if (!checkRateLimit(rateLimit)) {
        sendToClient(ws, {
          type: "error",
          error: { code: "RATE_LIMITED", message: "Too many messages. Please slow down." },
        });
        return;
      }

      handleClientMessage(ws, msg);
    } catch (e: any) {
      sendToClient(ws, {
        type: "error",
        error: { code: "INVALID_MESSAGE", message: e.message },
      });
    }
  });

  ws.on("close", () => {
    authenticatedClients.delete(ws);
    allClients.delete(ws);
    console.log(`[client] disconnected (total: ${allClients.size})`);
  });
}

// ---------------------------------------------------------------------------
// Message routing
// ---------------------------------------------------------------------------

function requireAuth(ws: WebSocket): AuthenticatedClient | null {
  const client = authenticatedClients.get(ws);
  if (!client) {
    sendToClient(ws, {
      type: "error",
      error: { code: "AUTH_REQUIRED", message: "Authentication required. Please log in." },
    });
    return null;
  }
  return client;
}

async function handleClientMessage(ws: WebSocket, msg: ClientMessage): Promise<void> {
  switch (msg.type) {
    case "new_conversation": {
      const client = requireAuth(ws);
      if (!client) return;

      const type = msg.conversationType || "direct";
      // Sanitize title if provided
      const title = msg.title ? stripHtml(msg.title).slice(0, MAX_TITLE_LENGTH) : undefined;
      const conv = store.createConversation(
        client.user.id,
        title,
        type,
        msg.agentId,
        msg.agentIds,
      );

      sendToClient(ws, {
        type: "conversation_created",
        conversationId: conv.id,
        data: conv,
      });
      break;
    }

    case "list_conversations": {
      const client = requireAuth(ws);
      if (!client) return;

      const convs = store.listConversations(client.user.id);
      sendToClient(ws, {
        type: "conversations",
        data: convs,
      });
      break;
    }

    case "get_history": {
      const client = requireAuth(ws);
      if (!client) return;
      if (!msg.conversationId) break;

      // Verify ownership
      const conv = store.getConversation(msg.conversationId);
      if (!conv || conv.userId !== client.user.id) {
        sendToClient(ws, {
          type: "error",
          error: { code: "NOT_FOUND", message: "Conversation not found" },
        });
        return;
      }

      const messages = store.getMessages(msg.conversationId);
      sendToClient(ws, {
        type: "history",
        conversationId: msg.conversationId,
        data: messages,
      });
      break;
    }

    case "send_message": {
      const client = requireAuth(ws);
      if (!client) return;

      // Validate content is present
      if (!msg.conversationId || !msg.content) {
        sendToClient(ws, {
          type: "error",
          error: { code: "INVALID_INPUT", message: "Message content is required" },
        });
        return;
      }

      // Enforce message size limit
      if (msg.content.length > MAX_MESSAGE_LENGTH) {
        sendToClient(ws, {
          type: "error",
          error: {
            code: "MESSAGE_TOO_LONG",
            message: `Message exceeds maximum length of ${MAX_MESSAGE_LENGTH} characters`,
          },
        });
        return;
      }

      // Sanitize message content — strip HTML tags to prevent stored XSS
      const sanitizedContent = stripHtml(msg.content);

      // Verify ownership
      const conv = store.getConversation(msg.conversationId);
      if (!conv || conv.userId !== client.user.id) {
        sendToClient(ws, {
          type: "error",
          error: { code: "NOT_FOUND", message: "Conversation not found" },
        });
        return;
      }

      // Store user message
      const userMsg: Message = {
        id: uuid(),
        role: "user",
        content: sanitizedContent,
        timestamp: Date.now(),
      };
      store.addMessage(conv.id, userMsg);

      // Echo user message back to sender (confirmation)
      sendToClient(ws, {
        type: "message",
        conversationId: conv.id,
        message: userMsg,
      });

      // Show typing indicator
      sendToClient(ws, {
        type: "typing",
        conversationId: conv.id,
      });

      // Determine which agent(s) to dispatch to
      if (conv.type === "group") {
        // Group chat: dispatch to mentioned agent, or all agents
        const targetAgentIds = msg.mentionAgentId
          ? [msg.mentionAgentId]
          : (conv.agentIds ?? []);

        const onlineAgentIds = getConnectedAgentIds();
        const dispatchIds = targetAgentIds.filter((id) => onlineAgentIds.has(id));

        if (dispatchIds.length > 0) {
          // Dispatch to each online agent in the group
          for (const agentId of dispatchIds) {
            await dispatchToAgent(conv.id, ws, agentId);
          }
        } else {
          // No online agents in group
          const sysMsg: Message = {
            id: uuid(),
            role: "system",
            content: "No agents in this group are currently online.",
            timestamp: Date.now(),
          };
          store.addMessage(conv.id, sysMsg);
          sendToClient(ws, {
            type: "message",
            conversationId: conv.id,
            message: sysMsg,
          });
          sendToClient(ws, { type: "message_done", conversationId: conv.id });
        }
      } else {
        // Direct chat: dispatch to the conversation's agent, or first available
        await dispatchToAgent(conv.id, ws, conv.agentId);
      }
      break;
    }

    case "rename_conversation": {
      const client = requireAuth(ws);
      if (!client) return;
      if (!msg.conversationId || !msg.title) break;

      // Sanitize and truncate title
      const sanitizedTitle = stripHtml(msg.title).slice(0, MAX_TITLE_LENGTH);
      if (!sanitizedTitle) break;

      const conv = store.getConversation(msg.conversationId);
      if (!conv || conv.userId !== client.user.id) {
        sendToClient(ws, {
          type: "error",
          error: { code: "NOT_FOUND", message: "Conversation not found" },
        });
        return;
      }

      store.updateConversationTitle(msg.conversationId, sanitizedTitle);
      const updated = store.getConversation(msg.conversationId);
      sendToClient(ws, {
        type: "conversation_updated",
        conversationId: msg.conversationId,
        data: updated,
      });
      break;
    }

    case "delete_conversation": {
      const client = requireAuth(ws);
      if (!client) return;
      if (!msg.conversationId) break;

      const conv = store.getConversation(msg.conversationId);
      if (!conv || conv.userId !== client.user.id) {
        sendToClient(ws, {
          type: "error",
          error: { code: "NOT_FOUND", message: "Conversation not found" },
        });
        return;
      }

      store.deleteConversation(msg.conversationId);
      sendToClient(ws, {
        type: "conversation_deleted",
        conversationId: msg.conversationId,
      });
      break;
    }

    case "add_agent": {
      const client = requireAuth(ws);
      if (!client) return;
      if (!msg.conversationId || !msg.agentId) break;

      const conv = store.getConversation(msg.conversationId);
      if (!conv || conv.userId !== client.user.id) {
        sendToClient(ws, {
          type: "error",
          error: { code: "NOT_FOUND", message: "Conversation not found" },
        });
        return;
      }

      store.addAgentToConversation(msg.conversationId, msg.agentId);
      const updated = store.getConversation(msg.conversationId);
      sendToClient(ws, {
        type: "conversation_updated",
        conversationId: msg.conversationId,
        data: updated,
      });
      break;
    }

    case "remove_agent": {
      const client = requireAuth(ws);
      if (!client) return;
      if (!msg.conversationId || !msg.agentId) break;

      const conv = store.getConversation(msg.conversationId);
      if (!conv || conv.userId !== client.user.id) {
        sendToClient(ws, {
          type: "error",
          error: { code: "NOT_FOUND", message: "Conversation not found" },
        });
        return;
      }

      store.removeAgentFromConversation(msg.conversationId, msg.agentId);
      const updated = store.getConversation(msg.conversationId);
      sendToClient(ws, {
        type: "conversation_updated",
        conversationId: msg.conversationId,
        data: updated,
      });
      break;
    }

    case "stop_generation": {
      const client = requireAuth(ws);
      if (!client) return;
      if (!msg.conversationId) break;

      // Verify ownership
      const conv = store.getConversation(msg.conversationId);
      if (!conv || conv.userId !== client.user.id) return;

      stopGeneration(msg.conversationId, ws);
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Sending helpers
// ---------------------------------------------------------------------------

/** Send a ServerEvent to a specific client */
export function sendToClient(ws: WebSocket, event: ServerEvent): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(event));
  }
}

/** Broadcast a ServerEvent to all authenticated clients */
export function broadcastToClients(event: ServerEvent): void {
  const data = JSON.stringify(event);
  for (const client of authenticatedClients.values()) {
    if (client.ws.readyState === client.ws.OPEN) {
      client.ws.send(data);
    }
  }
}

/** Broadcast agents_updated to all connected clients */
export function broadcastAgentsUpdate(): void {
  broadcastToClients({
    type: "agents_updated",
    data: store.listAgents(),
  });
}
