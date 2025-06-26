import { createHash } from "node:crypto";
import type { Stats } from "node:fs";
import { type FileHandle, open, stat } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";

export interface FileServerOptions {
  root: string;
  index?: string[];
  dotfiles?: "allow" | "deny" | "ignore";
  headers?: Record<string, string>;
  streaming?: boolean; // Default true for memory efficiency
  etag?: boolean | "strong" | "weak"; // Default true. "weak" uses file stats, "strong" implies byte-perfect validation
  compression?: boolean | string[]; // Default true for gzip, brotli, deflate
  precompressed?: boolean; // Default true, serve .gz/.br files when available
  cacheControl?: string | { [pattern: string]: string }; // Cache-Control directives
}

export type FileServerHandler = (request: Request) => Promise<Response>;

// MIME type mapping for common file extensions
const MIME_TYPES: Record<string, string> = {
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
 * Resolves URL pathname to filesystem path with security checks using Node.js path APIs
 */
function resolveFilePath(pathname: string, root: string): { filePath: string; isValid: boolean } {
  try {
    // Decode URL components
    const decodedPath = decodeURIComponent(pathname);

    // Remove leading slash
    const relativePath = decodedPath.replace(/^\/+/, "");

    // Resolve the absolute paths
    const absoluteRoot = resolve(root);
    const requestedPath = resolve(absoluteRoot, relativePath);

    // Security check: ensure the resolved path is within the root directory
    const relativeToRoot = relative(absoluteRoot, requestedPath);

    // If the relative path starts with .. or is absolute, it's outside the root
    if (relativeToRoot.startsWith("..") || resolve(relativeToRoot) === relativeToRoot) {
      return { filePath: "", isValid: false };
    }

    return { filePath: requestedPath, isValid: true };
  } catch {
    return { filePath: "", isValid: false };
  }
}

/**
 * Gets MIME type based on file extension
 */
function getMimeType(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  return MIME_TYPES[ext] || "application/octet-stream";
}

/**
 * Generates ETag based on file stats (size, mtime, path)
 * This is standard practice for static file servers (like nginx)
 */
function generateETag(stats: Stats, filePath: string, weak = false): string {
  // Use file size, modification time, and path for ETag generation
  const hash = createHash("sha256");
  hash.update(`${stats.size}-${stats.mtime.getTime()}-${filePath}`);
  const etag = hash.digest("hex").substring(0, 16); // First 16 chars for brevity

  return weak ? `W/"${etag}"` : `"${etag}"`;
}

/**
 * Parses HTTP Range header
 */
function parseRange(
  rangeHeader: string,
  fileSize: number,
): { start: number; end: number; contentLength: number } | null {
  const ranges = rangeHeader.replace(/bytes=/, "").split(",");
  const range = ranges[0]; // Only handle single range for now

  if (!range) return null;

  const [startStr, endStr] = range.split("-");

  let start: number;
  let end: number;

  if (startStr === "") {
    // Suffix range: -500 (last 500 bytes)
    start = Math.max(0, fileSize - parseInt(endStr));
    end = fileSize - 1;
  } else if (endStr === "") {
    // Start range: 500- (from byte 500 to end)
    start = parseInt(startStr);
    end = fileSize - 1;
  } else {
    // Full range: 500-1000
    start = parseInt(startStr);
    end = parseInt(endStr);
  }

  // Validate range
  if (
    Number.isNaN(start) ||
    Number.isNaN(end) ||
    start >= fileSize ||
    end >= fileSize ||
    start > end
  ) {
    return null;
  }

  return {
    start,
    end,
    contentLength: end - start + 1,
  };
}

/**
 * Parses Accept-Encoding header to determine best compression method
 */
function parseAcceptEncoding(
  acceptEncoding: string | null,
  supportedEncodings: string[],
): string | null {
  if (!acceptEncoding) return null;

  // Parse Accept-Encoding header with quality values
  const encodings = acceptEncoding
    .split(",")
    .map((enc) => {
      const [encoding, q = "q=1"] = enc.trim().split(";");
      const quality = parseFloat(q.replace("q=", "")) || 1;
      return { encoding: encoding.trim(), quality };
    })
    .filter((enc) => enc.quality > 0)
    .sort((a, b) => b.quality - a.quality);

  // Return the first supported encoding in order of preference
  for (const { encoding } of encodings) {
    if (supportedEncodings.includes(encoding)) {
      return encoding;
    }
  }

  return null;
}

/**
 * Check if a pre-compressed file exists
 */
async function findPrecompressedFile(filePath: string, encoding: string): Promise<string | null> {
  const extensions: Record<string, string> = {
    br: ".br",
    gzip: ".gz",
    deflate: ".gz", // Fallback to gzip for deflate
  };

  const ext = extensions[encoding];
  if (!ext) return null;

  const compressedPath = `${filePath}${ext}`;

  try {
    await stat(compressedPath);
    return compressedPath;
  } catch {
    return null;
  }
}

/**
 * Determine cache control value based on file path and configuration
 */
function getCacheControl(
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

/**
 * Checks if a file is a dotfile and should be served based on options
 */
function shouldServeDotfile(filePath: string, dotfiles: "allow" | "deny" | "ignore"): boolean {
  const fileName = filePath.split("/").pop() || "";
  const isDotfile = fileName.startsWith(".");

  if (!isDotfile) return true;

  switch (dotfiles) {
    case "allow":
      return true;
    case "deny":
      return false;
    case "ignore":
      return false;
    default:
      return false;
  }
}

export function createFileServer(options: FileServerOptions): FileServerHandler {
  const {
    root,
    dotfiles = "ignore",
    headers = {},
    index = ["index.html"],
    streaming = true,
    etag = true,
    compression = true,
    precompressed = true,
    cacheControl,
  } = options;

  // Default supported compression methods
  const supportedEncodings = Array.isArray(compression)
    ? compression
    : compression
      ? ["br", "gzip", "deflate"]
      : [];

  return async (request: Request): Promise<Response> => {
    // Only handle GET requests
    if (request.method !== "GET") {
      return new Response("Method Not Allowed", {
        status: 405,
        headers: { Allow: "GET" },
      });
    }

    try {
      const url = new URL(request.url);
      let { filePath, isValid } = resolveFilePath(url.pathname, root);

      // Security check failed
      if (!isValid) {
        return new Response("Forbidden", { status: 403 });
      }

      // Check dotfile policy
      if (!shouldServeDotfile(filePath, dotfiles)) {
        return new Response("Not Found", { status: 404 });
      }

      // Check if file exists and get stats
      let fileStats: Stats;
      try {
        fileStats = await stat(filePath);
      } catch {
        return new Response("Not Found", { status: 404 });
      }

      // If it's a directory, try to serve index files
      if (fileStats.isDirectory()) {
        let indexFound = false;
        for (const indexFile of index) {
          const indexPath = resolve(filePath, indexFile);
          try {
            const indexStats = await stat(indexPath);
            if (indexStats.isFile()) {
              filePath = indexPath;
              fileStats = indexStats;
              indexFound = true;
              break;
            }
          } catch {
            // Continue to next index file
          }
        }

        if (!indexFound) {
          return new Response("Not Found", { status: 404 });
        }
      }

      // Check for compression support and pre-compressed files
      let finalFilePath = filePath;
      let contentEncoding: string | undefined;

      if (supportedEncodings.length > 0) {
        const acceptEncoding = request.headers.get("accept-encoding");
        const preferredEncoding = parseAcceptEncoding(acceptEncoding, supportedEncodings);

        if (preferredEncoding && precompressed) {
          // Try to find pre-compressed file
          const precompressedPath = await findPrecompressedFile(filePath, preferredEncoding);
          if (precompressedPath) {
            finalFilePath = precompressedPath;
            contentEncoding = preferredEncoding;
            // Update file stats for the compressed file
            try {
              fileStats = await stat(finalFilePath);
            } catch {
              // Fall back to original file if compressed version is unreadable
              finalFilePath = filePath;
              contentEncoding = undefined;
            }
          }
        }
      }

      // Generate ETag if enabled (use final file path for ETag)
      let etagValue: string | undefined;
      if (etag) {
        const isWeak = etag === "weak";
        etagValue = generateETag(fileStats, filePath, isWeak);
      }

      // Check for range requests
      const rangeHeader = request.headers.get("range");
      const rangeRequest = rangeHeader ? parseRange(rangeHeader, fileStats.size) : null;

      // If range is invalid, return 416 Range Not Satisfiable
      if (rangeHeader && !rangeRequest) {
        return new Response("Range Not Satisfiable", {
          status: 416,
          headers: {
            "Content-Range": `bytes */${fileStats.size}`,
            ...(etagValue && { ETag: etagValue }),
            ...headers,
          },
        });
      }

      // Check conditional requests
      const ifNoneMatch = request.headers.get("if-none-match");
      const ifModifiedSince = request.headers.get("if-modified-since");

      // Handle If-None-Match (ETag-based conditional)
      if (ifNoneMatch && etagValue) {
        const clientETags = ifNoneMatch.split(",").map((tag) => tag.trim());
        if (clientETags.includes(etagValue) || clientETags.includes("*")) {
          return new Response(null, {
            status: 304,
            headers: {
              ETag: etagValue,
              "Last-Modified": fileStats.mtime.toUTCString(),
              ...headers,
            },
          });
        }
      }

      // Handle If-Modified-Since (timestamp-based conditional)
      if (ifModifiedSince && !ifNoneMatch) {
        const clientDate = new Date(ifModifiedSince);
        const fileDate = new Date(fileStats.mtime);

        // Remove milliseconds for comparison
        fileDate.setMilliseconds(0);

        if (fileDate <= clientDate) {
          return new Response(null, {
            status: 304,
            headers: {
              "Last-Modified": fileStats.mtime.toUTCString(),
              ...(etagValue && { ETag: etagValue }),
              ...headers,
            },
          });
        }
      }

      // Determine response status and content length
      const isRangeRequest = !!rangeRequest;
      const status = isRangeRequest ? 206 : 200;
      const contentLength = isRangeRequest ? rangeRequest.contentLength : fileStats.size;

      // Prepare response headers
      const mimeType = getMimeType(filePath); // Use original file for MIME type
      const cacheControlValue = getCacheControl(filePath, cacheControl);

      const responseHeaders = new Headers({
        "Content-Type": mimeType,
        "Content-Length": String(contentLength),
        "Last-Modified": fileStats.mtime.toUTCString(),
        "Accept-Ranges": "bytes",
        ...(etagValue && { ETag: etagValue }),
        ...(contentEncoding && { "Content-Encoding": contentEncoding }),
        ...(cacheControlValue && { "Cache-Control": cacheControlValue }),
        ...(isRangeRequest && {
          "Content-Range": `bytes ${rangeRequest.start}-${rangeRequest.end}/${fileStats.size}`,
        }),
        ...headers,
      });

      // Use streaming for better memory efficiency (default)
      if (streaming) {
        let fileHandle: FileHandle;
        try {
          fileHandle = await open(finalFilePath, "r");
          const chunkSize = 64 * 1024; // 64KB chunks

          // Determine read boundaries
          const startPos = isRangeRequest ? rangeRequest.start : 0;
          const endPos = isRangeRequest ? rangeRequest.end : fileStats.size - 1;
          const totalToRead = endPos - startPos + 1;

          const webStream = new ReadableStream({
            async start(controller) {
              try {
                let position = startPos;
                let bytesRemaining = totalToRead;
                const buffer = new Uint8Array(chunkSize);

                while (bytesRemaining > 0) {
                  const bytesToRead = Math.min(chunkSize, bytesRemaining);
                  const { bytesRead } = await fileHandle.read(buffer, 0, bytesToRead, position);

                  if (bytesRead === 0) break;

                  // Only enqueue the actual bytes read, not the full buffer
                  controller.enqueue(buffer.slice(0, bytesRead));
                  position += bytesRead;
                  bytesRemaining -= bytesRead;
                }

                controller.close();
              } catch (error) {
                controller.error(error);
              } finally {
                await fileHandle.close();
              }
            },

            async cancel() {
              await fileHandle.close();
            },
          });

          return new Response(webStream, {
            status,
            headers: responseHeaders,
          });
        } catch {
          return new Response("Internal Server Error", { status: 500 });
        }
      } else {
        // Fallback to reading entire file into memory (not recommended for large files)
        try {
          const { readFile } = await import("node:fs/promises");

          if (isRangeRequest) {
            // For range requests, read only the requested portion
            const fileHandle = await open(finalFilePath, "r");
            const buffer = new Uint8Array(rangeRequest.contentLength);
            await fileHandle.read(buffer, 0, rangeRequest.contentLength, rangeRequest.start);
            await fileHandle.close();

            return new Response(buffer, {
              status,
              headers: responseHeaders,
            });
          } else {
            const fileContent = await readFile(finalFilePath);

            return new Response(fileContent, {
              status,
              headers: responseHeaders,
            });
          }
        } catch {
          return new Response("Internal Server Error", { status: 500 });
        }
      }
    } catch {
      return new Response("Internal Server Error", { status: 500 });
    }
  };
}

export default createFileServer;
