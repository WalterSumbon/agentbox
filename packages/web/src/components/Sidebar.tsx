// ============================================================
// Sidebar — conversation list, new chat, user controls
// ============================================================

import { useState, useCallback, useEffect, useRef } from "react";
import type { MouseEvent, KeyboardEvent } from "react";
import type { Conversation, AgentDescriptor } from "@agentbox/shared";
import "./components.css";

// ---------- Props ----------

interface SidebarProps {
  conversations: Conversation[];
  activeConvId: string | null;
  agents: AgentDescriptor[];
  onSelect: (id: string) => void;
  onCreate: (opts?: {
    title?: string;
    type?: "direct" | "group";
    agentId?: string;
    agentIds?: string[];
  }) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onLogout: () => void;
  username: string;
}

// ---------- Context-menu state ----------

interface ContextMenuState {
  convId: string;
  x: number;
  y: number;
}

// ---------- Helpers ----------

function formatConvTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return "now";
  if (minutes < 60) return `${minutes}m`;
  if (hours < 24) return `${hours}h`;
  if (days < 7) return `${days}d`;

  const d = new Date(timestamp);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

// ---------- Component ----------

export default function Sidebar({
  conversations,
  activeConvId,
  agents,
  onSelect,
  onCreate,
  onRename,
  onDelete,
  onLogout,
  username,
}: SidebarProps) {
  // Sort conversations by updatedAt descending
  const sorted = [...conversations].sort((a, b) => b.updatedAt - a.updatedAt);

  // Context menu
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState | null>(null);
  const ctxMenuRef = useRef<HTMLDivElement>(null);

  // Rename state
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);

  // Group dialog
  const [showGroupDialog, setShowGroupDialog] = useState(false);
  const [selectedAgentIds, setSelectedAgentIds] = useState<Set<string>>(
    new Set(),
  );

  // Close context menu on outside click
  useEffect(() => {
    if (!ctxMenu) return;
    const handleClick = (e: globalThis.MouseEvent) => {
      if (
        ctxMenuRef.current &&
        !ctxMenuRef.current.contains(e.target as Node)
      ) {
        setCtxMenu(null);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [ctxMenu]);

  // Focus rename input
  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingId]);

  const handleContextMenu = useCallback(
    (e: MouseEvent, convId: string) => {
      e.preventDefault();
      e.stopPropagation();
      setCtxMenu({ convId, x: e.clientX, y: e.clientY });
    },
    [],
  );

  const handleMenuBtn = useCallback(
    (e: MouseEvent, convId: string) => {
      e.stopPropagation();
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      setCtxMenu({ convId, x: rect.right, y: rect.bottom });
    },
    [],
  );

  const startRename = useCallback(
    (convId: string) => {
      const conv = conversations.find((c) => c.id === convId);
      setRenameValue(conv?.title ?? "");
      setRenamingId(convId);
      setCtxMenu(null);
    },
    [conversations],
  );

  const commitRename = useCallback(() => {
    if (renamingId && renameValue.trim()) {
      onRename(renamingId, renameValue.trim());
    }
    setRenamingId(null);
  }, [renamingId, renameValue, onRename]);

  const handleRenameKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        commitRename();
      } else if (e.key === "Escape") {
        setRenamingId(null);
      }
    },
    [commitRename],
  );

  const handleDelete = useCallback(
    (convId: string) => {
      setCtxMenu(null);
      onDelete(convId);
    },
    [onDelete],
  );

  // Group chat dialog
  const openGroupDialog = useCallback(() => {
    setSelectedAgentIds(new Set());
    setShowGroupDialog(true);
  }, []);

  const toggleAgent = useCallback((agentId: string) => {
    setSelectedAgentIds((prev) => {
      const next = new Set(prev);
      if (next.has(agentId)) {
        next.delete(agentId);
      } else {
        next.add(agentId);
      }
      return next;
    });
  }, []);

  const createGroupChat = useCallback(() => {
    if (selectedAgentIds.size === 0) return;
    onCreate({
      type: "group",
      agentIds: Array.from(selectedAgentIds),
    });
    setShowGroupDialog(false);
  }, [selectedAgentIds, onCreate]);

  const userInitial = username.charAt(0).toUpperCase();

  return (
    <div className="sidebar">
      {/* Header buttons */}
      <div className="sidebar-header">
        <button
          className="sidebar-new-chat-btn"
          onClick={() => onCreate({ type: "direct" })}
        >
          + New Chat
        </button>
        <button className="sidebar-new-group-btn" onClick={openGroupDialog}>
          + New Group Chat
        </button>
        {agents.length > 0 && (
          <div className="sidebar-agents-badge">
            <span
              className={`sidebar-agents-dot ${agents.length > 0 ? "" : "offline"}`}
            />
            {agents.length} agent{agents.length !== 1 ? "s" : ""} online
          </div>
        )}
      </div>

      {/* Conversation list */}
      <div className="sidebar-conversations">
        {sorted.map((conv) => (
          <div
            key={conv.id}
            className={`sidebar-conv-item ${conv.id === activeConvId ? "active" : ""}`}
            onClick={() => onSelect(conv.id)}
            onContextMenu={(e) => handleContextMenu(e, conv.id)}
          >
            <div className={`sidebar-conv-icon ${conv.type}`}>
              {conv.type === "group" ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                  <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
              )}
            </div>
            <div className="sidebar-conv-info">
              {renamingId === conv.id ? (
                <input
                  ref={renameInputRef}
                  className="sidebar-rename-input"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={handleRenameKeyDown}
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <>
                  <div className="sidebar-conv-title">
                    {conv.title ?? "New Chat"}
                  </div>
                  <div className="sidebar-conv-meta">
                    <span className={`sidebar-conv-type-badge ${conv.type}`}>
                      {conv.type}
                    </span>
                  </div>
                </>
              )}
            </div>
            <span className="sidebar-conv-time">
              {formatConvTime(conv.updatedAt)}
            </span>
            <button
              className={`sidebar-conv-menu-btn ${ctxMenu?.convId === conv.id ? "open" : ""}`}
              onClick={(e) => handleMenuBtn(e, conv.id)}
              title="Options"
            >
              &#x2026;
            </button>
          </div>
        ))}
      </div>

      {/* Context menu */}
      {ctxMenu && (
        <div
          ref={ctxMenuRef}
          className="sidebar-context-menu"
          style={{ top: ctxMenu.y, left: ctxMenu.x }}
        >
          <button
            className="sidebar-context-menu-item"
            onClick={() => startRename(ctxMenu.convId)}
          >
            Rename
          </button>
          <button
            className="sidebar-context-menu-item danger"
            onClick={() => handleDelete(ctxMenu.convId)}
          >
            Delete
          </button>
        </div>
      )}

      {/* Footer */}
      <div className="sidebar-footer">
        <div className="sidebar-user-avatar">{userInitial}</div>
        <div className="sidebar-user-name">{username}</div>
        <button className="sidebar-logout-btn" onClick={onLogout}>
          Logout
        </button>
      </div>

      {/* Group chat dialog */}
      {showGroupDialog && (
        <div
          className="sidebar-group-dialog-overlay"
          onClick={() => setShowGroupDialog(false)}
        >
          <div
            className="sidebar-group-dialog"
            onClick={(e) => e.stopPropagation()}
          >
            <h3>New Group Chat</h3>
            <p style={{ margin: "0 0 14px", fontSize: "0.85rem", color: "#6e7399" }}>
              Select agents to include:
            </p>
            <div className="sidebar-group-dialog-agents">
              {agents.length === 0 && (
                <div className="sidebar-group-dialog-empty">
                  No agents connected.
                </div>
              )}
              {agents.map((agent) => (
                <div
                  key={agent.id}
                  className={`sidebar-group-dialog-agent ${selectedAgentIds.has(agent.id) ? "selected" : ""}`}
                  onClick={() => toggleAgent(agent.id)}
                >
                  <div className="sidebar-group-dialog-checkbox">
                    {selectedAgentIds.has(agent.id) && (
                      <span style={{ fontSize: "0.7rem" }}>&#10003;</span>
                    )}
                  </div>
                  <div className="sidebar-group-dialog-agent-info">
                    <div className="sidebar-group-dialog-agent-name">
                      {agent.name}
                    </div>
                    <div className="sidebar-group-dialog-agent-desc">
                      {agent.description}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="sidebar-group-dialog-actions">
              <button
                className="sidebar-group-dialog-cancel"
                onClick={() => setShowGroupDialog(false)}
              >
                Cancel
              </button>
              <button
                className="sidebar-group-dialog-create"
                onClick={createGroupChat}
                disabled={selectedAgentIds.size === 0}
              >
                Create ({selectedAgentIds.size})
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
