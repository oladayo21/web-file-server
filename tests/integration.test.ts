import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createFileServer, FileServerError } from "../src/index.js";
import { TestFileSystem, createMockRequest, getResponseDetails, TEST_CONTENT, createTestFiles } from "./utils/test-helpers.js";

describe("createFileServer integration tests", () => {
  let testFs: TestFileSystem;
  let fileServerHandler: ReturnType<typeof createFileServer>;

  beforeEach(async () => {
    testFs = await TestFileSystem.create();
    await createTestFiles(testFs);
    
    fileServerHandler = createFileServer({
      root: testFs.rootPath,
      index: ["index.html", "index.htm"],
      dotfiles: "deny",
      streaming: true,
      etag: true,
      compression: ["br", "gzip"],
      precompressed: true,
      cacheControl: {
        "\\.js$": "max-age=3600",
        "\\.css$": "max-age=86400",
        "\\.html$": "max-age=1800",
      },
    });
  });

  afterEach(() => {
    testFs.cleanup();
  });

  describe("basic file serving", () => {
    it("should serve static files with correct content type", async () => {
      const request = createMockRequest("http://localhost/readme.txt");
      const response = await fileServerHandler(request);

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("text/plain");
      expect(response.headers.get("content-length")).toBe(String(TEST_CONTENT.TEXT.length));
      
      const content = await response.text();
      expect(content).toBe(TEST_CONTENT.TEXT);
    });

    it("should serve HTML files with correct headers", async () => {
      const request = createMockRequest("http://localhost/index.html");
      const response = await fileServerHandler(request);

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("text/html");
      expect(response.headers.get("cache-control")).toBe("max-age=1800");
      expect(response.headers.get("etag")).toBeDefined();
      expect(response.headers.get("last-modified")).toBeDefined();
      
      const content = await response.text();
      expect(content).toBe(TEST_CONTENT.HTML);
    });

    it("should serve CSS files with long cache", async () => {
      const request = createMockRequest("http://localhost/assets/style.css");
      const response = await fileServerHandler(request);

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("text/css");
      expect(response.headers.get("cache-control")).toBe("max-age=86400");
    });

    it("should serve JavaScript files with cache control", async () => {
      const request = createMockRequest("http://localhost/assets/app.js");
      const response = await fileServerHandler(request);

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("text/javascript");
      expect(response.headers.get("cache-control")).toBe("max-age=3600");
    });

    it("should serve JSON files", async () => {
      const request = createMockRequest("http://localhost/api/data.json");
      const response = await fileServerHandler(request);

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("application/json");
      
      const content = await response.text();
      expect(content).toBe(TEST_CONTENT.JSON);
    });

    it("should serve binary files", async () => {
      const request = createMockRequest("http://localhost/images/image.png");
      const response = await fileServerHandler(request);

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("image/png");
      
      const content = await response.arrayBuffer();
      expect(new Uint8Array(content)).toEqual(TEST_CONTENT.BINARY);
    });
  });

  describe("directory index serving", () => {
    it("should serve index.html for root directory", async () => {
      const request = createMockRequest("http://localhost/");
      const response = await fileServerHandler(request);

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("text/html");
      
      const content = await response.text();
      expect(content).toBe(TEST_CONTENT.HTML);
    });

    it("should return 404 for directories without index files", async () => {
      const request = createMockRequest("http://localhost/images/");
      const response = await fileServerHandler(request);

      expect(response.status).toBe(404);
    });
  });

  describe("HTTP method handling", () => {
    it("should handle HEAD requests correctly", async () => {
      const request = createMockRequest("http://localhost/readme.txt", { method: "HEAD" });
      const response = await fileServerHandler(request);

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("text/plain");
      expect(response.headers.get("content-length")).toBe(String(TEST_CONTENT.TEXT.length));
      expect(response.body).toBeNull();
    });

    it("should reject POST requests", async () => {
      const request = createMockRequest("http://localhost/readme.txt", { method: "POST" });
      const response = await fileServerHandler(request);

      expect(response.status).toBe(405);
      expect(response.headers.get("allow")).toBe("GET, HEAD");
    });

    it("should reject PUT requests", async () => {
      const request = createMockRequest("http://localhost/readme.txt", { method: "PUT" });
      const response = await fileServerHandler(request);

      expect(response.status).toBe(405);
    });

    it("should reject DELETE requests", async () => {
      const request = createMockRequest("http://localhost/readme.txt", { method: "DELETE" });
      const response = await fileServerHandler(request);

      expect(response.status).toBe(405);
    });
  });

  describe("dotfile handling", () => {
    it("should deny dotfiles when policy is deny", async () => {
      const request = createMockRequest("http://localhost/.env");
      const response = await fileServerHandler(request);

      expect(response.status).toBe(404);
    });

    it("should deny files in dotfile directories", async () => {
      await testFs.createDirectory(".hidden");
      await testFs.createFile(".hidden/secret.txt", "secret content");

      const request = createMockRequest("http://localhost/.hidden/secret.txt");
      const response = await fileServerHandler(request);

      expect(response.status).toBe(404);
    });
  });

  describe("error handling", () => {
    it("should return 404 for non-existent files", async () => {
      const request = createMockRequest("http://localhost/nonexistent.txt");
      const response = await fileServerHandler(request);

      expect(response.status).toBe(404);
    });

    it("should return 403 for path traversal attempts", async () => {
      // Use URL encoding to bypass URL normalization
      const request = createMockRequest("http://localhost/test%2F..%2F..%2F..%2Fetc%2Fpasswd");
      const response = await fileServerHandler(request);

      expect(response.status).toBe(403);
    });

    it("should handle URL encoding in paths", async () => {
      const request = createMockRequest("http://localhost/readme%2Etxt");
      const response = await fileServerHandler(request);

      expect(response.status).toBe(200);
      const content = await response.text();
      expect(content).toBe(TEST_CONTENT.TEXT);
    });
  });

  describe("compression support", () => {
    it("should serve compressed files when available", async () => {
      const request = createMockRequest("http://localhost/assets/app.js", {
        headers: { "accept-encoding": "gzip, br" },
      });
      const response = await fileServerHandler(request);

      expect(response.status).toBe(200);
      expect(response.headers.get("content-encoding")).toBe("gzip");
      expect(response.headers.get("content-type")).toBe("text/javascript");
    });

    it("should serve brotli when preferred", async () => {
      const request = createMockRequest("http://localhost/assets/app.js", {
        headers: { "accept-encoding": "br" },
      });
      const response = await fileServerHandler(request);

      expect(response.status).toBe(200);
      expect(response.headers.get("content-encoding")).toBe("br");
    });

    it("should serve original file when no compression available", async () => {
      const request = createMockRequest("http://localhost/readme.txt", {
        headers: { "accept-encoding": "gzip, br" },
      });
      const response = await fileServerHandler(request);

      expect(response.status).toBe(200);
      expect(response.headers.get("content-encoding")).toBeNull();
    });
  });

  describe("conditional requests", () => {
    it("should return 304 for matching ETag", async () => {
      // First request to get ETag
      const firstRequest = createMockRequest("http://localhost/readme.txt");
      const firstResponse = await fileServerHandler(firstRequest);
      const etag = firstResponse.headers.get("etag");

      // Second request with If-None-Match
      const secondRequest = createMockRequest("http://localhost/readme.txt", {
        headers: { "if-none-match": etag! },
      });
      const secondResponse = await fileServerHandler(secondRequest);

      expect(secondResponse.status).toBe(304);
      expect(secondResponse.headers.get("etag")).toBe(etag);
    });

    it("should return 304 for If-Modified-Since", async () => {
      // First request to get Last-Modified
      const firstRequest = createMockRequest("http://localhost/readme.txt");
      const firstResponse = await fileServerHandler(firstRequest);
      const lastModified = firstResponse.headers.get("last-modified");

      // Second request with If-Modified-Since
      const futureDate = new Date(Date.now() + 86400000).toUTCString(); // 1 day in future
      const secondRequest = createMockRequest("http://localhost/readme.txt", {
        headers: { "if-modified-since": futureDate },
      });
      const secondResponse = await fileServerHandler(secondRequest);

      expect(secondResponse.status).toBe(304);
    });
  });

  describe("range requests", () => {
    it("should handle partial content requests", async () => {
      const request = createMockRequest("http://localhost/readme.txt", {
        headers: { range: "bytes=0-10" },
      });
      const response = await fileServerHandler(request);

      expect(response.status).toBe(206);
      expect(response.headers.get("content-range")).toMatch(/^bytes 0-10\/\d+$/);
      expect(response.headers.get("accept-ranges")).toBe("bytes");
      
      const content = await response.text();
      expect(content).toBe(TEST_CONTENT.TEXT.slice(0, 11));
    });

    it("should handle suffix range requests", async () => {
      const request = createMockRequest("http://localhost/readme.txt", {
        headers: { range: "bytes=-10" },
      });
      const response = await fileServerHandler(request);

      expect(response.status).toBe(206);
      
      const content = await response.text();
      expect(content).toBe(TEST_CONTENT.TEXT.slice(-10));
    });

    it("should return 416 for invalid ranges", async () => {
      const request = createMockRequest("http://localhost/readme.txt", {
        headers: { range: "bytes=1000-2000" }, // Beyond file size
      });
      const response = await fileServerHandler(request);

      expect(response.status).toBe(416);
      expect(response.headers.get("content-range")).toMatch(/^bytes \*\/\d+$/);
    });
  });

  describe("large file handling", () => {
    it("should handle large files efficiently", async () => {
      const request = createMockRequest("http://localhost/large.txt");
      const response = await fileServerHandler(request);

      expect(response.status).toBe(200);
      expect(response.headers.get("content-length")).toBe(String(TEST_CONTENT.LARGE.length));
      
      const content = await response.text();
      expect(content).toBe(TEST_CONTENT.LARGE);
    });

    it("should handle range requests on large files", async () => {
      const request = createMockRequest("http://localhost/large.txt", {
        headers: { range: "bytes=1000-2000" },
      });
      const response = await fileServerHandler(request);

      expect(response.status).toBe(206);
      expect(response.headers.get("content-length")).toBe("1001");
      
      const content = await response.text();
      expect(content).toBe(TEST_CONTENT.LARGE.slice(1000, 2001));
    });
  });

  describe("empty file handling", () => {
    it("should handle empty files correctly", async () => {
      const request = createMockRequest("http://localhost/empty.txt");
      const response = await fileServerHandler(request);

      expect(response.status).toBe(200);
      expect(response.headers.get("content-length")).toBe("0");
      
      const content = await response.text();
      expect(content).toBe("");
    });

    it("should handle range requests on empty files", async () => {
      const request = createMockRequest("http://localhost/empty.txt", {
        headers: { range: "bytes=0-10" },
      });
      const response = await fileServerHandler(request);

      expect(response.status).toBe(416);
    });
  });

  describe("custom headers", () => {
    it("should include custom headers in responses", async () => {
      const customHandler = createFileServer({
        root: testFs.rootPath,
        headers: {
          "X-Custom-Header": "test-value",
          "X-Server": "web-file-server",
        },
      });

      const request = createMockRequest("http://localhost/readme.txt");
      const response = await customHandler(request);

      expect(response.status).toBe(200);
      expect(response.headers.get("x-custom-header")).toBe("test-value");
      expect(response.headers.get("x-server")).toBe("web-file-server");
    });
  });

  describe("configuration validation", () => {
    it("should throw error for invalid root directory", () => {
      expect(() => {
        createFileServer({ root: "/non/existent/directory" });
      }).toThrow(FileServerError);
    });

    it("should throw error for file as root", async () => {
      const filePath = await testFs.createFile("notadir.txt", "content");
      
      expect(() => {
        createFileServer({ root: filePath });
      }).toThrow(FileServerError);
    });
  });

  describe("concurrent requests", () => {
    it("should handle multiple concurrent requests", async () => {
      const requests = Array.from({ length: 10 }, (_, i) =>
        createMockRequest(`http://localhost/readme.txt?req=${i}`)
      );

      const responses = await Promise.all(
        requests.map(request => fileServerHandler(request))
      );

      for (const response of responses) {
        expect(response.status).toBe(200);
        const content = await response.text();
        expect(content).toBe(TEST_CONTENT.TEXT);
      }
    });

    it("should handle concurrent range requests", async () => {
      const requests = Array.from({ length: 5 }, (_, i) => {
        const start = i * 10;
        const end = start + 9;
        return createMockRequest("http://localhost/large.txt", {
          headers: { range: `bytes=${start}-${end}` },
        });
      });

      const responses = await Promise.all(
        requests.map(request => fileServerHandler(request))
      );

      for (let i = 0; i < responses.length; i++) {
        const response = responses[i];
        expect(response.status).toBe(206);
        
        const content = await response.text();
        const start = i * 10;
        const end = start + 10;
        expect(content).toBe(TEST_CONTENT.LARGE.slice(start, end));
      }
    });
  });

  describe("different streaming modes", () => {
    it("should work with buffered mode", async () => {
      const bufferedHandler = createFileServer({
        root: testFs.rootPath,
        streaming: false,
      });

      const request = createMockRequest("http://localhost/readme.txt");
      const response = await bufferedHandler(request);

      expect(response.status).toBe(200);
      
      const content = await response.text();
      expect(content).toBe(TEST_CONTENT.TEXT);
    });

    it("should work with streaming mode for large files", async () => {
      const streamingHandler = createFileServer({
        root: testFs.rootPath,
        streaming: true,
      });

      const request = createMockRequest("http://localhost/large.txt");
      const response = await streamingHandler(request);

      expect(response.status).toBe(200);
      expect(response.body).toBeDefined();
      
      const content = await response.text();
      expect(content).toBe(TEST_CONTENT.LARGE);
    });
  });

  describe("ETag variations", () => {
    it("should generate strong ETags by default", async () => {
      const request = createMockRequest("http://localhost/readme.txt");
      const response = await fileServerHandler(request);

      expect(response.status).toBe(200);
      const etag = response.headers.get("etag");
      expect(etag).toMatch(/^"[a-f0-9]+"$/);
      expect(etag?.startsWith('W/')).toBe(false);
    });

    it("should generate weak ETags when configured", async () => {
      const weakETagHandler = createFileServer({
        root: testFs.rootPath,
        etag: "weak",
      });

      const request = createMockRequest("http://localhost/readme.txt");
      const response = await weakETagHandler(request);

      expect(response.status).toBe(200);
      const etag = response.headers.get("etag");
      expect(etag).toMatch(/^W\/"[a-f0-9]+"$/);
    });

    it("should not include ETag when disabled", async () => {
      const noETagHandler = createFileServer({
        root: testFs.rootPath,
        etag: false,
      });

      const request = createMockRequest("http://localhost/readme.txt");
      const response = await noETagHandler(request);

      expect(response.status).toBe(200);
      expect(response.headers.get("etag")).toBeNull();
    });
  });

  describe("edge cases and error conditions", () => {
    it("should handle malformed URLs gracefully", async () => {
      const request = createMockRequest("http://localhost/invalid%url");
      const response = await fileServerHandler(request);

      expect(response.status).toBe(403); // Path resolution failed
    });

    it("should handle URLs with query strings", async () => {
      const request = createMockRequest("http://localhost/readme.txt?param=value&other=123");
      const response = await fileServerHandler(request);

      expect(response.status).toBe(200);
      const content = await response.text();
      expect(content).toBe(TEST_CONTENT.TEXT);
    });

    it("should handle URLs with fragments", async () => {
      const request = createMockRequest("http://localhost/readme.txt#section1");
      const response = await fileServerHandler(request);

      expect(response.status).toBe(200);
      const content = await response.text();
      expect(content).toBe(TEST_CONTENT.TEXT);
    });

    it("should handle multiple slashes in paths", async () => {
      const request = createMockRequest("http://localhost///readme.txt");
      const response = await fileServerHandler(request);

      expect(response.status).toBe(200);
      const content = await response.text();
      expect(content).toBe(TEST_CONTENT.TEXT);
    });
  });
});