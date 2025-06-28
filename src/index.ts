import type { Stats } from "node:fs";
import { stat } from "node:fs/promises";
import { handleCompression } from "./compression.js";
import { generateETag, getCacheControl, getMimeType } from "./content-utils.js";
import { checkForSymlink, handleDirectoryRequest, resolveFilePath, shouldServeDotfile } from "./fs-utils.js";
import { handleConditionalRequests, handleRangeRequest } from "./http-utils.js";
import { createBufferedResponse, createStreamingResponse } from "./response.js";
import { FileServerError, validateFileServerOptions } from "./validators.js";

/**
 * Configuration options for the file server.
 *
 * @example
 * ```typescript
 * const options: FileServerOptions = {
 *   root: './public',
 *   index: ['index.html', 'index.htm'],
 *   dotfiles: 'deny',
 *   compression: true,
 *   streaming: true
 * };
 * ```
 */
export interface FileServerOptions {
  /** The root directory to serve files from. Must be an absolute path. */
  root: string;
  /** List of index filenames to look for in directories. Defaults to ['index.html']. */
  index?: string[];
  /** How to handle dotfiles: 'allow' serves them, 'deny' returns 403, 'ignore' returns 404. Defaults to 'ignore'. */
  dotfiles?: "allow" | "deny" | "ignore";
  /** Additional headers to include in all responses. */
  headers?: Record<string, string>;
  /** Whether to use streaming responses for better memory efficiency. Defaults to true. */
  streaming?: boolean;
  /** ETag generation: true/'weak' uses file stats, 'strong' for byte-perfect validation, false disables. Defaults to true. */
  etag?: boolean | "strong" | "weak";
  /** Compression support: true enables all, array specifies encodings, false disables. Defaults to true. */
  compression?: boolean | string[];
  /** Whether to serve pre-compressed files (.gz, .br) when available. Defaults to true. */
  precompressed?: boolean;
  /** Cache-Control header: string for all files, or object mapping file patterns to cache directives. */
  cacheControl?: string | { [pattern: string]: string };
}

/**
 * A simple file server request handler that works with standard web Request/Response objects.
 *
 * @param request - The incoming HTTP request
 * @returns Promise resolving to an HTTP response
 */
export type FileServerHandler = (request: Request) => Promise<Response>;

// Default configuration values
const DEFAULT_OPTIONS = {
  dotfiles: "ignore" as const,
  headers: {},
  index: ["index.html"],
  streaming: true,
  etag: true,
  compression: true,
  precompressed: true,
};

/**
 * Creates a file server handler function that serves static files.
 *
 * The returned handler is compatible with web standard Request/Response objects
 * making it suitable for use with any JavaScript runtime that supports Request/Response objects.
 *
 * @param options - Configuration options for the file server
 * @returns A handler function that processes HTTP requests and serves files
 *
 * @throws {FileServerError} When options validation fails
 *
 * @example
 * ```typescript
 * import { createFileServer } from '@foladayo/web-file-server';
 *
 * const handler = createFileServer({
 *   root: '/path/to/public',
 *   index: ['index.html'],
 *   compression: true,
 *   etag: true
 * });
 * ```
 */
export function createFileServer(options: FileServerOptions): FileServerHandler {
  validateFileServerOptions(options);

  const config = { ...DEFAULT_OPTIONS, ...options };

  // Default supported compression methods
  const supportedEncodings = Array.isArray(config.compression)
    ? config.compression
    : config.compression
    ? ["br", "gzip", "deflate"]
    : [];

  return async (request: Request): Promise<Response> => {
    // Only handle GET and HEAD requests
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", {
        status: 405,
        headers: { Allow: "GET, HEAD" },
      });
    }

    const isHeadRequest = request.method === "HEAD";

    try {
      const url = new URL(request.url);
      let { filePath, isValid } = resolveFilePath(url.pathname, config.root);

      // Security check failed
      if (!isValid) {
        return new Response("Forbidden", { status: 403 });
      }

      // Check dotfile policy
      if (!shouldServeDotfile(filePath, config.dotfiles)) {
        return new Response("Not Found", { status: 404 });
      }

      // Check if file exists and get stats first
      let fileStats: Stats;
      try {
        fileStats = await stat(filePath);
      } catch (cause) {
        const error = new FileServerError(
          "FILE_NOT_FOUND",
          "File not found or inaccessible",
          404,
          filePath,
          "file_stat",
          cause instanceof Error ? cause : new Error(String(cause))
        );

        return new Response(error.message, { status: error.statusCode });
      }

      // Check for symlinks and deny them for security (only after we know file exists)
      const symlinkError = checkForSymlink(filePath);

      if (symlinkError) {
        return new Response(symlinkError.message, { status: symlinkError.statusCode });
      }

      // If it's a directory, try to serve index files
      if (fileStats.isDirectory()) {
        const { indexPath, indexStats } = await handleDirectoryRequest(filePath, config.index);

        if (!indexPath || !indexStats) {
          return new Response("Not Found", { status: 404 });
        }

        filePath = indexPath;
        fileStats = indexStats;
      }

      // Check for compression support and pre-compressed files
      const compressionResult = await handleCompression(filePath, request, supportedEncodings, config.precompressed);
      const finalFilePath = compressionResult.finalFilePath;
      const contentEncoding = compressionResult.contentEncoding;

      // Update file stats if we're using a compressed file
      if (compressionResult.fileStats) {
        fileStats = compressionResult.fileStats;
      }

      // Generate ETag if enabled (use final file path for ETag)
      let etagValue: string | undefined;

      if (config.etag) {
        const isWeak = config.etag === "weak";
        etagValue = generateETag(fileStats, filePath, isWeak);
      }

      // Check for range requests
      const rangeResult = handleRangeRequest(request, fileStats, etagValue, config.headers);

      if (rangeResult.rangeResponse) {
        return rangeResult.rangeResponse;
      }

      const rangeRequest = rangeResult.rangeRequest;

      // Check conditional requests
      const conditionalResponse = handleConditionalRequests(request, fileStats, etagValue, config.headers);

      if (conditionalResponse) {
        return conditionalResponse;
      }

      // Determine response status and content length
      const isRangeRequest = !!rangeRequest;
      const status = isRangeRequest ? 206 : 200;
      const contentLength = rangeRequest ? rangeRequest.contentLength : fileStats.size;

      // Prepare response headers
      const mimeType = getMimeType(filePath); // Use original file for MIME type
      const cacheControlValue = getCacheControl(filePath, config.cacheControl);

      const responseHeaders = new Headers({
        "Content-Type": mimeType,
        "Content-Length": String(contentLength),
        "Last-Modified": fileStats.mtime.toUTCString(),
        "Accept-Ranges": "bytes",
        ...(etagValue && { ETag: etagValue }),
        ...(contentEncoding && { "Content-Encoding": contentEncoding }),
        ...(cacheControlValue && { "Cache-Control": cacheControlValue }),
        ...(rangeRequest && {
          "Content-Range": `bytes ${rangeRequest.start}-${rangeRequest.end}/${fileStats.size}`,
        }),
        ...config.headers,
      });

      // For HEAD requests, return headers only without reading file content
      if (isHeadRequest) {
        return new Response(null, { status, headers: responseHeaders });
      }

      // Use streaming for better memory efficiency (default)
      try {
        if (config.streaming) {
          return await createStreamingResponse(
            finalFilePath,
            rangeRequest,
            fileStats,
            isHeadRequest,
            status,
            responseHeaders
          );
        } else {
          return await createBufferedResponse(finalFilePath, rangeRequest, isHeadRequest, status, responseHeaders);
        }
      } catch (cause) {
        const errorCode = config.streaming ? "STREAM_READ_ERROR" : "BUFFER_READ_ERROR";
        const errorMessage = config.streaming ? "Failed to open file for streaming" : "Failed to read file into memory";
        const operation = config.streaming ? "file_stream" : "file_buffer";

        const error = new FileServerError(
          errorCode,
          errorMessage,
          500,
          finalFilePath,
          operation,
          cause instanceof Error ? cause : new Error(String(cause))
        );

        return new Response(error.message, { status: error.statusCode });
      }
    } catch (cause) {
      const error = new FileServerError(
        "REQUEST_PROCESSING_ERROR",
        "Unexpected error processing request",
        500,
        undefined,
        "request_processing",
        cause instanceof Error ? cause : new Error(String(cause))
      );

      return new Response(error.message, { status: error.statusCode });
    }
  };
}

export { FileServerError };
