// ============================================================
// Client Protocol — Frontend <-> Server (WebSocket + REST)
// ============================================================

import type { Message } from "./message.js";

// ---------- Authentication (REST) ----------

export interface AuthCredentials {
  username: string;
  password: string;
}

export interface AuthResponse {
  token: string;
  user: UserInfo;
}

export interface UserInfo {
  id: string;
  username: string;
  displayName: string;
  createdAt: number;
}

// ---------- Client -> Server (WebSocket) ----------

export type ClientMessageType =
  | "send_message"       // User sends a chat message
  | "stop_generation"    // User aborts current agent response
  | "new_conversation"   // Create a new conversation
  | "list_conversations" // List user's conversations
  | "get_history"        // Fetch message history for a conversation
  | "rename_conversation"
  | "delete_conversation"
  | "add_agent"          // Add an agent to a group conversation
  | "remove_agent";      // Remove an agent from a group conversation

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
  /** Agent ID (for new_conversation with specific agent, or add/remove agent) */
  agentId?: string;
  /** Conversation title (for new_conversation, rename_conversation) */
  title?: string;
  /** Conversation type (for new_conversation: 'direct' | 'group') */
  conversationType?: "direct" | "group";
  /** Agent IDs (for new group conversation) */
  agentIds?: string[];
  /** Target agent ID for @mention in group chats */
  mentionAgentId?: string;
}

// ---------- Server -> Client (WebSocket) ----------

export type ServerEventType =
  | "message"              // Complete message (user echo or final assistant message)
  | "message_delta"        // Streaming token chunk
  | "message_done"         // Stream finished for this message
  | "typing"               // Agent is thinking
  | "error"                // Something went wrong
  | "conversations"        // Response to list_conversations
  | "history"              // Response to get_history
  | "conversation_created" // New conversation created
  | "conversation_updated" // Conversation renamed or agents changed
  | "conversation_deleted" // Conversation deleted
  | "agents_updated";      // Connected agents list changed

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
    agentName?: string;
  };
  /** Error details */
  error?: {
    code: string;
    message: string;
  };
  /** Generic data payload (conversations, history, agents, etc.) */
  data?: unknown;
}
