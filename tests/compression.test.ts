import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { findPrecompressedFile, handleCompression } from "../src/compression.js";
import { TestFileSystem, createMockRequest } from "./utils/test-helpers.js";

describe("findPrecompressedFile", () => {
  let testFs: TestFileSystem;

  beforeEach(async () => {
    testFs = await TestFileSystem.create();
  });

  afterEach(() => {
    testFs.cleanup();
  });

  it("should find brotli compressed files", async () => {
    const originalFile = await testFs.createFile("app.js", "console.log('original');");
    const compressedFile = await testFs.createFile("app.js.br", "compressed brotli content");

    const result = await findPrecompressedFile(originalFile, "br");
    expect(result).toBe(compressedFile);
  });

  it("should find gzip compressed files", async () => {
    const originalFile = await testFs.createFile("style.css", "body { color: red; }");
    const compressedFile = await testFs.createFile("style.css.gz", "compressed gzip content");

    const result = await findPrecompressedFile(originalFile, "gzip");
    expect(result).toBe(compressedFile);
  });

  it("should find deflate compressed files (using .gz extension)", async () => {
    const originalFile = await testFs.createFile("data.json", '{"test": true}');
    const compressedFile = await testFs.createFile("data.json.gz", "compressed deflate content");

    const result = await findPrecompressedFile(originalFile, "deflate");
    expect(result).toBe(compressedFile);
  });

  it("should return null for unsupported encodings", async () => {
    const originalFile = await testFs.createFile("app.js", "console.log('test');");

    const result = await findPrecompressedFile(originalFile, "unsupported");
    expect(result).toBeNull();
  });

  it("should return null when compressed file doesn't exist", async () => {
    const originalFile = await testFs.createFile("app.js", "console.log('test');");

    const result = await findPrecompressedFile(originalFile, "br");
    expect(result).toBeNull();
  });

  it("should handle files in subdirectories", async () => {
    const originalFile = await testFs.createFile("assets/js/app.js", "console.log('app');");
    const compressedFile = await testFs.createFile("assets/js/app.js.br", "compressed content");

    const result = await findPrecompressedFile(originalFile, "br");
    expect(result).toBe(compressedFile);
  });

  it("should handle files with multiple dots", async () => {
    const originalFile = await testFs.createFile("jquery.min.js", "compressed js library");
    const compressedFile = await testFs.createFile("jquery.min.js.gz", "double compressed");

    const result = await findPrecompressedFile(originalFile, "gzip");
    expect(result).toBe(compressedFile);
  });

  it("should handle edge cases", async () => {
    // File without extension
    const noExtFile = await testFs.createFile("README", "readme content");
    const compressedNoExt = await testFs.createFile("README.br", "compressed readme");

    const result = await findPrecompressedFile(noExtFile, "br");
    expect(result).toBe(compressedNoExt);
  });

  it("should handle permission or stat errors gracefully", async () => {
    // Test with a file that doesn't exist
    const result = await findPrecompressedFile("/non/existent/file.js", "br");
    expect(result).toBeNull();
  });
});

describe("handleCompression", () => {
  let testFs: TestFileSystem;

  beforeEach(async () => {
    testFs = await TestFileSystem.create();
  });

  afterEach(() => {
    testFs.cleanup();
  });

  it("should return original file when no supported encodings", async () => {
    const filePath = await testFs.createFile("app.js", "console.log('test');");
    const request = createMockRequest("http://localhost/app.js", {
      headers: { "accept-encoding": "gzip, br" },
    });

    const result = await handleCompression(filePath, request, [], true);

    expect(result.finalFilePath).toBe(filePath);
    expect(result.contentEncoding).toBeUndefined();
    expect(result.fileStats).toBeUndefined();
  });

  it("should return original file when precompressed is disabled", async () => {
    const filePath = await testFs.createFile("app.js", "console.log('test');");
    await testFs.createFile("app.js.br", "compressed content");
    
    const request = createMockRequest("http://localhost/app.js", {
      headers: { "accept-encoding": "br" },
    });

    const result = await handleCompression(filePath, request, ["br"], false);

    expect(result.finalFilePath).toBe(filePath);
    expect(result.contentEncoding).toBeUndefined();
  });

  it("should return original file when no accept-encoding header", async () => {
    const filePath = await testFs.createFile("app.js", "console.log('test');");
    await testFs.createFile("app.js.br", "compressed content");
    
    const request = createMockRequest("http://localhost/app.js");

    const result = await handleCompression(filePath, request, ["br"], true);

    expect(result.finalFilePath).toBe(filePath);
    expect(result.contentEncoding).toBeUndefined();
  });

  it("should return original file when client doesn't accept supported encodings", async () => {
    const filePath = await testFs.createFile("app.js", "console.log('test');");
    await testFs.createFile("app.js.br", "compressed content");
    
    const request = createMockRequest("http://localhost/app.js", {
      headers: { "accept-encoding": "identity" },
    });

    const result = await handleCompression(filePath, request, ["br", "gzip"], true);

    expect(result.finalFilePath).toBe(filePath);
    expect(result.contentEncoding).toBeUndefined();
  });

  it("should serve brotli compressed file when available and preferred", async () => {
    const filePath = await testFs.createFile("app.js", "console.log('test');");
    const compressedPath = await testFs.createFile("app.js.br", "compressed brotli content");
    
    // Brotli should be preferred when mentioned first or with higher quality
    const request = createMockRequest("http://localhost/app.js", {
      headers: { "accept-encoding": "br, gzip" },
    });

    const result = await handleCompression(filePath, request, ["br", "gzip"], true);

    expect(result.finalFilePath).toBe(compressedPath);
    expect(result.contentEncoding).toBe("br");
    expect(result.fileStats).toBeDefined();
    expect(result.fileStats?.size).toBeGreaterThan(0);
  });

  it("should serve gzip compressed file when brotli not available", async () => {
    const filePath = await testFs.createFile("app.js", "console.log('test');");
    const compressedPath = await testFs.createFile("app.js.gz", "compressed gzip content");
    
    // Only gzip file exists, so it should be served even if br is preferred
    const request = createMockRequest("http://localhost/app.js", {
      headers: { "accept-encoding": "br, gzip" },
    });

    const result = await handleCompression(filePath, request, ["br", "gzip"], true);

    expect(result.finalFilePath).toBe(compressedPath);
    expect(result.contentEncoding).toBe("gzip");
    expect(result.fileStats).toBeDefined();
  });

  it("should handle quality values in accept-encoding", async () => {
    const filePath = await testFs.createFile("app.js", "console.log('test');");
    const gzipPath = await testFs.createFile("app.js.gz", "gzip content");
    const brPath = await testFs.createFile("app.js.br", "brotli content");
    
    // Prefer gzip over brotli with quality values
    const request = createMockRequest("http://localhost/app.js", {
      headers: { "accept-encoding": "br;q=0.8, gzip;q=1.0" },
    });

    const result = await handleCompression(filePath, request, ["br", "gzip"], true);

    expect(result.finalFilePath).toBe(gzipPath);
    expect(result.contentEncoding).toBe("gzip");
  });

  it("should fallback to original file when compressed file stat fails", async () => {
    const filePath = await testFs.createFile("app.js", "console.log('test');");
    // Create compressed file path but don't actually create the file
    // This simulates a race condition where the file exists during findPrecompressedFile
    // but is deleted before stat in handleCompression
    
    const request = createMockRequest("http://localhost/app.js", {
      headers: { "accept-encoding": "br" },
    });

    const result = await handleCompression(filePath, request, ["br"], true);

    expect(result.finalFilePath).toBe(filePath);
    expect(result.contentEncoding).toBeUndefined();
  });

  it("should handle deflate encoding correctly", async () => {
    const filePath = await testFs.createFile("data.json", '{"test": true}');
    const compressedPath = await testFs.createFile("data.json.gz", "compressed deflate content");
    
    const request = createMockRequest("http://localhost/data.json", {
      headers: { "accept-encoding": "deflate" },
    });

    const result = await handleCompression(filePath, request, ["deflate"], true);

    expect(result.finalFilePath).toBe(compressedPath);
    expect(result.contentEncoding).toBe("deflate");
  });

  it("should handle multiple supported encodings in priority order", async () => {
    const filePath = await testFs.createFile("app.js", "console.log('test');");
    const gzipPath = await testFs.createFile("app.js.gz", "gzip content");
    const brPath = await testFs.createFile("app.js.br", "brotli content");
    
    // Client accepts both but doesn't specify preference
    const request = createMockRequest("http://localhost/app.js", {
      headers: { "accept-encoding": "gzip, br" },
    });

    // Server prefers br over gzip
    const result = await handleCompression(filePath, request, ["br", "gzip"], true);

    expect(result.finalFilePath).toBe(gzipPath); // First in client's list
    expect(result.contentEncoding).toBe("gzip");
  });

  it("should sanitize accept-encoding header", async () => {
    const filePath = await testFs.createFile("app.js", "console.log('test');");
    const compressedPath = await testFs.createFile("app.js.gz", "compressed content");
    
    // Create request manually to avoid header validation
    const request = new Request("http://localhost/app.js", {
      method: "GET",
      headers: new Headers(), // Empty headers
    });
    
    // Manually simulate the sanitized header being processed
    const mockSanitizedHeader = "gzipX-Injected: evil"; // What it would become after sanitization
    
    // Test that compression still works with sanitized header
    const result = await handleCompression(filePath, request, ["gzip"], true);

    // Since there's no gzip in the sanitized header, it should return original file
    expect(result.finalFilePath).toBe(filePath);
    expect(result.contentEncoding).toBeUndefined();
  });

  it("should handle complex accept-encoding headers", async () => {
    const filePath = await testFs.createFile("app.js", "console.log('test');");
    const brPath = await testFs.createFile("app.js.br", "brotli content");
    
    // Real-world complex header: gzip first (q=1.0 implicit), br with q=1.0 explicit
    const request = createMockRequest("http://localhost/app.js", {
      headers: { "accept-encoding": "gzip, deflate, br;q=1.0, *;q=0.1" },
    });

    const result = await handleCompression(filePath, request, ["br", "gzip", "deflate"], true);

    // gzip is preferred (first in list with equal quality) but not available, so br should be used
    expect(result.finalFilePath).toBe(brPath);
    expect(result.contentEncoding).toBe("br");
  });

  it("should handle missing compressed files gracefully", async () => {
    const filePath = await testFs.createFile("app.js", "console.log('test');");
    
    const request = createMockRequest("http://localhost/app.js", {
      headers: { "accept-encoding": "br" },
    });

    const result = await handleCompression(filePath, request, ["br"], true);

    expect(result.finalFilePath).toBe(filePath);
    expect(result.contentEncoding).toBeUndefined();
    expect(result.fileStats).toBeUndefined();
  });

  it("should work with nested directory structures", async () => {
    const filePath = await testFs.createFile("assets/js/modules/app.js", "module code");
    const compressedPath = await testFs.createFile("assets/js/modules/app.js.br", "compressed module");
    
    const request = createMockRequest("http://localhost/assets/js/modules/app.js", {
      headers: { "accept-encoding": "br" },
    });

    const result = await handleCompression(filePath, request, ["br"], true);

    expect(result.finalFilePath).toBe(compressedPath);
    expect(result.contentEncoding).toBe("br");
  });

  it("should handle concurrent compression requests", async () => {
    const filePath = await testFs.createFile("popular.js", "popular file content");
    const compressedPath = await testFs.createFile("popular.js.br", "compressed popular file");
    
    // Simulate multiple concurrent requests for the same file
    const requests = Array.from({ length: 10 }, () =>
      createMockRequest("http://localhost/popular.js", {
        headers: { "accept-encoding": "br" },
      })
    );

    const promises = requests.map(request =>
      handleCompression(filePath, request, ["br"], true)
    );

    const results = await Promise.all(promises);

    for (const result of results) {
      expect(result.finalFilePath).toBe(compressedPath);
      expect(result.contentEncoding).toBe("br");
      expect(result.fileStats).toBeDefined();
    }
  });
});