import { useEffect, useRef } from "react";
import { useAuth } from "./contexts/AuthContext";
import { useWebSocket } from "./hooks/useWebSocket";
import { useChat } from "./hooks/useChat";
import { useToast, ToastProvider } from "./components/Toast";
import LoginPage from "./components/LoginPage";
import Sidebar from "./components/Sidebar";
import ChatArea from "./components/ChatArea";
import "./components/components.css";

function AppContent() {
  const { user, token, isAuthenticated, logout } = useAuth();
  const ws = useWebSocket(token);
  const chat = useChat(ws);
  const { toast } = useToast();

  // Show server errors as toasts (with dedup to prevent error loops)
  const lastErrorKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (chat.lastError) {
      const key = `${chat.lastError.code}:${chat.lastError.message}`;
      if (key !== lastErrorKeyRef.current) {
        lastErrorKeyRef.current = key;
        if (chat.lastError.code !== "AUTH_REQUIRED" && chat.lastError.code !== "INVALID_TOKEN") {
          toast(chat.lastError.message, "error");
        }
        setTimeout(() => { lastErrorKeyRef.current = null; }, 3000);
      }
      chat.clearError();
    }
  }, [chat.lastError, chat.clearError, toast]);

  if (!isAuthenticated || !user) {
    return <LoginPage />;
  }

  const activeConversation = chat.activeConvId
    ? chat.conversations.find((c) => c.id === chat.activeConvId) ?? null
    : null;

  return (
    <div className="app">
      <Sidebar
        conversations={chat.conversations}
        activeConvId={chat.activeConvId}
        agents={chat.agents}
        onSelect={chat.selectConversation}
        onCreate={chat.createConversation}
        onRename={chat.renameConversation}
        onDelete={chat.deleteConversation}
        onLogout={logout}
        username={user.displayName || user.username}
      />
      <ChatArea
        messages={chat.messages}
        streamingMessages={chat.streamingMessages}
        typing={chat.typing}
        onSend={chat.sendMessage}
        onStopGeneration={chat.stopGeneration}
        conversation={activeConversation}
        agents={chat.agents}
        connected={ws.connected}
        username={user.displayName || user.username}
      />
    </div>
  );
}

function App() {
  return (
    <ToastProvider>
      <AppContent />
    </ToastProvider>
  );
}

export default App;
