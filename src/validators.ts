import { statSync } from "node:fs";
import type { FileServerOptions } from "./index.js";

/**
 * Custom error class for file server operations.
 * 
 * Provides structured error information including error codes,
 * HTTP status codes, file paths, and operation context.
 * 
 * @example
 * ```typescript
 * try {
 *   // file server operation
 * } catch (error) {
 *   if (error instanceof FileServerError) {
 *     console.log(`Error ${error.code}: ${error.message}`);
 *     console.log(`Status: ${error.statusCode}`);
 *     console.log(`File: ${error.filePath}`);
 *   }
 * }
 * ```
 */
export class FileServerError extends Error {
  /**
   * Creates a new FileServerError.
   * 
   * @param code - Machine-readable error code (e.g., 'FILE_NOT_FOUND', 'INVALID_CONFIG')
   * @param message - Human-readable error message
   * @param statusCode - HTTP status code to return to client
   * @param filePath - File path related to the error, if applicable
   * @param operation - Operation being performed when error occurred
   * @param cause - Underlying error that caused this error
   */
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number,
    public readonly filePath?: string,
    public readonly operation?: string,
    cause?: Error,
  ) {
    super(message);
    this.name = "FileServerError";
    if (cause) this.cause = cause;
  }
}

function validateRootDirectory(root: unknown): void {
  if (!root || typeof root !== "string") {
    throw new FileServerError(
      "INVALID_CONFIG",
      "Root directory must be a non-empty string",
      500,
      String(root),
      "config_validation",
    );
  }

  try {
    const rootStats = statSync(root);
    if (!rootStats.isDirectory()) {
      throw new FileServerError(
        "INVALID_ROOT",
        `Root path is not a directory: ${root}`,
        500,
        root,
        "config_validation",
      );
    }
  } catch (cause) {
    if (cause instanceof FileServerError) {
      throw cause;
    }
    throw new FileServerError(
      "ROOT_NOT_ACCESSIBLE",
      `Root directory not accessible: ${root}`,
      500,
      root,
      "config_validation",
      cause instanceof Error ? cause : new Error(String(cause)),
    );
  }
}

function validateCacheControl(
  cacheControl: string | { [pattern: string]: string } | undefined,
): void {
  if (!cacheControl || typeof cacheControl === "string") return;

  for (const [pattern, value] of Object.entries(cacheControl)) {
    try {
      new RegExp(pattern);
    } catch (cause) {
      throw new FileServerError(
        "INVALID_CACHE_PATTERN",
        `Invalid regex pattern in cache control: ${pattern}`,
        500,
        undefined,
        "config_validation",
        cause instanceof Error ? cause : new Error(String(cause)),
      );
    }
    if (typeof value !== "string") {
      throw new FileServerError(
        "INVALID_CACHE_VALUE",
        `Cache control value must be a string: ${pattern}`,
        500,
        undefined,
        "config_validation",
      );
    }
  }
}

function validateCompression(compression: boolean | string[] | undefined): void {
  if (!Array.isArray(compression)) return;

  const validEncodings = ["br", "gzip", "deflate"];
  for (const encoding of compression) {
    if (!validEncodings.includes(encoding)) {
      throw new FileServerError(
        "INVALID_COMPRESSION",
        `Unsupported compression algorithm: ${encoding}. Supported: ${validEncodings.join(", ")}`,
        500,
        undefined,
        "config_validation",
      );
    }
  }
}

function validateIndexFiles(index: string[] | undefined): void {
  if (!index) return;

  if (!Array.isArray(index)) {
    throw new FileServerError(
      "INVALID_INDEX",
      "Index option must be an array of strings",
      500,
      undefined,
      "config_validation",
    );
  }

  for (const indexFile of index) {
    if (typeof indexFile !== "string" || indexFile.trim() === "") {
      throw new FileServerError(
        "INVALID_INDEX_FILE",
        "Index file names must be non-empty strings",
        500,
        undefined,
        "config_validation",
      );
    }
  }
}

/**
 * Validates file server configuration options.
 * 
 * Performs comprehensive validation of all configuration options,
 * ensuring the server can start safely with the provided settings.
 * 
 * @param options - The configuration options to validate
 * @throws {FileServerError} When validation fails for any option
 * 
 * @example
 * ```typescript
 * try {
 *   validateFileServerOptions({ root: '/invalid/path' });
 * } catch (error) {
 *   console.error('Configuration invalid:', error.message);
 * }
 * ```
 */
export function validateFileServerOptions(options: FileServerOptions): void {
  validateRootDirectory(options.root);
  validateCacheControl(options.cacheControl);
  validateCompression(options.compression);
  validateIndexFiles(options.index);
}
