import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createStreamingResponse, createBufferedResponse } from "../src/response.js";
import { TestFileSystem, TEST_CONTENT } from "./utils/test-helpers.js";
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

// Helper to read response body as text
async function readResponseBody(response: Response): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const combined = new Uint8Array(totalLength);
  let offset = 0;
  
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }
  
  return new TextDecoder().decode(combined);
}

// Helper to read response body as bytes
async function readResponseBytes(response: Response): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const combined = new Uint8Array(totalLength);
  let offset = 0;
  
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }
  
  return combined;
}

describe("createStreamingResponse", () => {
  let testFs: TestFileSystem;

  beforeEach(async () => {
    testFs = await TestFileSystem.create();
  });

  afterEach(() => {
    testFs.cleanup();
  });

  it("should stream entire file without range request", async () => {
    const content = TEST_CONTENT.TEXT;
    const filePath = await testFs.createFile("test.txt", content);
    const stats = createMockStats(content.length, new Date());
    const headers = new Headers({ "Content-Type": "text/plain" });

    const response = await createStreamingResponse(
      filePath,
      null, // No range request
      stats,
      false, // Not HEAD request
      200,
      headers
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/plain");
    
    const body = await readResponseBody(response);
    expect(body).toBe(content);
  });

  it("should stream partial file with range request", async () => {
    const content = TEST_CONTENT.TEXT; // "This is a plain text file for testing purposes."
    const filePath = await testFs.createFile("test.txt", content);
    const stats = createMockStats(content.length, new Date());
    const headers = new Headers({ "Content-Type": "text/plain" });

    const rangeRequest = {
      start: 5,
      end: 14,
      contentLength: 10,
    };

    const response = await createStreamingResponse(
      filePath,
      rangeRequest,
      stats,
      false,
      206,
      headers
    );

    expect(response.status).toBe(206);
    
    const body = await readResponseBody(response);
    expect(body).toBe(content.slice(5, 15)); // "is a plai"
  });

  it("should return empty body for HEAD requests", async () => {
    const content = TEST_CONTENT.HTML;
    const filePath = await testFs.createFile("index.html", content);
    const stats = createMockStats(content.length, new Date());
    const headers = new Headers({ "Content-Type": "text/html" });

    const response = await createStreamingResponse(
      filePath,
      null,
      stats,
      true, // HEAD request
      200,
      headers
    );

    expect(response.status).toBe(200);
    expect(response.body).toBeNull();
  });

  it("should handle large files efficiently", async () => {
    const content = TEST_CONTENT.LARGE; // 1MB content
    const filePath = await testFs.createFile("large.txt", content);
    const stats = createMockStats(content.length, new Date());
    const headers = new Headers({ "Content-Type": "text/plain" });

    const response = await createStreamingResponse(
      filePath,
      null,
      stats,
      false,
      200,
      headers
    );

    expect(response.status).toBe(200);
    
    const body = await readResponseBody(response);
    expect(body).toBe(content);
    expect(body.length).toBe(1024 * 1024);
  });

  it("should handle binary files", async () => {
    const content = TEST_CONTENT.BINARY; // PNG signature bytes
    const filePath = await testFs.createFile("image.png", content);
    const stats = createMockStats(content.length, new Date());
    const headers = new Headers({ "Content-Type": "image/png" });

    const response = await createStreamingResponse(
      filePath,
      null,
      stats,
      false,
      200,
      headers
    );

    expect(response.status).toBe(200);
    
    const body = await readResponseBytes(response);
    expect(body).toEqual(content);
  });

  it("should handle empty files", async () => {
    const content = TEST_CONTENT.EMPTY;
    const filePath = await testFs.createFile("empty.txt", content);
    const stats = createMockStats(0, new Date());
    const headers = new Headers({ "Content-Type": "text/plain" });

    const response = await createStreamingResponse(
      filePath,
      null,
      stats,
      false,
      200,
      headers
    );

    expect(response.status).toBe(200);
    
    const body = await readResponseBody(response);
    expect(body).toBe("");
  });

  it("should handle range request at file boundaries", async () => {
    const content = "0123456789"; // 10 characters
    const filePath = await testFs.createFile("numbers.txt", content);
    const stats = createMockStats(content.length, new Date());
    const headers = new Headers({ "Content-Type": "text/plain" });

    // Request last byte
    const rangeRequest = {
      start: 9,
      end: 9,
      contentLength: 1,
    };

    const response = await createStreamingResponse(
      filePath,
      rangeRequest,
      stats,
      false,
      206,
      headers
    );

    expect(response.status).toBe(206);
    
    const body = await readResponseBody(response);
    expect(body).toBe("9");
  });

  it("should handle range request for first byte", async () => {
    const content = "0123456789";
    const filePath = await testFs.createFile("numbers.txt", content);
    const stats = createMockStats(content.length, new Date());
    const headers = new Headers({ "Content-Type": "text/plain" });

    // Request first byte
    const rangeRequest = {
      start: 0,
      end: 0,
      contentLength: 1,
    };

    const response = await createStreamingResponse(
      filePath,
      rangeRequest,
      stats,
      false,
      206,
      headers
    );

    expect(response.status).toBe(206);
    
    const body = await readResponseBody(response);
    expect(body).toBe("0");
  });

  it("should preserve all headers", async () => {
    const content = TEST_CONTENT.JSON;
    const filePath = await testFs.createFile("data.json", content);
    const stats = createMockStats(content.length, new Date());
    const headers = new Headers({
      "Content-Type": "application/json",
      "Cache-Control": "max-age=3600",
      "ETag": '"abc123"',
      "X-Custom": "value",
    });

    const response = await createStreamingResponse(
      filePath,
      null,
      stats,
      false,
      200,
      headers
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(response.headers.get("cache-control")).toBe("max-age=3600");
    expect(response.headers.get("etag")).toBe('"abc123"');
    expect(response.headers.get("x-custom")).toBe("value");
  });

  it("should handle file read errors gracefully", async () => {
    // Test with non-existent file
    const stats = createMockStats(100, new Date());
    const headers = new Headers({ "Content-Type": "text/plain" });

    await expect(
      createStreamingResponse(
        "/non/existent/file.txt",
        null,
        stats,
        false,
        200,
        headers
      )
    ).rejects.toThrow();
  });

  it("should handle partial reads correctly", async () => {
    const content = "A".repeat(1000); // 1000 'A' characters
    const filePath = await testFs.createFile("repeated.txt", content);
    const stats = createMockStats(content.length, new Date());
    const headers = new Headers({ "Content-Type": "text/plain" });

    // Request middle portion
    const rangeRequest = {
      start: 100,
      end: 199,
      contentLength: 100,
    };

    const response = await createStreamingResponse(
      filePath,
      rangeRequest,
      stats,
      false,
      206,
      headers
    );

    const body = await readResponseBody(response);
    expect(body).toBe("A".repeat(100));
    expect(body.length).toBe(100);
  });
});

describe("createBufferedResponse", () => {
  let testFs: TestFileSystem;

  beforeEach(async () => {
    testFs = await TestFileSystem.create();
  });

  afterEach(() => {
    testFs.cleanup();
  });

  it("should read entire file into buffer without range request", async () => {
    const content = TEST_CONTENT.TEXT;
    const filePath = await testFs.createFile("test.txt", content);
    const headers = new Headers({ "Content-Type": "text/plain" });

    const response = await createBufferedResponse(
      filePath,
      null, // No range request
      false, // Not HEAD request
      200,
      headers
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/plain");
    
    const body = await response.text();
    expect(body).toBe(content);
  });

  it("should read partial file with range request", async () => {
    const content = TEST_CONTENT.TEXT;
    const filePath = await testFs.createFile("test.txt", content);
    const headers = new Headers({ "Content-Type": "text/plain" });

    const rangeRequest = {
      start: 5,
      end: 14,
      contentLength: 10,
    };

    const response = await createBufferedResponse(
      filePath,
      rangeRequest,
      false,
      206,
      headers
    );

    expect(response.status).toBe(206);
    
    const body = await response.text();
    expect(body).toBe(content.slice(5, 15));
  });

  it("should return empty body for HEAD requests", async () => {
    const content = TEST_CONTENT.HTML;
    const filePath = await testFs.createFile("index.html", content);
    const headers = new Headers({ "Content-Type": "text/html" });

    const response = await createBufferedResponse(
      filePath,
      null,
      true, // HEAD request
      200,
      headers
    );

    expect(response.status).toBe(200);
    expect(response.body).toBeNull();
  });

  it("should handle binary files", async () => {
    const content = TEST_CONTENT.BINARY;
    const filePath = await testFs.createFile("image.png", content);
    const headers = new Headers({ "Content-Type": "image/png" });

    const response = await createBufferedResponse(
      filePath,
      null,
      false,
      200,
      headers
    );

    expect(response.status).toBe(200);
    
    const body = await response.arrayBuffer();
    expect(new Uint8Array(body)).toEqual(content);
  });

  it("should handle empty files", async () => {
    const content = TEST_CONTENT.EMPTY;
    const filePath = await testFs.createFile("empty.txt", content);
    const headers = new Headers({ "Content-Type": "text/plain" });

    const response = await createBufferedResponse(
      filePath,
      null,
      false,
      200,
      headers
    );

    expect(response.status).toBe(200);
    
    const body = await response.text();
    expect(body).toBe("");
  });

  it("should handle large files", async () => {
    const content = TEST_CONTENT.LARGE; // 1MB content
    const filePath = await testFs.createFile("large.txt", content);
    const headers = new Headers({ "Content-Type": "text/plain" });

    const response = await createBufferedResponse(
      filePath,
      null,
      false,
      200,
      headers
    );

    expect(response.status).toBe(200);
    
    const body = await response.text();
    expect(body).toBe(content);
    expect(body.length).toBe(1024 * 1024);
  });

  it("should handle range request at file boundaries", async () => {
    const content = "0123456789";
    const filePath = await testFs.createFile("numbers.txt", content);
    const headers = new Headers({ "Content-Type": "text/plain" });

    // Request last byte
    const rangeRequest = {
      start: 9,
      end: 9,
      contentLength: 1,
    };

    const response = await createBufferedResponse(
      filePath,
      rangeRequest,
      false,
      206,
      headers
    );

    expect(response.status).toBe(206);
    
    const body = await response.text();
    expect(body).toBe("9");
  });

  it("should handle range request for first byte", async () => {
    const content = "0123456789";
    const filePath = await testFs.createFile("numbers.txt", content);
    const headers = new Headers({ "Content-Type": "text/plain" });

    // Request first byte
    const rangeRequest = {
      start: 0,
      end: 0,
      contentLength: 1,
    };

    const response = await createBufferedResponse(
      filePath,
      rangeRequest,
      false,
      206,
      headers
    );

    expect(response.status).toBe(206);
    
    const body = await response.text();
    expect(body).toBe("0");
  });

  it("should preserve all headers", async () => {
    const content = TEST_CONTENT.JSON;
    const filePath = await testFs.createFile("data.json", content);
    const headers = new Headers({
      "Content-Type": "application/json",
      "Cache-Control": "max-age=3600",
      "ETag": '"abc123"',
      "X-Custom": "value",
    });

    const response = await createBufferedResponse(
      filePath,
      null,
      false,
      200,
      headers
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(response.headers.get("cache-control")).toBe("max-age=3600");
    expect(response.headers.get("etag")).toBe('"abc123"');
    expect(response.headers.get("x-custom")).toBe("value");
  });

  it("should handle file read errors gracefully", async () => {
    const headers = new Headers({ "Content-Type": "text/plain" });

    await expect(
      createBufferedResponse(
        "/non/existent/file.txt",
        null,
        false,
        200,
        headers
      )
    ).rejects.toThrow();
  });

  it("should handle range requests larger than file", async () => {
    const content = "small";
    const filePath = await testFs.createFile("small.txt", content);
    const headers = new Headers({ "Content-Type": "text/plain" });

    // Request more than available
    const rangeRequest = {
      start: 0,
      end: 9,
      contentLength: 5, // Should be clamped to actual content length
    };

    const response = await createBufferedResponse(
      filePath,
      rangeRequest,
      false,
      206,
      headers
    );

    expect(response.status).toBe(206);
    
    const body = await response.text();
    expect(body).toBe(content);
  });

  it("should handle concurrent access to same file", async () => {
    const content = TEST_CONTENT.TEXT;
    const filePath = await testFs.createFile("concurrent.txt", content);
    const headers = new Headers({ "Content-Type": "text/plain" });

    // Create multiple concurrent buffered responses
    const promises = Array.from({ length: 10 }, () =>
      createBufferedResponse(filePath, null, false, 200, headers)
    );

    const responses = await Promise.all(promises);

    for (const response of responses) {
      expect(response.status).toBe(200);
      const body = await response.text();
      expect(body).toBe(content);
    }
  });

  it("should handle different range requests on same file", async () => {
    const content = "0123456789ABCDEF";
    const filePath = await testFs.createFile("hex.txt", content);
    const headers = new Headers({ "Content-Type": "text/plain" });

    const ranges = [
      { start: 0, end: 4, contentLength: 5 },   // "01234"
      { start: 5, end: 9, contentLength: 5 },   // "56789"
      { start: 10, end: 15, contentLength: 6 }, // "ABCDEF"
    ];

    const promises = ranges.map(range =>
      createBufferedResponse(filePath, range, false, 206, headers)
    );

    const responses = await Promise.all(promises);
    const bodies = await Promise.all(responses.map(r => r.text()));

    expect(bodies[0]).toBe("01234");
    expect(bodies[1]).toBe("56789");
    expect(bodies[2]).toBe("ABCDEF");
  });
});