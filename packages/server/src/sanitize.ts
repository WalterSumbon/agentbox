/**
 * Input sanitization utilities.
 *
 * Provides functions to strip HTML tags and enforce content size limits
 * to prevent stored XSS and oversized payloads.
 */

/**
 * Strip all HTML tags from a string, leaving only text content.
 * This prevents stored XSS by removing `<script>`, `<img onerror=...>`, etc.
 */
export function stripHtml(input: string): string {
  return input.replace(/<[^>]*>/g, "");
}

/**
 * Maximum allowed message content length (32 KB).
 * Messages exceeding this limit will be rejected.
 */
export const MAX_MESSAGE_LENGTH = 32_768;

/**
 * Maximum allowed conversation title length (256 characters).
 */
export const MAX_TITLE_LENGTH = 256;
