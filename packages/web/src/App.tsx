import { useState, useEffect, useRef, useCallback } from "react";
import type {
  Message,
  Conversation,
  ClientMessage,
  ServerEvent,
} from "@agentbox/shared";
import "./App.css";

const WS_URL = `ws://${window.location.hostname}:3001/ws`;

function App() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [streamingContent, setStreamingContent] = useState<Map<string, string>>(
    new Map()
  );
  const [input, setInput] = useState("");
  const [connected, setConnected] = useState(false);
  const [typing, setTyping] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const send = useCallback((msg: ClientMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  const connect = useCallback(() => {
    const ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      setConnected(true);
      send({ type: "list_conversations" });
    };

    ws.onmessage = (event) => {
      try {
        const evt: ServerEvent = JSON.parse(event.data);
        handleServerEvent(evt);
      } catch {
        console.error("[ws] failed to parse event");
      }
    };

    ws.onclose = () => {
      setConnected(false);
      setTimeout(connect, 3000);
    };

    wsRef.current = ws;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleServerEvent(evt: ServerEvent) {
    switch (evt.type) {
      case "conversations":
        setConversations(evt.data as Conversation[]);
        break;

      case "conversation_created": {
        const conv = evt.data as Conversation;
        setConversations((prev) => [conv, ...prev]);
        setActiveConvId(conv.id);
        setMessages([]);
        break;
      }

      case "history":
        setMessages(evt.data as Message[]);
        break;

      case "message":
        if (evt.message) {
          setMessages((prev) => [...prev, evt.message!]);
          setTyping(false);
          // Clear any streaming content for this message
          if (evt.message.id) {
            setStreamingContent((prev) => {
              const next = new Map(prev);
              next.delete(evt.message!.id);
              return next;
            });
          }
        }
        break;

      case "message_delta":
        if (evt.delta) {
          setStreamingContent((prev) => {
            const next = new Map(prev);
            const existing = next.get(evt.delta!.messageId) ?? "";
            next.set(evt.delta!.messageId, existing + evt.delta!.content);
            return next;
          });
        }
        break;

      case "message_done":
        setTyping(false);
        break;

      case "typing":
        setTyping(true);
        break;

      case "error":
        console.error("[server]", evt.error);
        setTyping(false);
        break;
    }
  }

  useEffect(() => {
    connect();
    return () => wsRef.current?.close();
  }, [connect]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent]);

  const newConversation = () => {
    send({ type: "new_conversation" });
  };

  const selectConversation = (id: string) => {
    setActiveConvId(id);
    setMessages([]);
    setStreamingContent(new Map());
    send({ type: "get_history", conversationId: id });
  };

  const sendMessage = () => {
    const text = input.trim();
    if (!text) return;

    if (!activeConvId) {
      // Auto-create conversation on first message
      send({ type: "new_conversation" });
      // Message will be sent after conversation is created
      // For now, simple: create then send in next tick
      setTimeout(() => {
        send({
          type: "send_message",
          conversationId: activeConvId ?? "",
          content: text,
        });
      }, 500);
    } else {
      send({
        type: "send_message",
        conversationId: activeConvId,
        content: text,
      });
    }
    setInput("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="app">
      {/* Sidebar */}
      <aside className="sidebar">
        <button className="new-chat-btn" onClick={newConversation}>
          + New Chat
        </button>
        <div className="conv-list">
          {conversations.map((conv) => (
            <div
              key={conv.id}
              className={`conv-item ${conv.id === activeConvId ? "active" : ""}`}
              onClick={() => selectConversation(conv.id)}
            >
              {conv.title ?? "New Chat"}
            </div>
          ))}
        </div>
      </aside>

      {/* Main */}
      <div className="main">
        <header className="header">
          <h1>AgentBox</h1>
          <span className={`status ${connected ? "online" : "offline"}`}>
            {connected ? "Connected" : "Disconnected"}
          </span>
        </header>

        <main className="messages">
          {!activeConvId && messages.length === 0 && (
            <div className="empty">
              Create a new chat or select an existing one.
            </div>
          )}
          {messages.map((msg) => (
            <div key={msg.id} className={`message ${msg.role}`}>
              <div className="message-role">{msg.role}</div>
              <div className="message-content">{msg.content}</div>
            </div>
          ))}

          {/* Streaming messages */}
          {[...streamingContent.entries()].map(([id, content]) => (
            <div key={`stream-${id}`} className="message assistant streaming">
              <div className="message-role">assistant</div>
              <div className="message-content">{content}</div>
            </div>
          ))}

          {typing && streamingContent.size === 0 && (
            <div className="message assistant typing">
              <div className="message-content">Thinking...</div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </main>

        <footer className="input-area">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message... (Enter to send)"
            rows={1}
            disabled={!connected}
          />
          <button
            onClick={sendMessage}
            disabled={!connected || !input.trim()}
          >
            Send
          </button>
        </footer>
      </div>
    </div>
  );
}

export default App;
