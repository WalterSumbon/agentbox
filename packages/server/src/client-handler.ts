/**
 * Handles WebSocket connections from frontend clients.
 * Implements the Client Protocol.
 */
import type { WebSocket } from "ws";
import type { ClientMessage, ServerEvent, Message } from "@agentbox/shared";
import { v4 as uuid } from "uuid";
import * as store from "./store/memory.js";
import { dispatchToAgent } from "./agent-handler.js";

/** All connected frontend clients */
const clients = new Set<WebSocket>();

export function handleClientConnection(ws: WebSocket): void {
  clients.add(ws);
  console.log(`[client] connected (total: ${clients.size})`);

  ws.on("message", (raw) => {
    try {
      const msg: ClientMessage = JSON.parse(raw.toString());
      handleClientMessage(ws, msg);
    } catch (e: any) {
      sendToClient(ws, {
        type: "error",
        error: { code: "INVALID_MESSAGE", message: e.message },
      });
    }
  });

  ws.on("close", () => {
    clients.delete(ws);
    console.log(`[client] disconnected (total: ${clients.size})`);
  });
}

async function handleClientMessage(ws: WebSocket, msg: ClientMessage): Promise<void> {
  switch (msg.type) {
    case "new_conversation": {
      const conv = store.createConversation();
      sendToClient(ws, {
        type: "conversation_created",
        conversationId: conv.id,
        data: conv,
      });
      break;
    }

    case "list_conversations": {
      const convs = store.listConversations();
      sendToClient(ws, {
        type: "conversations",
        data: convs,
      });
      break;
    }

    case "get_history": {
      if (!msg.conversationId) break;
      const messages = store.getMessages(msg.conversationId);
      sendToClient(ws, {
        type: "history",
        conversationId: msg.conversationId,
        data: messages,
      });
      break;
    }

    case "send_message": {
      if (!msg.conversationId || !msg.content) break;

      // Ensure conversation exists
      let conv = store.getConversation(msg.conversationId);
      if (!conv) {
        conv = store.createConversation();
      }

      // Store user message
      const userMsg: Message = {
        id: uuid(),
        role: "user",
        content: msg.content,
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

      // Dispatch to agent
      await dispatchToAgent(conv.id, ws);
      break;
    }

    case "stop_generation": {
      // TODO: interrupt agent
      break;
    }
  }
}

/** Send a ServerEvent to a specific client */
export function sendToClient(ws: WebSocket, event: ServerEvent): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(event));
  }
}

/** Broadcast a ServerEvent to all connected clients */
export function broadcastToClients(event: ServerEvent): void {
  const data = JSON.stringify(event);
  for (const ws of clients) {
    if (ws.readyState === ws.OPEN) {
      ws.send(data);
    }
  }
}
