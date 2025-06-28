import { createHash } from "node:crypto";
import type { Stats } from "node:fs";
import { extname } from "node:path";

/**
 * MIME type mapping for common file extensions.
 *
 * Provides content-type detection for static files based on their extensions.
 * Falls back to 'application/octet-stream' for unknown file types.
 */
export const MIME_TYPES: Record<string, string> = {
  // Text
  ".html": "text/html",
  ".htm": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".txt": "text/plain",
  ".xml": "text/xml",
  ".json": "application/json",

  // Images
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".ico": "image/x-icon",

  // Fonts
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".eot": "application/vnd.ms-fontobject",

  // Documents
  ".pdf": "application/pdf",
  ".zip": "application/zip",
  ".tar": "application/x-tar",
  ".gz": "application/gzip",

  // Media
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
};

/**
 * Determines the MIME type for a file based on its extension.
 *
 * @param filePath - The file path to determine the MIME type for
 * @returns The MIME type string, or 'application/octet-stream' for unknown types
 *
 * @example
 * ```typescript
 * getMimeType('/public/style.css'); // Returns 'text/css'
 * getMimeType('/images/photo.jpg'); // Returns 'image/jpeg'
 * getMimeType('/unknown.xyz'); // Returns 'application/octet-stream'
 * ```
 */
export function getMimeType(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  return MIME_TYPES[ext] || "application/octet-stream";
}

/**
 * Generates an ETag header value for cache validation.
 *
 * Creates a hash-based ETag using file size, modification time, and path.
 * Supports both weak and strong ETags for different caching strategies.
 *
 * @param stats - File statistics containing size and modification time
 * @param filePath - The file path to include in the ETag calculation
 * @param weak - Whether to generate a weak ETag (prefixed with 'W/')
 * @returns The ETag header value
 *
 * @example
 * ```typescript
 * generateETag(fileStats, '/app.js', false); // Returns '"abc123def456789"'
 * generateETag(fileStats, '/app.js', true);  // Returns 'W/"abc123def456789"'
 * ```
 */
export function generateETag(stats: Stats, filePath: string, weak = false): string {
  // Use file size, modification time, and path for ETag generation
  const hash = createHash("sha256");
  hash.update(`${stats.size}-${stats.mtime.getTime()}-${filePath}`);
  const etag = hash.digest("hex").substring(0, 16); // First 16 chars for brevity

  return weak ? `W/"${etag}"` : `"${etag}"`;
}

/**
 * Determines the appropriate Cache-Control header for a file.
 *
 * Supports both global cache control settings and pattern-based
 * rules for different file types.
 *
 * @param filePath - The file path to determine cache control for
 * @param cacheControl - Cache control configuration (string or pattern mapping)
 * @returns The Cache-Control header value, or undefined if not configured
 *
 * @example
 * ```typescript
 * // Global cache control
 * getCacheControl('/app.js', 'max-age=3600'); // Returns 'max-age=3600'
 *
 * // Pattern-based cache control
 * const patterns = {
 *   '\\.js$': 'max-age=3600',
 *   '\\.css$': 'max-age=86400'
 * };
 * getCacheControl('/app.js', patterns); // Returns 'max-age=3600'
 * ```
 */
export function getCacheControl(
  filePath: string,
  cacheControl: string | { [pattern: string]: string } | undefined,
): string | undefined {
  if (!cacheControl) return undefined;

  if (typeof cacheControl === "string") {
    return cacheControl;
  }

  // Pattern matching for different file types
  for (const [pattern, value] of Object.entries(cacheControl)) {
    if (filePath.match(new RegExp(pattern))) {
      return value;
    }
  }

  return undefined;
}
