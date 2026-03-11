// ============================================================
// useChat — manages conversations, messages, streaming,
// and agent state via the WebSocket connection.
// ============================================================

import { useState, useCallback, useEffect, useRef } from "react";
import type {
  Conversation,
  Message,
  ServerEvent,
  AgentDescriptor,
} from "@agentbox/shared";
import type { UseWebSocketReturn } from "./useWebSocket";

// ---------- Types ----------

export interface StreamingMessage {
  content: string;
  agentName?: string;
}

export interface UseChatReturn {
  conversations: Conversation[];
  activeConvId: string | null;
  messages: Message[];
  streamingMessages: Map<string, StreamingMessage>;
  typing: boolean;
  agents: AgentDescriptor[];
  /** Latest error from the server (cleared after display) */
  lastError: { code: string; message: string } | null;
  clearError: () => void;

  selectConversation: (id: string) => void;
  createConversation: (opts?: {
    title?: string;
    type?: "direct" | "group";
    agentId?: string;
    agentIds?: string[];
  }) => void;
  sendMessage: (content: string, mentionAgentId?: string) => void;
  renameConversation: (id: string, title: string) => void;
  deleteConversation: (id: string) => void;
  addAgent: (convId: string, agentId: string) => void;
  removeAgent: (convId: string, agentId: string) => void;
  stopGeneration: () => void;
}

// ---------- Hook ----------

export function useChat(ws: UseWebSocketReturn): UseChatReturn {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [streamingMessages, setStreamingMessages] = useState<
    Map<string, StreamingMessage>
  >(new Map());
  const [typing, setTyping] = useState(false);
  const [agents, setAgents] = useState<AgentDescriptor[]>([]);
  const [lastError, setLastError] = useState<{ code: string; message: string } | null>(null);

  // Keep a ref to activeConvId so event handlers always see the latest value.
  const activeConvIdRef = useRef(activeConvId);
  activeConvIdRef.current = activeConvId;

  const clearError = useCallback(() => setLastError(null), []);

  // ---- Server event handler ----

  const handleEvent = useCallback((evt: ServerEvent) => {
    switch (evt.type) {
      // -- Conversation list --
      case "conversations": {
        setConversations(evt.data as Conversation[]);
        break;
      }

      // -- New conversation created --
      case "conversation_created": {
        const conv = evt.data as Conversation;
        setConversations((prev) => [conv, ...prev]);
        setActiveConvId(conv.id);
        activeConvIdRef.current = conv.id;
        setMessages([]);
        setStreamingMessages(new Map());
        setTyping(false);
        break;
      }

      // -- Conversation metadata updated --
      case "conversation_updated": {
        const updated = evt.data as Conversation;
        setConversations((prev) =>
          prev.map((c) => (c.id === updated.id ? updated : c)),
        );
        break;
      }

      // -- Conversation deleted --
      case "conversation_deleted": {
        const deletedId =
          evt.conversationId ?? (evt.data as { id: string })?.id;
        setConversations((prev) => prev.filter((c) => c.id !== deletedId));
        if (activeConvIdRef.current === deletedId) {
          setActiveConvId(null);
          setMessages([]);
          setStreamingMessages(new Map());
          setTyping(false);
        }
        break;
      }

      // -- Message history for a conversation --
      case "history": {
        if (
          evt.conversationId == null ||
          evt.conversationId === activeConvIdRef.current
        ) {
          setMessages(evt.data as Message[]);
        }
        break;
      }

      // -- Complete message (user echo or final assistant message) --
      case "message": {
        if (evt.message) {
          if (
            evt.conversationId == null ||
            evt.conversationId === activeConvIdRef.current
          ) {
            setMessages((prev) => [...prev, evt.message!]);
            setTyping(false);
            // Clear any streaming content for this message.
            if (evt.message.id) {
              setStreamingMessages((prev) => {
                if (!prev.has(evt.message!.id)) return prev;
                const next = new Map(prev);
                next.delete(evt.message!.id);
                return next;
              });
            }
          }
          // Update conversation's updatedAt in local state
          if (evt.conversationId) {
            setConversations((prev) =>
              prev.map((c) =>
                c.id === evt.conversationId
                  ? { ...c, updatedAt: Date.now() }
                  : c,
              ),
            );
          }
        }
        break;
      }

      // -- Streaming token chunk --
      case "message_delta": {
        if (evt.delta) {
          const { messageId, content, agentName } = evt.delta;
          if (
            evt.conversationId == null ||
            evt.conversationId === activeConvIdRef.current
          ) {
            setStreamingMessages((prev) => {
              const next = new Map(prev);
              const existing = next.get(messageId);
              next.set(messageId, {
                content: (existing?.content ?? "") + content,
                agentName: agentName ?? existing?.agentName,
              });
              return next;
            });
          }
        }
        break;
      }

      // -- Stream finished --
      case "message_done": {
        setTyping(false);
        // Clear all streaming messages — the final message event already
        // added the complete message to the messages array.
        setStreamingMessages(new Map());
        break;
      }

      // -- Agent is thinking --
      case "typing": {
        if (
          evt.conversationId == null ||
          evt.conversationId === activeConvIdRef.current
        ) {
          setTyping(true);
        }
        break;
      }

      // -- Connected agents list changed --
      case "agents_updated": {
        setAgents(evt.data as AgentDescriptor[]);
        break;
      }

      // -- Errors --
      case "error": {
        console.error("[useChat] server error:", evt.error);
        setTyping(false);
        // Clear streaming messages on error to remove stale streaming indicators
        setStreamingMessages(new Map());
        if (evt.error) {
          setLastError(evt.error);
        }
        break;
      }

      default:
        break;
    }
  }, []);

  // ---- Subscribe to WS events ----

  useEffect(() => {
    const unsubscribe = ws.on(handleEvent);
    return unsubscribe;
  }, [ws, handleEvent]);

  // ---- Request conversation list when connection comes up ----

  useEffect(() => {
    if (ws.connected) {
      ws.send({ type: "list_conversations" });
    }
  }, [ws, ws.connected]);

  // ---- Public API ----

  const selectConversation = useCallback(
    (id: string) => {
      setActiveConvId(id);
      activeConvIdRef.current = id;
      setMessages([]);
      setStreamingMessages(new Map());
      setTyping(false);
      ws.send({ type: "get_history", conversationId: id });
    },
    [ws],
  );

  const createConversation = useCallback(
    (opts?: {
      title?: string;
      type?: "direct" | "group";
      agentId?: string;
      agentIds?: string[];
    }) => {
      ws.send({
        type: "new_conversation",
        title: opts?.title,
        conversationType: opts?.type,
        agentId: opts?.agentId,
        agentIds: opts?.agentIds,
      });
    },
    [ws],
  );

  const sendMessage = useCallback(
    (content: string, mentionAgentId?: string) => {
      if (!activeConvIdRef.current) return;
      ws.send({
        type: "send_message",
        conversationId: activeConvIdRef.current,
        content,
        mentionAgentId,
      });
    },
    [ws],
  );

  const renameConversation = useCallback(
    (id: string, title: string) => {
      ws.send({
        type: "rename_conversation",
        conversationId: id,
        title,
      });
    },
    [ws],
  );

  const deleteConversation = useCallback(
    (id: string) => {
      ws.send({
        type: "delete_conversation",
        conversationId: id,
      });
    },
    [ws],
  );

  const addAgent = useCallback(
    (convId: string, agentId: string) => {
      ws.send({
        type: "add_agent",
        conversationId: convId,
        agentId,
      });
    },
    [ws],
  );

  const removeAgent = useCallback(
    (convId: string, agentId: string) => {
      ws.send({
        type: "remove_agent",
        conversationId: convId,
        agentId,
      });
    },
    [ws],
  );

  const stopGenerationFn = useCallback(() => {
    if (!activeConvIdRef.current) return;
    ws.send({
      type: "stop_generation",
      conversationId: activeConvIdRef.current,
    });
    setTyping(false);
    setStreamingMessages(new Map());
  }, [ws]);

  return {
    conversations,
    activeConvId,
    messages,
    streamingMessages,
    typing,
    agents,
    lastError,
    clearError,

    selectConversation,
    createConversation,
    sendMessage,
    renameConversation,
    deleteConversation,
    addAgent,
    removeAgent,
    stopGeneration: stopGenerationFn,
  };
}
