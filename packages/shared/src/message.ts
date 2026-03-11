// ============================================================
// Universal Message Format
// ============================================================

/** Roles in a conversation */
export type MessageRole = "user" | "assistant" | "system";

/** Attachment types */
export type AttachmentType = "image" | "file" | "audio" | "video";

/** A file or media attachment */
export interface Attachment {
  type: AttachmentType;
  /** Relative URL served by the server (e.g. /files/abc.png) */
  url: string;
  fileName?: string;
  mimeType?: string;
  /** File size in bytes */
  size?: number;
}

/** A single message in a conversation */
export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  /** Which agent produced this message (for multi-agent scenarios) */
  agentId?: string;
  /** Display name of the agent (for rendering in group chats) */
  agentName?: string;
  attachments?: Attachment[];
  timestamp: number;
  /** Extensible metadata */
  metadata?: Record<string, unknown>;
}

/** Conversation type */
export type ConversationType = "direct" | "group";

/** A conversation (a.k.a. thread / chat) */
export interface Conversation {
  id: string;
  title?: string;
  /** Conversation type: 'direct' (1 agent) or 'group' (multiple agents) */
  type: ConversationType;
  /** The primary agent assigned to this conversation (for direct chats) */
  agentId?: string;
  /** All agent IDs in this conversation (for group chats) */
  agentIds?: string[];
  /** Owner user ID */
  userId: string;
  createdAt: number;
  updatedAt: number;
}
