import type { Stats } from "node:fs";
import { FileServerError } from "./validators.js";

/**
 * Sanitizes HTTP header values to prevent injection attacks.
 * 
 * Removes dangerous characters (null bytes, CRLF) and enforces
 * length limits to prevent header injection and DoS attacks.
 * 
 * @param value - The raw header value to sanitize
 * @returns Sanitized header value, or null if input was null
 * 
 * @example
 * ```typescript
 * const clean = sanitizeHeader('value\r\nX-Injected: evil');
 * // Returns 'valueX-Injected: evil' (CRLF removed)
 * ```
 */
export function sanitizeHeader(value: string | null): string | null {
  if (!value) return null;

  // Remove any null bytes, carriage returns, and line feeds to prevent header injection
  const sanitized = value.replaceAll("\x00", "").replaceAll("\r", "").replaceAll("\n", "");

  // Limit header length to prevent DoS
  const maxHeaderLength = 8192; // 8KB limit
  if (sanitized.length > maxHeaderLength) {
    return sanitized.substring(0, maxHeaderLength);
  }

  return sanitized;
}

/**
 * Parses HTTP Range header for partial content requests.
 * 
 * Supports various range formats: suffix ranges (-500), start ranges (500-),
 * and full ranges (500-1000). Validates ranges against file size.
 * 
 * @param rangeHeader - The Range header value (without 'bytes=' prefix)
 * @param fileSize - The total size of the file being requested
 * @returns Parsed range information, or null if invalid
 * @throws {FileServerError} When multiple ranges are requested (not supported)
 * 
 * @example
 * ```typescript
 * parseRange('500-1000', 2000); // Returns { start: 500, end: 1000, contentLength: 501 }
 * parseRange('-500', 2000);     // Returns { start: 1500, end: 1999, contentLength: 500 }
 * parseRange('500-', 2000);     // Returns { start: 500, end: 1999, contentLength: 1500 }
 * ```
 */
export function parseRange(
  rangeHeader: string,
  fileSize: number,
): { start: number; end: number; contentLength: number } | null {
  // Handle empty files
  if (fileSize === 0) {
    return null; // No valid ranges for empty files
  }

  const ranges = rangeHeader.replace(/bytes=/, "").split(",");

  // Check for multiple ranges - not supported
  if (ranges.length > 1) {
    throw new FileServerError(
      "MULTIPLE_RANGES_NOT_SUPPORTED",
      "Multiple ranges are not supported. Please request one range at a time.",
      416,
      undefined,
      "range_parsing",
    );
  }

  const range = ranges[0]?.trim();
  if (!range) return null;

  const [startStr, endStr] = range.split("-");

  let start: number;
  let end: number;

  if (startStr === "" && endStr !== "") {
    // Suffix range: -500 (last 500 bytes)
    const suffixLength = parseInt(endStr, 10);
    if (Number.isNaN(suffixLength) || suffixLength <= 0) {
      return null;
    }
    start = Math.max(0, fileSize - suffixLength);
    end = fileSize - 1;
  } else if (startStr !== "" && endStr === "") {
    // Start range: 500- (from byte 500 to end)
    start = parseInt(startStr, 10);
    if (Number.isNaN(start) || start < 0) {
      return null;
    }
    end = fileSize - 1;
  } else if (startStr !== "" && endStr !== "") {
    // Full range: 500-1000
    start = parseInt(startStr, 10);
    end = parseInt(endStr, 10);
    if (Number.isNaN(start) || Number.isNaN(end) || start < 0 || end < 0) {
      return null;
    }
  } else {
    // Invalid range format (both empty)
    return null;
  }

  // Validate range bounds
  if (start >= fileSize || start > end) {
    return null;
  }

  // Clamp end to file size
  end = Math.min(end, fileSize - 1);

  return {
    start,
    end,
    contentLength: end - start + 1,
  };
}

/**
 * Parses Accept-Encoding header to find the best supported compression.
 * 
 * Respects quality values (q-values) in the Accept-Encoding header
 * and returns the highest-quality encoding that the server supports.
 * 
 * @param acceptEncoding - The Accept-Encoding header value from the client
 * @param supportedEncodings - List of compression algorithms the server supports
 * @returns The best matching encoding, or null if none supported
 * 
 * @example
 * ```typescript
 * parseAcceptEncoding('gzip;q=0.8, br;q=1.0', ['gzip', 'br']);
 * // Returns 'br' (highest quality)
 * 
 * parseAcceptEncoding('deflate, gzip', ['gzip']);
 * // Returns 'gzip' (first supported)
 * ```
 */
export function parseAcceptEncoding(
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
 * Handles conditional HTTP requests for efficient caching.
 * 
 * Processes If-None-Match (ETag) and If-Modified-Since headers
 * to return 304 Not Modified responses when appropriate.
 * 
 * @param request - The HTTP request containing conditional headers
 * @param fileStats - File statistics containing modification time
 * @param etagValue - The ETag value for the file, if available
 * @param headers - Additional headers to include in 304 responses
 * @returns 304 Response if conditions match, null to serve full content
 * 
 * @example
 * ```typescript
 * const response = handleConditionalRequests(request, stats, '"abc123"');
 * if (response) {
 *   return response; // 304 Not Modified
 * }
 * // Continue with full file serving
 * ```
 */
export function handleConditionalRequests(
  request: Request,
  fileStats: Stats,
  etagValue?: string,
  headers: Record<string, string> = {},
): Response | null {
  const ifNoneMatch = sanitizeHeader(request.headers.get("if-none-match"));
  const ifModifiedSince = sanitizeHeader(request.headers.get("if-modified-since"));

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

  return null;
}

/**
 * Handles HTTP Range requests for partial content delivery.
 * 
 * Processes Range headers and returns appropriate responses for
 * partial content requests, including error responses for invalid ranges.
 * 
 * @param request - The HTTP request potentially containing a Range header
 * @param fileStats - File statistics containing file size
 * @param etagValue - The ETag value for the file, if available
 * @param headers - Additional headers to include in error responses
 * @returns Object containing parsed range info and optional error response
 * 
 * @example
 * ```typescript
 * const { rangeRequest, rangeResponse } = handleRangeRequest(request, stats);
 * if (rangeResponse) {
 *   return rangeResponse; // Error response (416, etc.)
 * }
 * if (rangeRequest) {
 *   // Serve partial content
 * }
 * ```
 */
export function handleRangeRequest(
  request: Request,
  fileStats: Stats,
  etagValue?: string,
  headers: Record<string, string> = {},
): { rangeRequest: ReturnType<typeof parseRange>; rangeResponse?: Response } {
  const rangeHeader = sanitizeHeader(request.headers.get("range"));
  let rangeRequest: ReturnType<typeof parseRange> = null;

  if (!rangeHeader) {
    return { rangeRequest };
  }

  try {
    rangeRequest = parseRange(rangeHeader, fileStats.size);
  } catch (error) {
    if (error instanceof FileServerError && error.code === "MULTIPLE_RANGES_NOT_SUPPORTED") {
      return {
        rangeRequest: null,
        rangeResponse: new Response(error.message, { status: error.statusCode }),
      };
    }
    throw error;
  }

  // If range is invalid, return 416 Range Not Satisfiable
  if (!rangeRequest) {
    return {
      rangeRequest: null,
      rangeResponse: new Response("Range Not Satisfiable", {
        status: 416,
        headers: {
          "Content-Range": `bytes */${fileStats.size}`,
          ...(etagValue && { ETag: etagValue }),
          ...headers,
        },
      }),
    };
  }

  return { rangeRequest };
}
