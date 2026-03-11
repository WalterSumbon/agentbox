/**
 * Authentication module — JWT + bcrypt.
 *
 * Provides user registration, login, and token verification.
 * JWT tokens are used for both REST API and WebSocket authentication.
 */
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import type { UserInfo, AuthResponse } from "@agentbox/shared";
import * as store from "./store/sqlite.js";
import { stripHtml } from "./sanitize.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * JWT secret — auto-generated per process if not set via env.
 * In production, set AGENTBOX_JWT_SECRET for persistence across restarts.
 */
const JWT_SECRET = process.env.AGENTBOX_JWT_SECRET || crypto.randomBytes(32).toString("hex");

/** Token expiration (7 days) */
const TOKEN_EXPIRY = "7d";

/** bcrypt cost factor */
const BCRYPT_ROUNDS = 10;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Register a new user.
 * @throws Error if username is already taken or validation fails.
 */
export async function register(
  username: string,
  password: string,
  displayName?: string,
): Promise<AuthResponse> {
  // Validation
  username = username.trim().toLowerCase();
  if (!username || username.length < 2 || username.length > 32) {
    throw new AuthError("Username must be 2–32 characters", "INVALID_USERNAME");
  }
  if (!/^[a-z0-9_-]+$/.test(username)) {
    throw new AuthError(
      "Username can only contain letters, numbers, hyphens, and underscores",
      "INVALID_USERNAME",
    );
  }
  if (!password || password.length < 6) {
    throw new AuthError("Password must be at least 6 characters", "WEAK_PASSWORD");
  }

  // Sanitize displayName — strip HTML tags to prevent stored XSS
  let sanitizedDisplayName = displayName ? stripHtml(displayName).trim() : username;
  if (!sanitizedDisplayName) {
    sanitizedDisplayName = username;
  }
  if (sanitizedDisplayName.length > 64) {
    sanitizedDisplayName = sanitizedDisplayName.slice(0, 64);
  }

  // Check uniqueness
  const existing = store.getUserByUsername(username);
  if (existing) {
    throw new AuthError("Username already taken", "USERNAME_TAKEN");
  }

  // Hash & create
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const user = store.createUser(username, passwordHash, sanitizedDisplayName);

  // Issue token
  const token = signToken(user);
  return { token, user };
}

/**
 * Authenticate with username + password.
 * @throws AuthError if credentials are invalid.
 */
export async function login(
  username: string,
  password: string,
): Promise<AuthResponse> {
  username = username.trim().toLowerCase();

  const row = store.getUserByUsername(username);
  if (!row) {
    throw new AuthError("Invalid username or password", "INVALID_CREDENTIALS");
  }

  const match = await bcrypt.compare(password, row.password_hash);
  if (!match) {
    throw new AuthError("Invalid username or password", "INVALID_CREDENTIALS");
  }

  const user: UserInfo = {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    createdAt: row.created_at,
  };

  const token = signToken(user);
  return { token, user };
}

/**
 * Verify a JWT token and return the user info.
 * @throws AuthError if the token is invalid or expired.
 */
export function verifyToken(token: string): UserInfo {
  try {
    const payload = jwt.verify(token, JWT_SECRET) as JwtPayload;
    // Verify user still exists in the database
    const user = store.getUserById(payload.sub);
    if (!user) {
      throw new AuthError("User no longer exists", "USER_NOT_FOUND");
    }
    return user;
  } catch (err) {
    if (err instanceof AuthError) throw err;
    throw new AuthError("Invalid or expired token", "INVALID_TOKEN");
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface JwtPayload {
  sub: string; // user ID
  username: string;
  iat: number;
  exp: number;
}

function signToken(user: UserInfo): string {
  return jwt.sign(
    { sub: user.id, username: user.username },
    JWT_SECRET,
    { expiresIn: TOKEN_EXPIRY },
  );
}

/**
 * Custom error class for auth failures with an error code.
 */
export class AuthError extends Error {
  code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "AuthError";
    this.code = code;
  }
}
