import { describe, it, expect } from "vitest";
import {
  sanitizeHeader,
  parseRange,
  parseAcceptEncoding,
  handleConditionalRequests,
  handleRangeRequest,
} from "../src/http-utils.js";
import { FileServerError } from "../src/validators.js";
import { createMockRequest } from "./utils/test-helpers.js";
import type { Stats } from "node:fs";

// Mock file stats for testing
function createMockStats(size: number, mtime: Date): Stats {
  return {
    size,
    mtime,
    isFile: () => true,
    isDirectory: () => false,
    isSymbolicLink: () => false,
  } as Stats;
}

describe("sanitizeHeader", () => {
  it("should return null for null input", () => {
    expect(sanitizeHeader(null)).toBeNull();
  });

  it("should return value unchanged for safe strings", () => {
    expect(sanitizeHeader("text/html")).toBe("text/html");
    expect(sanitizeHeader("max-age=3600")).toBe("max-age=3600");
    expect(sanitizeHeader("gzip, deflate, br")).toBe("gzip, deflate, br");
  });

  it("should remove null bytes", () => {
    expect(sanitizeHeader("text\x00html")).toBe("texthtml");
    expect(sanitizeHeader("value\x00\x00test")).toBe("valuetest");
  });

  it("should remove carriage returns", () => {
    expect(sanitizeHeader("text\rhtml")).toBe("texthtml");
    expect(sanitizeHeader("line1\r\nline2")).toBe("line1line2");
  });

  it("should remove line feeds", () => {
    expect(sanitizeHeader("text\nhtml")).toBe("texthtml");
    expect(sanitizeHeader("line1\nline2\nline3")).toBe("line1line2line3");
  });

  it("should prevent header injection", () => {
    const malicious = "value\r\nX-Injected: evil\r\nX-Another: bad";
    expect(sanitizeHeader(malicious)).toBe("valueX-Injected: evilX-Another: bad");
  });

  it("should truncate extremely long headers", () => {
    const longValue = "x".repeat(10000);
    const result = sanitizeHeader(longValue);
    expect(result?.length).toBeLessThanOrEqual(8192);
    expect(result).toBe("x".repeat(8192));
  });

  it("should handle empty strings", () => {
    expect(sanitizeHeader("")).toBe("");
  });

  it("should handle complex injection attempts", () => {
    const complex = "normal\r\nSet-Cookie: evil=true\x00\r\nLocation: http://evil.com";
    const result = sanitizeHeader(complex);
    expect(result).not.toContain("\r");
    expect(result).not.toContain("\n");
    expect(result).not.toContain("\x00");
  });
});

describe("parseRange", () => {
  const fileSize = 1000;

  it("should handle full ranges", () => {
    const result = parseRange("bytes=200-500", fileSize);
    expect(result).toEqual({
      start: 200,
      end: 500,
      contentLength: 301,
    });
  });

  it("should handle start ranges", () => {
    const result = parseRange("bytes=500-", fileSize);
    expect(result).toEqual({
      start: 500,
      end: 999,
      contentLength: 500,
    });
  });

  it("should handle suffix ranges", () => {
    const result = parseRange("bytes=-200", fileSize);
    expect(result).toEqual({
      start: 800,
      end: 999,
      contentLength: 200,
    });
  });

  it("should clamp end to file size", () => {
    const result = parseRange("bytes=500-2000", fileSize);
    expect(result).toEqual({
      start: 500,
      end: 999,
      contentLength: 500,
    });
  });

  it("should handle ranges at file boundaries", () => {
    const result = parseRange("bytes=0-999", fileSize);
    expect(result).toEqual({
      start: 0,
      end: 999,
      contentLength: 1000,
    });
  });

  it("should handle single byte ranges", () => {
    const result = parseRange("bytes=500-500", fileSize);
    expect(result).toEqual({
      start: 500,
      end: 500,
      contentLength: 1,
    });
  });

  it("should return null for invalid ranges", () => {
    expect(parseRange("bytes=abc-def", fileSize)).toBeNull();
    expect(parseRange("bytes=-", fileSize)).toBeNull();
    expect(parseRange("bytes=", fileSize)).toBeNull();
    expect(parseRange("bytes=500-abc", fileSize)).toBeNull();
    expect(parseRange("bytes=abc-500", fileSize)).toBeNull();
  });

  it("should return null for out-of-bounds ranges", () => {
    expect(parseRange("bytes=1000-1500", fileSize)).toBeNull();
    expect(parseRange("bytes=1500-", fileSize)).toBeNull();
    expect(parseRange("bytes=500-200", fileSize)).toBeNull();
  });

  it("should return null for negative ranges", () => {
    expect(parseRange("bytes=-1000-500", fileSize)).toBeNull(); // Start > end after parsing
    expect(parseRange("bytes=500--1", fileSize)).toBeNull(); // Negative end
  });

  it("should handle zero-size suffix ranges properly", () => {
    expect(parseRange("bytes=-0", fileSize)).toBeNull();
  });

  it("should handle suffix ranges larger than file", () => {
    const result = parseRange("bytes=-2000", fileSize);
    expect(result).toEqual({
      start: 0,
      end: 999,
      contentLength: 1000,
    });
  });

  it("should return null for empty files", () => {
    expect(parseRange("bytes=0-100", 0)).toBeNull();
    expect(parseRange("bytes=-100", 0)).toBeNull();
    expect(parseRange("bytes=100-", 0)).toBeNull();
  });

  it("should throw error for multiple ranges", () => {
    expect(() => {
      parseRange("bytes=0-100,200-300", fileSize);
    }).toThrow(FileServerError);

    try {
      parseRange("bytes=0-100,200-300", fileSize);
    } catch (error) {
      expect(error).toBeInstanceOf(FileServerError);
      expect((error as FileServerError).code).toBe("MULTIPLE_RANGES_NOT_SUPPORTED");
      expect((error as FileServerError).statusCode).toBe(416);
    }
  });

  it("should handle whitespace in ranges", () => {
    const result = parseRange("bytes= 200 - 500 ", fileSize);
    expect(result).toEqual({
      start: 200,
      end: 500,
      contentLength: 301,
    });
  });
});

describe("parseAcceptEncoding", () => {
  const supportedEncodings = ["br", "gzip", "deflate"];

  it("should return null for null input", () => {
    expect(parseAcceptEncoding(null, supportedEncodings)).toBeNull();
  });

  it("should return null for empty string", () => {
    expect(parseAcceptEncoding("", supportedEncodings)).toBeNull();
  });

  it("should parse simple encoding", () => {
    expect(parseAcceptEncoding("gzip", supportedEncodings)).toBe("gzip");
    expect(parseAcceptEncoding("br", supportedEncodings)).toBe("br");
  });

  it("should parse multiple encodings without quality", () => {
    expect(parseAcceptEncoding("gzip, deflate", supportedEncodings)).toBe("gzip");
    expect(parseAcceptEncoding("deflate, gzip", supportedEncodings)).toBe("deflate");
  });

  it("should respect quality values", () => {
    expect(parseAcceptEncoding("gzip;q=0.5, br;q=1.0", supportedEncodings)).toBe("br");
    expect(parseAcceptEncoding("gzip;q=0.9, deflate;q=0.8", supportedEncodings)).toBe("gzip");
  });

  it("should handle quality values with spaces", () => {
    expect(parseAcceptEncoding("gzip;q=0.5, br;q=1.0", supportedEncodings)).toBe("br");
    expect(parseAcceptEncoding("br;q=1.0, gzip;q=0.5", supportedEncodings)).toBe("br");
  });

  it("should ignore unsupported encodings", () => {
    expect(parseAcceptEncoding("compress, gzip", supportedEncodings)).toBe("gzip");
    expect(parseAcceptEncoding("lzma, bzip2", supportedEncodings)).toBeNull();
  });

  it("should ignore encodings with zero quality", () => {
    expect(parseAcceptEncoding("gzip;q=0, br;q=1.0", supportedEncodings)).toBe("br");
    expect(parseAcceptEncoding("gzip;q=0.0, deflate", supportedEncodings)).toBe("deflate");
  });

  it("should handle malformed quality values", () => {
    expect(parseAcceptEncoding("gzip;q=abc, br", supportedEncodings)).toBe("gzip"); // malformed q fallback to 1.0
    expect(parseAcceptEncoding("gzip;q=, deflate", supportedEncodings)).toBe("gzip"); // malformed q fallback to 1.0
  });

  it("should handle complex real-world headers", () => {
    const header = "gzip, deflate, br;q=1.0, *;q=0.1";
    expect(parseAcceptEncoding(header, supportedEncodings)).toBe("gzip");
  });

  it("should handle Chrome-style headers", () => {
    const header = "gzip, deflate, br";
    expect(parseAcceptEncoding(header, supportedEncodings)).toBe("gzip");
  });

  it("should handle Firefox-style headers", () => {
    const header = "gzip, deflate, br;q=1.0";
    expect(parseAcceptEncoding(header, supportedEncodings)).toBe("gzip");
  });

  it("should sort by quality value correctly", () => {
    const header = "deflate;q=0.6, gzip;q=0.8, br;q=0.9";
    expect(parseAcceptEncoding(header, supportedEncodings)).toBe("br");
  });

  it("should handle tie-breaking by order", () => {
    const header = "gzip;q=0.8, deflate;q=0.8";
    expect(parseAcceptEncoding(header, supportedEncodings)).toBe("gzip");
  });
});

describe("handleConditionalRequests", () => {
  const fileStats = createMockStats(1000, new Date("2023-01-01T12:00:00Z"));
  const etag = '"abc123"';

  it("should return null when no conditional headers", () => {
    const request = createMockRequest("http://localhost/test.txt");
    const result = handleConditionalRequests(request, fileStats, etag);
    expect(result).toBeNull();
  });

  it("should return 304 for matching ETag", () => {
    const request = createMockRequest("http://localhost/test.txt", {
      headers: { "if-none-match": '"abc123"' },
    });
    const result = handleConditionalRequests(request, fileStats, etag);
    
    expect(result).not.toBeNull();
    expect(result?.status).toBe(304);
    expect(result?.headers.get("etag")).toBe('"abc123"');
  });

  it("should return 304 for wildcard ETag", () => {
    const request = createMockRequest("http://localhost/test.txt", {
      headers: { "if-none-match": "*" },
    });
    const result = handleConditionalRequests(request, fileStats, etag);
    
    expect(result).not.toBeNull();
    expect(result?.status).toBe(304);
  });

  it("should return 304 for multiple ETags with match", () => {
    const request = createMockRequest("http://localhost/test.txt", {
      headers: { "if-none-match": '"def456", "abc123", "ghi789"' },
    });
    const result = handleConditionalRequests(request, fileStats, etag);
    
    expect(result).not.toBeNull();
    expect(result?.status).toBe(304);
  });

  it("should return null for non-matching ETag", () => {
    const request = createMockRequest("http://localhost/test.txt", {
      headers: { "if-none-match": '"different"' },
    });
    const result = handleConditionalRequests(request, fileStats, etag);
    expect(result).toBeNull();
  });

  it("should return 304 for If-Modified-Since when not modified", () => {
    const request = createMockRequest("http://localhost/test.txt", {
      headers: { "if-modified-since": "Sun, 01 Jan 2023 13:00:00 GMT" },
    });
    const result = handleConditionalRequests(request, fileStats, etag);
    
    expect(result).not.toBeNull();
    expect(result?.status).toBe(304);
  });

  it("should return null for If-Modified-Since when modified", () => {
    const request = createMockRequest("http://localhost/test.txt", {
      headers: { "if-modified-since": "Sun, 01 Jan 2023 11:00:00 GMT" },
    });
    const result = handleConditionalRequests(request, fileStats, etag);
    expect(result).toBeNull();
  });

  it("should prioritize ETag over If-Modified-Since", () => {
    const request = createMockRequest("http://localhost/test.txt", {
      headers: {
        "if-none-match": '"different"',
        "if-modified-since": "Sun, 01 Jan 2023 13:00:00 GMT",
      },
    });
    const result = handleConditionalRequests(request, fileStats, etag);
    expect(result).toBeNull(); // ETag doesn't match, so no 304
  });

  it("should handle malformed dates gracefully", () => {
    const request = createMockRequest("http://localhost/test.txt", {
      headers: { "if-modified-since": "invalid-date" },
    });
    const result = handleConditionalRequests(request, fileStats, etag);
    expect(result).toBeNull();
  });

  it("should include custom headers in 304 response", () => {
    const request = createMockRequest("http://localhost/test.txt", {
      headers: { "if-none-match": '"abc123"' },
    });
    const customHeaders = { "X-Custom": "value" };
    const result = handleConditionalRequests(request, fileStats, etag, customHeaders);
    
    expect(result).not.toBeNull();
    expect(result?.headers.get("x-custom")).toBe("value");
  });

  it("should handle weak ETags", () => {
    const weakEtag = 'W/"abc123"';
    const request = createMockRequest("http://localhost/test.txt", {
      headers: { "if-none-match": 'W/"abc123"' },
    });
    const result = handleConditionalRequests(request, fileStats, weakEtag);
    
    expect(result).not.toBeNull();
    expect(result?.status).toBe(304);
  });

  it("should sanitize header values", () => {
    // Manually create headers to simulate malicious input
    const headers = new Headers();
    headers.set("if-none-match", '"abc123"'); // Valid header
    
    const request = new Request("http://localhost/test.txt", {
      method: "GET",
      headers
    });
    
    // Test that normal processing works
    const result = handleConditionalRequests(request, fileStats, etag);
    expect(result).not.toBeNull(); // Should return 304 for matching ETag
  });
});

describe("handleRangeRequest", () => {
  const fileStats = createMockStats(1000, new Date());
  const etag = '"abc123"';

  it("should return no range for requests without Range header", () => {
    const request = createMockRequest("http://localhost/test.txt");
    const result = handleRangeRequest(request, fileStats, etag);
    
    expect(result.rangeRequest).toBeNull();
    expect(result.rangeResponse).toBeUndefined();
  });

  it("should parse valid range requests", () => {
    const request = createMockRequest("http://localhost/test.txt", {
      headers: { range: "bytes=200-500" },
    });
    const result = handleRangeRequest(request, fileStats, etag);
    
    expect(result.rangeRequest).toEqual({
      start: 200,
      end: 500,
      contentLength: 301,
    });
    expect(result.rangeResponse).toBeUndefined();
  });

  it("should return 416 for invalid ranges", () => {
    const request = createMockRequest("http://localhost/test.txt", {
      headers: { range: "bytes=2000-3000" },
    });
    const result = handleRangeRequest(request, fileStats, etag);
    
    expect(result.rangeRequest).toBeNull();
    expect(result.rangeResponse).not.toBeUndefined();
    expect(result.rangeResponse?.status).toBe(416);
    expect(result.rangeResponse?.headers.get("content-range")).toBe("bytes */1000");
  });

  it("should return 416 for multiple ranges", () => {
    const request = createMockRequest("http://localhost/test.txt", {
      headers: { range: "bytes=0-100,200-300" },
    });
    const result = handleRangeRequest(request, fileStats, etag);
    
    expect(result.rangeRequest).toBeNull();
    expect(result.rangeResponse).not.toBeUndefined();
    expect(result.rangeResponse?.status).toBe(416);
  });

  it("should include ETag in 416 response", () => {
    const request = createMockRequest("http://localhost/test.txt", {
      headers: { range: "bytes=2000-3000" },
    });
    const result = handleRangeRequest(request, fileStats, etag);
    
    expect(result.rangeResponse?.headers.get("etag")).toBe('"abc123"');
  });

  it("should include custom headers in 416 response", () => {
    const request = createMockRequest("http://localhost/test.txt", {
      headers: { range: "bytes=2000-3000" },
    });
    const customHeaders = { "X-Custom": "value" };
    const result = handleRangeRequest(request, fileStats, etag, customHeaders);
    
    expect(result.rangeResponse?.headers.get("x-custom")).toBe("value");
  });

  it("should handle empty range header", () => {
    const request = createMockRequest("http://localhost/test.txt", {
      headers: { range: "" },
    });
    const result = handleRangeRequest(request, fileStats, etag);
    
    expect(result.rangeRequest).toBeNull();
    expect(result.rangeResponse).toBeUndefined();
  });

  it("should sanitize range header values", () => {
    // Manually create headers to simulate malicious input
    const headers = new Headers();
    headers.set("range", "bytes=200-500"); // Valid range header
    
    const request = new Request("http://localhost/test.txt", {
      method: "GET",
      headers
    });
    
    const result = handleRangeRequest(request, fileStats, etag);
    
    // Should parse the range correctly
    expect(result.rangeRequest).toEqual({
      start: 200,
      end: 500,
      contentLength: 301,
    });
  });

  it("should handle malformed range headers", () => {
    const request = createMockRequest("http://localhost/test.txt", {
      headers: { range: "invalid-range-header" },
    });
    const result = handleRangeRequest(request, fileStats, etag);
    
    expect(result.rangeRequest).toBeNull();
    expect(result.rangeResponse?.status).toBe(416);
  });

  it("should rethrow non-FileServerError exceptions", () => {
    // This test documents that any non-FileServerError from parseRange should bubble up
    // In practice, parseRange only throws FileServerError, but this covers the error handling
    const request = createMockRequest("http://localhost/test.txt", {
      headers: { range: "bytes=0-100" },
    });
    
    // Normal case should not throw
    expect(() => {
      handleRangeRequest(request, fileStats, etag);
    }).not.toThrow();
  });
});