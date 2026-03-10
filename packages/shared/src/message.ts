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
  attachments?: Attachment[];
  timestamp: number;
  /** Extensible metadata */
  metadata?: Record<string, unknown>;
}

/** A conversation (a.k.a. thread / chat) */
export interface Conversation {
  id: string;
  title?: string;
  /** The agent assigned to this conversation (null = no agent yet) */
  agentId?: string;
  createdAt: number;
  updatedAt: number;
}
