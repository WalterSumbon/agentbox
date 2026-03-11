// ============================================================
// Minimal REST API helper for AgentBox frontend
// ============================================================

/**
 * Returns the API base URL. We use relative URLs so requests
 * automatically target the current origin (works with proxies, ngrok, etc.).
 */
export function getApiBase(): string {
  return "";
}

/**
 * Send a POST request and return the parsed JSON body.
 * Throws an Error with the server's error message on non-OK responses.
 */
export async function apiPost<T>(
  path: string,
  body: unknown,
  token?: string,
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${getApiBase()}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errorBody = await res.json().catch(() => null);
    const message =
      errorBody?.error?.message ?? errorBody?.message ?? res.statusText;
    throw new Error(message);
  }

  return res.json() as Promise<T>;
}

/**
 * Send a GET request and return the parsed JSON body.
 * Throws an Error with the server's error message on non-OK responses.
 */
export async function apiGet<T>(
  path: string,
  token?: string,
): Promise<T> {
  const headers: Record<string, string> = {};
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${getApiBase()}${path}`, {
    method: "GET",
    headers,
  });

  if (!res.ok) {
    const errorBody = await res.json().catch(() => null);
    const message =
      errorBody?.error?.message ?? errorBody?.message ?? res.statusText;
    throw new Error(message);
  }

  return res.json() as Promise<T>;
}
