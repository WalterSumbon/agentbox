/**
 * Handles Agent connections and dispatching.
 * Implements the Agent Protocol.
 *
 * For now, includes a built-in echo agent for testing.
 * Real agents will connect via WebSocket or HTTP callback.
 */
import type { WebSocket } from "ws";
import type {
  AgentDescriptor,
  AgentRequest,
  AgentResponse,
  Message,
} from "@agentbox/shared";
import { v4 as uuid } from "uuid";
import * as store from "./store/memory.js";
import { sendToClient } from "./client-handler.js";

// ---- Agent WebSocket connections ----

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
    content: string;
  }
>();

export function handleAgentConnection(ws: WebSocket): void {
  let agentId: string | null = null;

  ws.on("message", (raw) => {
    try {
      const data = JSON.parse(raw.toString());

      // First message must be registration
      if (!agentId && data.type === "register") {
        const descriptor = data.descriptor as AgentDescriptor;
        agentId = descriptor.id;
        store.registerAgent(descriptor);
        connectedAgents.set(agentId, { descriptor, ws });
        console.log(`[agent] registered: ${descriptor.name} (${agentId})`);
        ws.send(JSON.stringify({ type: "registered", agentId }));
        return;
      }

      // Agent response
      if (agentId && data.requestId) {
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
    }
  });
}

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
          agentId: undefined,
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

/**
 * Dispatch a conversation to an agent for processing.
 * If no real agent is connected, uses the built-in echo agent.
 */
export async function dispatchToAgent(
  conversationId: string,
  clientWs: WebSocket
): Promise<void> {
  const messages = store.getMessages(conversationId);
  const requestId = uuid();
  const messageId = uuid();

  // Try to find a connected agent
  const firstAgent = connectedAgents.values().next().value as ConnectedAgent | undefined;

  if (firstAgent) {
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
      content: "",
    });

    firstAgent.ws.send(JSON.stringify(request));
    console.log(`[agent] dispatched to ${firstAgent.descriptor.name}`);
  } else {
    // Fallback: echo agent
    const lastUserMsg = messages.filter((m) => m.role === "user").pop();
    const echoContent = lastUserMsg
      ? `Echo: ${lastUserMsg.content}\n\n_(No agent connected. Connect an agent via ws://localhost:3001/agent)_`
      : "No message to echo.";

    const assistantMsg: Message = {
      id: messageId,
      role: "assistant",
      content: echoContent,
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
