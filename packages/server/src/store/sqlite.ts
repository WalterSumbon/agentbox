/**
 * SQLite-backed persistent store for AgentBox.
 *
 * Uses better-sqlite3 (synchronous API) with WAL mode for concurrent reads.
 * Agents remain in-memory only (runtime state, not persisted).
 */
import Database from "better-sqlite3";
import { v4 as uuid } from "uuid";
import path from "node:path";
import fs from "node:fs";
import type {
  Conversation,
  ConversationType,
  Message,
  MessageRole,
  AgentDescriptor,
  UserInfo,
  Attachment,
} from "@agentbox/shared";

// ---------------------------------------------------------------------------
// Database initialisation
// ---------------------------------------------------------------------------

const DB_DIR = path.resolve(process.cwd(), "data");
const DB_PATH = path.join(DB_DIR, "agentbox.db");

let db: Database.Database;

export function initDb(): void {
  if (db) return; // already initialised

  // Ensure the data directory exists
  fs.mkdirSync(DB_DIR, { recursive: true });

  db = new Database(DB_PATH);

  // Performance & safety pragmas
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");

  createTables();
}

function createTables(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            TEXT PRIMARY KEY,
      username      TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      display_name  TEXT NOT NULL,
      created_at    INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id         TEXT PRIMARY KEY,
      title      TEXT,
      type       TEXT NOT NULL DEFAULT 'direct' CHECK(type IN ('direct', 'group')),
      user_id    TEXT NOT NULL,
      agent_id   TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_conversations_user_id
      ON conversations(user_id);

    CREATE TABLE IF NOT EXISTS conversation_agents (
      conversation_id TEXT NOT NULL,
      agent_id        TEXT NOT NULL,
      PRIMARY KEY (conversation_id, agent_id),
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS messages (
      id              TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role            TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
      content         TEXT NOT NULL,
      agent_id        TEXT,
      agent_name      TEXT,
      attachments     TEXT,
      timestamp       INTEGER NOT NULL,
      metadata        TEXT,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_messages_conversation_id_timestamp
      ON messages(conversation_id, timestamp);
  `);
}

// Auto-initialise when this module is imported
initDb();

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

const stmtCache: Record<string, Database.Statement> = {};

/** Helper to lazily prepare & cache statements. */
function stmt(sql: string): Database.Statement {
  if (!stmtCache[sql]) {
    stmtCache[sql] = db.prepare(sql);
  }
  return stmtCache[sql];
}

export function createUser(
  username: string,
  passwordHash: string,
  displayName: string,
): UserInfo {
  const id = uuid();
  const createdAt = Date.now();

  stmt(`
    INSERT INTO users (id, username, password_hash, display_name, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, username, passwordHash, displayName, createdAt);

  return { id, username, displayName, createdAt };
}

interface UserRow {
  id: string;
  username: string;
  password_hash: string;
  display_name: string;
  created_at: number;
}

export function getUserByUsername(
  username: string,
): UserRow | undefined {
  const row = stmt(`
    SELECT id, username, password_hash, display_name, created_at
    FROM users WHERE username = ?
  `).get(username) as UserRow | undefined;

  return row ?? undefined;
}

export function getUserById(id: string): UserInfo | undefined {
  const row = stmt(`
    SELECT id, username, display_name, created_at
    FROM users WHERE id = ?
  `).get(id) as Pick<UserRow, "id" | "username" | "display_name" | "created_at"> | undefined;

  if (!row) return undefined;
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    createdAt: row.created_at,
  };
}

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------

interface ConversationRow {
  id: string;
  title: string | null;
  type: ConversationType;
  user_id: string;
  agent_id: string | null;
  created_at: number;
  updated_at: number;
}

/** Convert a database row into the shared Conversation type. */
function rowToConversation(row: ConversationRow): Conversation {
  const conv: Conversation = {
    id: row.id,
    type: row.type,
    userId: row.user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };

  if (row.title != null) conv.title = row.title;
  if (row.agent_id != null) conv.agentId = row.agent_id;

  // For group conversations, attach the list of agent IDs
  if (row.type === "group") {
    conv.agentIds = getConversationAgentIds(row.id);
  }

  return conv;
}

export function createConversation(
  userId: string,
  title?: string,
  type: ConversationType = "direct",
  agentId?: string,
  agentIds?: string[],
): Conversation {
  const id = uuid();
  const now = Date.now();

  const createConv = db.transaction(() => {
    stmt(`
      INSERT INTO conversations (id, title, type, user_id, agent_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, title ?? "New Chat", type, userId, agentId ?? null, now, now);

    // For group chats, insert agent membership rows
    if (type === "group" && agentIds && agentIds.length > 0) {
      const insertAgent = stmt(`
        INSERT OR IGNORE INTO conversation_agents (conversation_id, agent_id)
        VALUES (?, ?)
      `);
      for (const aid of agentIds) {
        insertAgent.run(id, aid);
      }
    }
  });

  createConv();

  return getConversation(id)!;
}

export function getConversation(id: string): Conversation | undefined {
  const row = stmt(`
    SELECT id, title, type, user_id, agent_id, created_at, updated_at
    FROM conversations WHERE id = ?
  `).get(id) as ConversationRow | undefined;

  if (!row) return undefined;
  return rowToConversation(row);
}

export function listConversations(userId: string): Conversation[] {
  const rows = stmt(`
    SELECT id, title, type, user_id, agent_id, created_at, updated_at
    FROM conversations
    WHERE user_id = ?
    ORDER BY updated_at DESC
  `).all(userId) as ConversationRow[];

  return rows.map(rowToConversation);
}

export function updateConversationTitle(id: string, title: string): void {
  const changes = stmt(`
    UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?
  `).run(title, Date.now(), id).changes;

  if (changes === 0) {
    throw new Error(`Conversation ${id} not found`);
  }
}

export function deleteConversation(id: string): void {
  // Foreign keys with ON DELETE CASCADE handle messages & conversation_agents
  stmt(`DELETE FROM conversations WHERE id = ?`).run(id);
}

// ---------------------------------------------------------------------------
// Conversation agents (group chat membership)
// ---------------------------------------------------------------------------

export function addAgentToConversation(
  conversationId: string,
  agentId: string,
): void {
  stmt(`
    INSERT OR IGNORE INTO conversation_agents (conversation_id, agent_id)
    VALUES (?, ?)
  `).run(conversationId, agentId);

  // Touch the conversation's updated_at
  stmt(`UPDATE conversations SET updated_at = ? WHERE id = ?`).run(
    Date.now(),
    conversationId,
  );
}

export function removeAgentFromConversation(
  conversationId: string,
  agentId: string,
): void {
  stmt(`
    DELETE FROM conversation_agents
    WHERE conversation_id = ? AND agent_id = ?
  `).run(conversationId, agentId);

  stmt(`UPDATE conversations SET updated_at = ? WHERE id = ?`).run(
    Date.now(),
    conversationId,
  );
}

export function getConversationAgentIds(conversationId: string): string[] {
  const rows = stmt(`
    SELECT agent_id FROM conversation_agents WHERE conversation_id = ?
  `).all(conversationId) as { agent_id: string }[];

  return rows.map((r) => r.agent_id);
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

interface MessageRow {
  id: string;
  conversation_id: string;
  role: MessageRole;
  content: string;
  agent_id: string | null;
  agent_name: string | null;
  attachments: string | null;
  timestamp: number;
  metadata: string | null;
}

function rowToMessage(row: MessageRow): Message {
  const msg: Message = {
    id: row.id,
    role: row.role,
    content: row.content,
    timestamp: row.timestamp,
  };

  if (row.agent_id != null) msg.agentId = row.agent_id;
  if (row.agent_name != null) msg.agentName = row.agent_name;

  if (row.attachments != null) {
    try {
      msg.attachments = JSON.parse(row.attachments) as Attachment[];
    } catch {
      // Silently drop malformed attachment JSON
    }
  }

  if (row.metadata != null) {
    try {
      msg.metadata = JSON.parse(row.metadata) as Record<string, unknown>;
    } catch {
      // Silently drop malformed metadata JSON
    }
  }

  return msg;
}

export function addMessage(conversationId: string, msg: Message): void {
  stmt(`
    INSERT INTO messages (id, conversation_id, role, content, agent_id, agent_name, attachments, timestamp, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    msg.id,
    conversationId,
    msg.role,
    msg.content,
    msg.agentId ?? null,
    msg.agentName ?? null,
    msg.attachments ? JSON.stringify(msg.attachments) : null,
    msg.timestamp,
    msg.metadata ? JSON.stringify(msg.metadata) : null,
  );

  // Update the conversation's updated_at timestamp
  stmt(`UPDATE conversations SET updated_at = ? WHERE id = ?`).run(
    Date.now(),
    conversationId,
  );
}

/**
 * Retrieve messages for a conversation.
 *
 * @param conversationId  The conversation to fetch messages for.
 * @param limit           Maximum number of messages to return (default: 200).
 * @param before          If provided, only return messages with timestamp < before
 *                        (for cursor-based pagination, scrolling backwards).
 */
export function getMessages(
  conversationId: string,
  limit = 200,
  before?: number,
): Message[] {
  let rows: MessageRow[];

  if (before !== undefined) {
    rows = stmt(`
      SELECT id, conversation_id, role, content, agent_id, agent_name, attachments, timestamp, metadata
      FROM messages
      WHERE conversation_id = ? AND timestamp < ?
      ORDER BY timestamp ASC
      LIMIT ?
    `).all(conversationId, before, limit) as MessageRow[];
  } else {
    rows = stmt(`
      SELECT id, conversation_id, role, content, agent_id, agent_name, attachments, timestamp, metadata
      FROM messages
      WHERE conversation_id = ?
      ORDER BY timestamp ASC
      LIMIT ?
    `).all(conversationId, limit) as MessageRow[];
  }

  return rows.map(rowToMessage);
}

// ---------------------------------------------------------------------------
// Agents (runtime in-memory only — not persisted)
// ---------------------------------------------------------------------------

const agents = new Map<string, AgentDescriptor>();

export function registerAgent(descriptor: AgentDescriptor): void {
  agents.set(descriptor.id, descriptor);
}

export function unregisterAgent(id: string): void {
  agents.delete(id);
}

export function getAgent(id: string): AgentDescriptor | undefined {
  return agents.get(id);
}

export function listAgents(): AgentDescriptor[] {
  return [...agents.values()];
}

// ---------------------------------------------------------------------------
// Cleanup helper (for tests or graceful shutdown)
// ---------------------------------------------------------------------------

export function closeDb(): void {
  if (db) {
    db.close();
    // Clear the statement cache since the database handle is now invalid
    for (const key of Object.keys(stmtCache)) {
      delete stmtCache[key];
    }
  }
}
