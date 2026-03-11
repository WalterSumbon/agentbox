// ============================================================
// LoginPage — Sign in / Sign up card
// ============================================================

import { useState, useCallback } from "react";
import type { FormEvent } from "react";
import { useAuth } from "../contexts/AuthContext";
import "./components.css";

export default function LoginPage() {
  const { login, register } = useAuth();

  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      setError(null);

      const trimmedUser = username.trim();
      const trimmedPass = password.trim();

      if (!trimmedUser || !trimmedPass) {
        setError("Username and password are required.");
        return;
      }

      setLoading(true);
      try {
        if (mode === "signin") {
          await login(trimmedUser, trimmedPass);
        } else {
          await register(
            trimmedUser,
            trimmedPass,
            displayName.trim() || undefined,
          );
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong.");
      } finally {
        setLoading(false);
      }
    },
    [mode, username, password, displayName, login, register],
  );

  const switchMode = useCallback(
    (next: "signin" | "signup") => {
      if (next !== mode) {
        setMode(next);
        setError(null);
      }
    },
    [mode],
  );

  return (
    <div className="login-page">
      <div className="login-card">
        {/* Logo */}
        <div className="login-logo">
          <h1>AgentBox</h1>
          <p>Connect with AI agents, seamlessly.</p>
        </div>

        {/* Tabs */}
        <div className="login-tabs">
          <button
            type="button"
            className={`login-tab ${mode === "signin" ? "active" : ""}`}
            onClick={() => switchMode("signin")}
          >
            Sign In
          </button>
          <button
            type="button"
            className={`login-tab ${mode === "signup" ? "active" : ""}`}
            onClick={() => switchMode("signup")}
          >
            Sign Up
          </button>
        </div>

        {/* Form */}
        <form className="login-form" onSubmit={handleSubmit}>
          <div className="login-field">
            <label htmlFor="login-username">Username</label>
            <input
              id="login-username"
              type="text"
              placeholder="Enter your username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              disabled={loading}
            />
          </div>

          <div className="login-field">
            <label htmlFor="login-password">Password</label>
            <input
              id="login-password"
              type="password"
              placeholder="Enter your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={
                mode === "signin" ? "current-password" : "new-password"
              }
              disabled={loading}
            />
          </div>

          {mode === "signup" && (
            <div className="login-field">
              <label htmlFor="login-display-name">
                Display Name (optional)
              </label>
              <input
                id="login-display-name"
                type="text"
                placeholder="How should we call you?"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                disabled={loading}
              />
            </div>
          )}

          {error && <div className="login-error">{error}</div>}

          <button type="submit" className="login-submit" disabled={loading}>
            {loading && <span className="login-spinner" />}
            {mode === "signin" ? "Sign In" : "Create Account"}
          </button>
        </form>
      </div>
    </div>
  );
}
