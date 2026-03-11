// ============================================================
// ChatArea — main chat view with messages and input
// ============================================================

import { useState, useCallback, useRef, useEffect } from "react";
import type { KeyboardEvent } from "react";
import type { Message, Conversation, AgentDescriptor } from "@agentbox/shared";
import type { StreamingMessage } from "../hooks/useChat";
import MessageBubble from "./MessageBubble";
import "./components.css";

// ---------- Props ----------

interface ChatAreaProps {
  messages: Message[];
  streamingMessages: Map<string, StreamingMessage>;
  typing: boolean;
  onSend: (content: string, mentionAgentId?: string) => void;
  onStopGeneration: () => void;
  conversation: Conversation | null;
  agents: AgentDescriptor[];
  connected: boolean;
  username?: string;
}

// ---------- Component ----------

export default function ChatArea({
  messages,
  streamingMessages,
  typing,
  onSend,
  onStopGeneration,
  conversation,
  agents,
  connected,
  username,
}: ChatAreaProps) {
  const [input, setInput] = useState("");
  const [mentionAgentId, setMentionAgentId] = useState<string | null>(null);
  const [showMentions, setShowMentions] = useState(false);
  const [mentionFilter, setMentionFilter] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isGenerating = typing || streamingMessages.size > 0;

  // Auto-scroll to bottom when messages or streaming content change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingMessages, typing]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 150)}px`;
    }
  }, [input]);

  // Filter agents for mention dropdown
  const filteredAgents = agents.filter((a) =>
    a.name.toLowerCase().includes(mentionFilter.toLowerCase()),
  );

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text || !conversation) return;

    onSend(text, mentionAgentId ?? undefined);
    setInput("");
    setMentionAgentId(null);
    setShowMentions(false);

    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [input, conversation, onSend, mentionAgentId]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (showMentions) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setHighlightedIndex((prev) =>
            prev < filteredAgents.length - 1 ? prev + 1 : 0,
          );
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setHighlightedIndex((prev) =>
            prev > 0 ? prev - 1 : filteredAgents.length - 1,
          );
          return;
        }
        if (e.key === "Enter" && filteredAgents.length > 0) {
          e.preventDefault();
          selectMention(filteredAgents[highlightedIndex]);
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setShowMentions(false);
          return;
        }
      }

      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [showMentions, filteredAgents, highlightedIndex, handleSend],
  );

  const handleInputChange = useCallback(
    (value: string) => {
      setInput(value);

      // Detect @ mentions in group chats
      if (conversation?.type === "group") {
        const lastAtIndex = value.lastIndexOf("@");
        if (lastAtIndex !== -1) {
          const textAfterAt = value.slice(lastAtIndex + 1);
          const charBefore = lastAtIndex > 0 ? value[lastAtIndex - 1] : " ";
          if (
            (charBefore === " " || charBefore === "\n" || lastAtIndex === 0) &&
            !textAfterAt.includes(" ")
          ) {
            setMentionFilter(textAfterAt);
            setShowMentions(true);
            setHighlightedIndex(0);
            return;
          }
        }
      }

      setShowMentions(false);
    },
    [conversation?.type],
  );

  const selectMention = useCallback(
    (agent: AgentDescriptor) => {
      setMentionAgentId(agent.id);
      const lastAtIndex = input.lastIndexOf("@");
      const newInput =
        input.slice(0, lastAtIndex) + `@${agent.name} `;
      setInput(newInput);
      setShowMentions(false);
      textareaRef.current?.focus();
    },
    [input],
  );

  // No conversation selected — empty state
  if (!conversation) {
    return (
      <div className="chat-area">
        <div className="chat-header">
          <div className="chat-header-info">
            <h2 className="chat-header-title">AgentBox</h2>
          </div>
          <div
            className={`chat-connection-status ${connected ? "online" : "offline"}`}
          >
            <span
              className={`chat-connection-dot ${connected ? "online" : "offline"}`}
            />
            {connected ? "Connected" : "Disconnected"}
          </div>
        </div>
        <div className="chat-messages">
          <div className="chat-empty">
            <div className="chat-empty-icon">
              <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                <path d="M8 10h.01" />
                <path d="M12 10h.01" />
                <path d="M16 10h.01" />
              </svg>
            </div>
            <div className="chat-empty-text">
              Select or create a conversation
            </div>
            <div className="chat-empty-sub">
              Start a new chat or pick one from the sidebar.
            </div>
            {agents.length === 0 && (
              <div className="chat-empty-hint">
                No agents are connected yet. Connect an agent to start chatting.
              </div>
            )}
            {agents.length > 0 && (
              <div className="chat-empty-agents">
                <span className="chat-empty-agents-label">Available agents:</span>
                {agents.map((a) => (
                  <span key={a.id} className="chat-empty-agent-tag">
                    {a.name}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="chat-area">
      {/* Header */}
      <div className="chat-header">
        <div className="chat-header-info">
          <h2 className="chat-header-title">
            {conversation.title ?? "New Chat"}
          </h2>
          <span className={`chat-header-badge ${conversation.type}`}>
            {conversation.type}
          </span>
        </div>
        <div
          className={`chat-connection-status ${connected ? "online" : "offline"}`}
        >
          <span
            className={`chat-connection-dot ${connected ? "online" : "offline"}`}
          />
          {connected ? "Connected" : "Disconnected"}
        </div>
      </div>

      {/* Messages */}
      <div className="chat-messages">
        {messages.length === 0 && streamingMessages.size === 0 && !typing && (
          <div className="chat-empty">
            <div className="chat-empty-text">No messages yet</div>
            <div className="chat-empty-sub">
              Send a message to start the conversation.
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} username={username} />
        ))}

        {/* Streaming messages */}
        {Array.from(streamingMessages.entries()).map(([id, sm]) => (
          <MessageBubble
            key={`stream-${id}`}
            message={{
              id,
              role: "assistant",
              content: sm.content,
              agentName: sm.agentName,
              timestamp: Date.now(),
            }}
            isStreaming
            username={username}
          />
        ))}

        {/* Typing indicator */}
        {typing && streamingMessages.size === 0 && (
          <div className="chat-typing">
            <div className="chat-typing-dots">
              <span className="chat-typing-dot" />
              <span className="chat-typing-dot" />
              <span className="chat-typing-dot" />
            </div>
            Agent is thinking...
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div className="chat-input-area">
        <div className="chat-input-container">
          {/* Mention dropdown */}
          {showMentions && filteredAgents.length > 0 && (
            <div className="chat-mention-dropdown">
              {filteredAgents.map((agent, idx) => (
                <div
                  key={agent.id}
                  className={`chat-mention-item ${idx === highlightedIndex ? "highlighted" : ""}`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    selectMention(agent);
                  }}
                  onMouseEnter={() => setHighlightedIndex(idx)}
                >
                  <div>
                    <div className="chat-mention-item-name">
                      @{agent.name}
                    </div>
                    <div className="chat-mention-item-desc">
                      {agent.description}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="chat-input-wrapper">
            <textarea
              ref={textareaRef}
              className="chat-input-textarea"
              value={input}
              onChange={(e) => handleInputChange(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                conversation.type === "group"
                  ? "Type a message... (@ to mention an agent)"
                  : "Type a message... (Enter to send)"
              }
              rows={1}
              disabled={!connected}
            />
            {isGenerating ? (
              <button
                className="chat-stop-btn"
                onClick={onStopGeneration}
                title="Stop generation"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <rect x="6" y="6" width="12" height="12" rx="2" />
                </svg>
              </button>
            ) : (
              <button
                className="chat-send-btn"
                onClick={handleSend}
                disabled={!connected || !input.trim()}
                title="Send message"
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="12" y1="19" x2="12" y2="5" />
                  <polyline points="5 12 12 5 19 12" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
