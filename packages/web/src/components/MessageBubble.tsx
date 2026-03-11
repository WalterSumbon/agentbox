// ============================================================
// MessageBubble — renders a single chat message with avatar
// ============================================================

import { useState, useCallback, useMemo } from "react";
import type { ComponentProps } from "react";
import type { Message } from "@agentbox/shared";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import "./components.css";

// ---------- Props ----------

interface MessageBubbleProps {
  message: Message;
  isStreaming?: boolean;
  /** The username of the current user (for user avatars). */
  username?: string;
}

// ---------- Helpers ----------

function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (seconds < 60) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) {
    const date = new Date(timestamp);
    return `Today ${date.getHours().toString().padStart(2, "0")}:${date.getMinutes().toString().padStart(2, "0")}`;
  }

  const date = new Date(timestamp);
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);

  if (
    date.getDate() === yesterday.getDate() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getFullYear() === yesterday.getFullYear()
  ) {
    return `Yesterday ${date.getHours().toString().padStart(2, "0")}:${date.getMinutes().toString().padStart(2, "0")}`;
  }

  return `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, "0")}-${date.getDate().toString().padStart(2, "0")} ${date.getHours().toString().padStart(2, "0")}:${date.getMinutes().toString().padStart(2, "0")}`;
}

function getInitial(name: string): string {
  return name.charAt(0).toUpperCase();
}

// ---------- Code Block Sub-component ----------

function CodeBlock({
  language,
  value,
}: {
  language: string | undefined;
  value: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [value]);

  return (
    <div className="msg-code-block">
      <div className="msg-code-header">
        <span className="msg-code-lang">{language ?? "text"}</span>
        <button className="msg-code-copy-btn" onClick={handleCopy}>
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <SyntaxHighlighter
        style={oneDark}
        language={language ?? "text"}
        PreTag="div"
        customStyle={{
          margin: 0,
          borderRadius: 0,
          fontSize: "0.85rem",
        }}
      >
        {value}
      </SyntaxHighlighter>
    </div>
  );
}

// ---------- Component ----------

export default function MessageBubble({
  message,
  isStreaming,
  username,
}: MessageBubbleProps) {
  const { role, content, agentName, timestamp } = message;
  const timeStr = formatRelativeTime(timestamp);

  const markdownComponents: ComponentProps<typeof ReactMarkdown>["components"] =
    useMemo(
      () => ({
        code({ className, children, ...rest }) {
          const match = /language-(\w+)/.exec(className ?? "");
          const codeString = String(children).replace(/\n$/, "");

          // Heuristic: if code has a newline or language class, it's a fenced block
          if (match || codeString.includes("\n")) {
            return (
              <CodeBlock
                language={match?.[1]}
                value={codeString}
              />
            );
          }

          return (
            <code className={className} {...rest}>
              {children}
            </code>
          );
        },
        // Remove wrapping <pre> since CodeBlock provides its own
        pre({ children }) {
          return <>{children}</>;
        },
      }),
      [],
    );

  // System messages — no avatar
  if (role === "system") {
    return (
      <div className="msg-row system">
        <div className="msg-bubble-wrapper system">
          <div className="msg-bubble system">
            <div className="msg-content">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                {content}
              </ReactMarkdown>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const avatarLabel =
    role === "user"
      ? getInitial(username || "U")
      : getInitial(agentName || "A");

  return (
    <div className={`msg-row ${role}`}>
      <div className={`msg-avatar ${role}`}>{avatarLabel}</div>
      <div className={`msg-bubble-wrapper ${role}`}>
        {/* Agent name label for assistant messages */}
        {role === "assistant" && agentName && (
          <div className="msg-agent-name">{agentName}</div>
        )}

        <div
          className={`msg-bubble ${role}${isStreaming ? " streaming" : ""}`}
        >
          <div className="msg-content">
            {role === "user" ? (
              // Render user messages as plain text (preserving whitespace)
              <p style={{ whiteSpace: "pre-wrap", margin: 0 }}>{content}</p>
            ) : (
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={markdownComponents}
              >
                {content}
              </ReactMarkdown>
            )}
            {isStreaming && <span className="msg-streaming-dot" />}
          </div>
        </div>

        <div className="msg-timestamp">{timeStr}</div>
      </div>
    </div>
  );
}
