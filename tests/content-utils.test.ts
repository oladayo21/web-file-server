import { describe, it, expect } from "vitest";
import { getMimeType, generateETag, getCacheControl, MIME_TYPES } from "../src/content-utils.js";
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

describe("MIME_TYPES", () => {
  it("should include common text types", () => {
    expect(MIME_TYPES[".html"]).toBe("text/html");
    expect(MIME_TYPES[".htm"]).toBe("text/html");
    expect(MIME_TYPES[".css"]).toBe("text/css");
    expect(MIME_TYPES[".js"]).toBe("text/javascript");
    expect(MIME_TYPES[".mjs"]).toBe("text/javascript");
    expect(MIME_TYPES[".txt"]).toBe("text/plain");
    expect(MIME_TYPES[".xml"]).toBe("text/xml");
    expect(MIME_TYPES[".json"]).toBe("application/json");
  });

  it("should include common image types", () => {
    expect(MIME_TYPES[".png"]).toBe("image/png");
    expect(MIME_TYPES[".jpg"]).toBe("image/jpeg");
    expect(MIME_TYPES[".jpeg"]).toBe("image/jpeg");
    expect(MIME_TYPES[".gif"]).toBe("image/gif");
    expect(MIME_TYPES[".svg"]).toBe("image/svg+xml");
    expect(MIME_TYPES[".webp"]).toBe("image/webp");
    expect(MIME_TYPES[".ico"]).toBe("image/x-icon");
  });

  it("should include font types", () => {
    expect(MIME_TYPES[".woff"]).toBe("font/woff");
    expect(MIME_TYPES[".woff2"]).toBe("font/woff2");
    expect(MIME_TYPES[".ttf"]).toBe("font/ttf");
    expect(MIME_TYPES[".otf"]).toBe("font/otf");
    expect(MIME_TYPES[".eot"]).toBe("application/vnd.ms-fontobject");
  });

  it("should include document types", () => {
    expect(MIME_TYPES[".pdf"]).toBe("application/pdf");
    expect(MIME_TYPES[".zip"]).toBe("application/zip");
    expect(MIME_TYPES[".tar"]).toBe("application/x-tar");
    expect(MIME_TYPES[".gz"]).toBe("application/gzip");
  });

  it("should include media types", () => {
    expect(MIME_TYPES[".mp4"]).toBe("video/mp4");
    expect(MIME_TYPES[".webm"]).toBe("video/webm");
    expect(MIME_TYPES[".mp3"]).toBe("audio/mpeg");
    expect(MIME_TYPES[".wav"]).toBe("audio/wav");
    expect(MIME_TYPES[".ogg"]).toBe("audio/ogg");
  });
});

describe("getMimeType", () => {
  it("should return correct MIME type for known extensions", () => {
    expect(getMimeType("/path/to/file.html")).toBe("text/html");
    expect(getMimeType("/path/to/style.css")).toBe("text/css");
    expect(getMimeType("/path/to/script.js")).toBe("text/javascript");
    expect(getMimeType("/path/to/image.png")).toBe("image/png");
    expect(getMimeType("/path/to/document.pdf")).toBe("application/pdf");
  });

  it("should handle uppercase extensions", () => {
    expect(getMimeType("/path/to/file.HTML")).toBe("text/html");
    expect(getMimeType("/path/to/IMAGE.PNG")).toBe("image/png");
    expect(getMimeType("/path/to/STYLE.CSS")).toBe("text/css");
  });

  it("should handle mixed case extensions", () => {
    expect(getMimeType("/path/to/file.HtMl")).toBe("text/html");
    expect(getMimeType("/path/to/image.JpG")).toBe("image/jpeg");
    expect(getMimeType("/path/to/script.Js")).toBe("text/javascript");
  });

  it("should return default MIME type for unknown extensions", () => {
    expect(getMimeType("/path/to/file.unknown")).toBe("application/octet-stream");
    expect(getMimeType("/path/to/file.xyz")).toBe("application/octet-stream");
    expect(getMimeType("/path/to/file.custom")).toBe("application/octet-stream");
  });

  it("should handle files without extensions", () => {
    expect(getMimeType("/path/to/file")).toBe("application/octet-stream");
    expect(getMimeType("/path/to/README")).toBe("application/octet-stream");
    expect(getMimeType("/path/to/Makefile")).toBe("application/octet-stream");
  });

  it("should handle files with multiple dots", () => {
    expect(getMimeType("/path/to/jquery.min.js")).toBe("text/javascript");
    expect(getMimeType("/path/to/archive.tar.gz")).toBe("application/gzip");
    expect(getMimeType("/path/to/file.backup.txt")).toBe("text/plain");
  });

  it("should handle edge cases", () => {
    expect(getMimeType("")).toBe("application/octet-stream");
    expect(getMimeType(".")).toBe("application/octet-stream");
    expect(getMimeType("/.")).toBe("application/octet-stream");
    expect(getMimeType("/file.")).toBe("application/octet-stream");
  });

  it("should handle hidden files", () => {
    expect(getMimeType("/.env")).toBe("application/octet-stream");
    expect(getMimeType("/.gitignore")).toBe("application/octet-stream");
    expect(getMimeType("/.bashrc")).toBe("application/octet-stream");
  });

  it("should handle complex paths", () => {
    expect(getMimeType("/very/long/path/to/deep/nested/file.html")).toBe("text/html");
    expect(getMimeType("./relative/path/file.css")).toBe("text/css");
    expect(getMimeType("../parent/path/file.js")).toBe("text/javascript");
  });
});

describe("generateETag", () => {
  const mockStats = createMockStats(1000, new Date("2023-01-01T12:00:00Z"));
  const filePath = "/path/to/file.txt";

  it("should generate consistent ETags for same input", () => {
    const etag1 = generateETag(mockStats, filePath);
    const etag2 = generateETag(mockStats, filePath);
    expect(etag1).toBe(etag2);
  });

  it("should generate strong ETags by default", () => {
    const etag = generateETag(mockStats, filePath);
    expect(etag).toMatch(/^"[a-f0-9]{16}"$/);
    expect(etag.startsWith('W/')).toBe(false);
  });

  it("should generate weak ETags when requested", () => {
    const etag = generateETag(mockStats, filePath, true);
    expect(etag).toMatch(/^W\/"[a-f0-9]{16}"$/);
    expect(etag.startsWith('W/')).toBe(true);
  });

  it("should generate different ETags for different files", () => {
    const etag1 = generateETag(mockStats, "/path/to/file1.txt");
    const etag2 = generateETag(mockStats, "/path/to/file2.txt");
    expect(etag1).not.toBe(etag2);
  });

  it("should generate different ETags for different sizes", () => {
    const stats1 = createMockStats(1000, new Date("2023-01-01T12:00:00Z"));
    const stats2 = createMockStats(2000, new Date("2023-01-01T12:00:00Z"));
    
    const etag1 = generateETag(stats1, filePath);
    const etag2 = generateETag(stats2, filePath);
    expect(etag1).not.toBe(etag2);
  });

  it("should generate different ETags for different modification times", () => {
    const stats1 = createMockStats(1000, new Date("2023-01-01T12:00:00Z"));
    const stats2 = createMockStats(1000, new Date("2023-01-01T13:00:00Z"));
    
    const etag1 = generateETag(stats1, filePath);
    const etag2 = generateETag(stats2, filePath);
    expect(etag1).not.toBe(etag2);
  });

  it("should include file path in ETag calculation", () => {
    const etag1 = generateETag(mockStats, "/path1/file.txt");
    const etag2 = generateETag(mockStats, "/path2/file.txt");
    expect(etag1).not.toBe(etag2);
  });

  it("should handle edge cases", () => {
    const zeroStats = createMockStats(0, new Date("1970-01-01T00:00:00Z"));
    const etag = generateETag(zeroStats, "");
    expect(etag).toMatch(/^"[a-f0-9]{16}"$/);
  });

  it("should generate 16-character hex hashes", () => {
    const etag = generateETag(mockStats, filePath);
    const hashPart = etag.slice(1, -1); // Remove quotes
    expect(hashPart).toMatch(/^[a-f0-9]{16}$/);
  });

  it("should handle very long file paths", () => {
    const longPath = "/" + "a".repeat(1000) + "/file.txt";
    const etag = generateETag(mockStats, longPath);
    expect(etag).toMatch(/^"[a-f0-9]{16}"$/);
  });

  it("should handle special characters in file paths", () => {
    const specialPath = "/path/with spaces/and-symbols_123.txt";
    const etag = generateETag(mockStats, specialPath);
    expect(etag).toMatch(/^"[a-f0-9]{16}"$/);
  });
});

describe("getCacheControl", () => {
  it("should return undefined when no cache control configured", () => {
    expect(getCacheControl("/path/to/file.js", undefined)).toBeUndefined();
  });

  it("should return string cache control as-is", () => {
    const cacheControl = "max-age=3600";
    expect(getCacheControl("/path/to/file.js", cacheControl)).toBe(cacheControl);
  });

  it("should return global string cache control for any file", () => {
    const cacheControl = "no-cache";
    expect(getCacheControl("/path/to/file.js", cacheControl)).toBe(cacheControl);
    expect(getCacheControl("/path/to/file.css", cacheControl)).toBe(cacheControl);
    expect(getCacheControl("/path/to/image.png", cacheControl)).toBe(cacheControl);
  });

  it("should match patterns for different file types", () => {
    const patterns = {
      "\\.js$": "max-age=3600",
      "\\.css$": "max-age=86400",
      "\\.png$": "max-age=604800",
    };

    expect(getCacheControl("/path/to/app.js", patterns)).toBe("max-age=3600");
    expect(getCacheControl("/path/to/style.css", patterns)).toBe("max-age=86400");
    expect(getCacheControl("/path/to/image.png", patterns)).toBe("max-age=604800");
  });

  it("should return undefined for non-matching patterns", () => {
    const patterns = {
      "\\.js$": "max-age=3600",
      "\\.css$": "max-age=86400",
    };

    expect(getCacheControl("/path/to/file.txt", patterns)).toBeUndefined();
    expect(getCacheControl("/path/to/image.jpg", patterns)).toBeUndefined();
  });

  it("should match first pattern when multiple patterns match", () => {
    const patterns = {
      "\\.min\\.js$": "max-age=86400", // More specific
      "\\.js$": "max-age=3600",        // Less specific
    };

    expect(getCacheControl("/path/to/app.min.js", patterns)).toBe("max-age=86400");
  });

  it("should handle complex regex patterns", () => {
    const patterns = {
      "\\.(js|css)$": "max-age=3600",
      "\\.(png|jpg|jpeg|gif)$": "max-age=604800",
      "/api/": "no-cache",
    };

    expect(getCacheControl("/path/to/app.js", patterns)).toBe("max-age=3600");
    expect(getCacheControl("/path/to/style.css", patterns)).toBe("max-age=3600");
    expect(getCacheControl("/path/to/image.png", patterns)).toBe("max-age=604800");
    expect(getCacheControl("/api/data.json", patterns)).toBe("no-cache");
  });

  it("should handle patterns with special characters", () => {
    const patterns = {
      "\\.min\\.(js|css)$": "max-age=86400",
      "/assets/": "max-age=604800",
      "^/static/": "max-age=31536000",
    };

    expect(getCacheControl("/path/app.min.js", patterns)).toBe("max-age=86400");
    expect(getCacheControl("/assets/image.png", patterns)).toBe("max-age=604800");
    expect(getCacheControl("/static/logo.svg", patterns)).toBe("max-age=31536000");
  });

  it("should return undefined for empty pattern object", () => {
    expect(getCacheControl("/path/to/file.js", {})).toBeUndefined();
  });

  it("should handle case-sensitive patterns", () => {
    const patterns = {
      "\\.JS$": "max-age=3600", // Uppercase
      "\\.js$": "max-age=7200", // Lowercase
    };

    expect(getCacheControl("/path/to/file.js", patterns)).toBe("max-age=7200");
    expect(getCacheControl("/path/to/file.JS", patterns)).toBe("max-age=3600");
  });

  it("should handle patterns that don't match entire path", () => {
    const patterns = {
      "vendor": "max-age=86400",
      "assets": "max-age=604800",
    };

    expect(getCacheControl("/vendor/library.js", patterns)).toBe("max-age=86400");
    expect(getCacheControl("/assets/image.png", patterns)).toBe("max-age=604800");
    expect(getCacheControl("/src/app.js", patterns)).toBeUndefined();
  });

  it("should handle order dependency in pattern matching", () => {
    const patterns = {
      "file": "first-match",
      "file\\.js$": "second-match",
    };

    // Should match first pattern that matches
    expect(getCacheControl("/path/to/file.js", patterns)).toBe("first-match");
  });

  it("should handle edge cases", () => {
    const patterns = {
      "": "empty-pattern",
      ".*": "match-all",
    };

    expect(getCacheControl("/any/file.txt", patterns)).toBe("empty-pattern");
  });
});