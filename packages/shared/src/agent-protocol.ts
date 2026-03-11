// ============================================================
// Agent Protocol — AI Agents ↔ Server
// ============================================================

import type { Attachment, Message } from "./message.js";

// ---------- Agent Registration ----------

/** Capabilities an agent can declare */
export type AgentCapability =
  | "text"       // Can process text
  | "vision"     // Can process images
  | "file"       // Can process files
  | "audio"      // Can process audio
  | "tool_use"   // Can call tools
  | "streaming"; // Supports streaming responses

/** How the agent connects */
export type AgentTransport = "websocket" | "http_callback";

/** Agent descriptor — sent on registration */
export interface AgentDescriptor {
  id: string;
  name: string;
  description: string;
  capabilities: AgentCapability[];
  transport: AgentTransport;
  /** For http_callback transport: the URL to POST requests to */
  callbackUrl?: string;
  /** Agent-specific config schema (optional, for UI rendering) */
  configSchema?: Record<string, unknown>;
}

// ---------- Server → Agent ----------

/** A request sent from the server to the agent */
export interface AgentRequest {
  /** Unique request ID (for correlating responses) */
  requestId: string;
  conversationId: string;
  /** Full conversation history */
  messages: Message[];
  /** New attachments in the latest user message */
  attachments?: Attachment[];
  /** Per-conversation agent config */
  config?: Record<string, unknown>;
  /** User info for the message sender (for auto-binding) */
  user?: {
    id: string;
    username: string;
    displayName: string;
    /** The login token used to authenticate — allows agent to auto-bind user */
    loginToken?: string;
  };
}

// ---------- Agent → Server ----------

export type AgentResponseType =
  | "text"         // Complete text response
  | "text_delta"   // Streaming text chunk
  | "file"         // Agent sends a file
  | "tool_call"    // Agent wants to call a tool
  | "tool_result"  // Result of a tool call (server → agent)
  | "done"         // Agent finished responding
  | "error";       // Something went wrong

/** A response chunk from the agent */
export interface AgentResponse {
  type: AgentResponseType;
  requestId: string;
  /** Text content (for text / text_delta) */
  content?: string;
  /** File info (for file type) */
  file?: {
    url: string;
    fileName: string;
    mimeType?: string;
  };
  /** Tool call (for tool_call type) */
  toolCall?: {
    id: string;
    name: string;
    args: Record<string, unknown>;
  };
  /** Tool result (for tool_result, server → agent) */
  toolResult?: {
    callId: string;
    result: unknown;
    error?: string;
  };
  /** Error details */
  error?: {
    code: string;
    message: string;
  };
}
