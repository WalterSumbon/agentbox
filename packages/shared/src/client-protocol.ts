// ============================================================
// Client Protocol — Frontend ↔ Server (WebSocket)
// ============================================================

import type { Message } from "./message.js";

// ---------- Client → Server ----------

export type ClientMessageType =
  | "send_message"    // User sends a chat message
  | "stop_generation" // User aborts current agent response
  | "new_conversation"
  | "list_conversations"
  | "get_history";    // Fetch message history for a conversation

/** Envelope for all client-to-server WebSocket messages */
export interface ClientMessage {
  type: ClientMessageType;
  /** Required for message-level actions */
  conversationId?: string;
  /** Message payload (for send_message) */
  content?: string;
  /** File attachment IDs (uploaded via REST first) */
  attachmentIds?: string[];
  /** Pagination cursor (for get_history) */
  cursor?: string;
}

// ---------- Server → Client ----------

export type ServerEventType =
  | "message"          // Complete message (user echo or final assistant message)
  | "message_delta"    // Streaming token chunk
  | "message_done"     // Stream finished for this message
  | "typing"           // Agent is thinking
  | "error"            // Something went wrong
  | "conversations"    // Response to list_conversations
  | "history"          // Response to get_history
  | "conversation_created"; // New conversation created

/** Envelope for all server-to-client WebSocket events */
export interface ServerEvent {
  type: ServerEventType;
  conversationId?: string;
  /** Full message (for "message" type) */
  message?: Message;
  /** Streaming chunk (for "message_delta") */
  delta?: {
    messageId: string;
    content: string;
    agentId?: string;
  };
  /** Error details */
  error?: {
    code: string;
    message: string;
  };
  /** Conversation list or history payload */
  data?: unknown;
}
