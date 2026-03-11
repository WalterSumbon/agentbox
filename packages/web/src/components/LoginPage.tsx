// ============================================================
// LoginPage — Token-based login card (no registration)
// ============================================================

import { useState, useCallback } from "react";
import type { FormEvent } from "react";
import { useAuth } from "../contexts/AuthContext";
import "./components.css";

export default function LoginPage() {
  const { login } = useAuth();

  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      setError(null);

      const trimmedToken = token.trim();

      if (!trimmedToken) {
        setError("Token is required.");
        return;
      }

      setLoading(true);
      try {
        await login(trimmedToken);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Invalid token.");
      } finally {
        setLoading(false);
      }
    },
    [token, login],
  );

  return (
    <div className="login-page">
      <div className="login-card">
        {/* Logo */}
        <div className="login-logo">
          <h1>AgentBox</h1>
          <p>Connect with AI agents, seamlessly.</p>
        </div>

        {/* Form */}
        <form className="login-form" onSubmit={handleSubmit}>
          <div className="login-field">
            <label htmlFor="login-token">Access Token</label>
            <input
              id="login-token"
              type="text"
              placeholder="Enter your access token"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              autoComplete="off"
              autoFocus
              disabled={loading}
              style={{ fontFamily: "var(--font-mono)", letterSpacing: "0.05em" }}
            />
          </div>

          {error && <div className="login-error">{error}</div>}

          <button type="submit" className="login-submit" disabled={loading}>
            {loading && <span className="login-spinner" />}
            Sign In
          </button>

          <div
            style={{
              textAlign: "center",
              fontSize: "0.8rem",
              color: "var(--main-text-muted)",
              marginTop: "8px",
            }}
          >
            Get your token from the administrator.
          </div>
        </form>
      </div>
    </div>
  );
}
