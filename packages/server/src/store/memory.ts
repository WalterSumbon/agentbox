/**
 * In-memory store — will be replaced with persistent storage later.
 */
import type { Conversation, Message } from "@agentbox/shared";
import type { AgentDescriptor } from "@agentbox/shared";
import { v4 as uuid } from "uuid";

// ---- Conversations ----

const conversations = new Map<string, Conversation>();
const messagesByConv = new Map<string, Message[]>();

export function createConversation(title?: string, agentId?: string): Conversation {
  const now = Date.now();
  const conv: Conversation = {
    id: uuid(),
    title: title ?? "New Chat",
    agentId,
    createdAt: now,
    updatedAt: now,
  };
  conversations.set(conv.id, conv);
  messagesByConv.set(conv.id, []);
  return conv;
}

export function getConversation(id: string): Conversation | undefined {
  return conversations.get(id);
}

export function listConversations(): Conversation[] {
  return [...conversations.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

export function addMessage(conversationId: string, msg: Message): void {
  const msgs = messagesByConv.get(conversationId);
  if (!msgs) throw new Error(`Conversation ${conversationId} not found`);
  msgs.push(msg);

  const conv = conversations.get(conversationId)!;
  conv.updatedAt = Date.now();
}

export function getMessages(conversationId: string): Message[] {
  return messagesByConv.get(conversationId) ?? [];
}

// ---- Agents ----

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
