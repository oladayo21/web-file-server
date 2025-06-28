import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { FileServerError, validateFileServerOptions } from "../src/validators.js";
import { TestFileSystem } from "./utils/test-helpers.js";

describe("FileServerError", () => {
  it("should create error with all properties", () => {
    const cause = new Error("Original error");
    const error = new FileServerError(
      "TEST_ERROR",
      "Test error message",
      404,
      "/test/path",
      "test_operation",
      cause
    );

    expect(error.name).toBe("FileServerError");
    expect(error.code).toBe("TEST_ERROR");
    expect(error.message).toBe("Test error message");
    expect(error.statusCode).toBe(404);
    expect(error.filePath).toBe("/test/path");
    expect(error.operation).toBe("test_operation");
    expect(error.cause).toBe(cause);
  });

  it("should create error without optional properties", () => {
    const error = new FileServerError("TEST_ERROR", "Test message", 500);

    expect(error.code).toBe("TEST_ERROR");
    expect(error.message).toBe("Test message");
    expect(error.statusCode).toBe(500);
    expect(error.filePath).toBeUndefined();
    expect(error.operation).toBeUndefined();
    expect(error.cause).toBeUndefined();
  });

  it("should extend Error correctly", () => {
    const error = new FileServerError("TEST", "message", 500);
    expect(error instanceof Error).toBe(true);
    expect(error instanceof FileServerError).toBe(true);
  });
});

describe("validateFileServerOptions", () => {
  let testFs: TestFileSystem;

  beforeEach(async () => {
    testFs = await TestFileSystem.create();
  });

  afterEach(() => {
    testFs.cleanup();
  });

  describe("root directory validation", () => {
    it("should accept valid directory", () => {
      expect(() => {
        validateFileServerOptions({ root: testFs.rootPath });
      }).not.toThrow();
    });

    it("should reject undefined root", () => {
      expect(() => {
        // @ts-expect-error Testing invalid input
        validateFileServerOptions({});
      }).toThrow(FileServerError);

      try {
        // @ts-expect-error Testing invalid input
        validateFileServerOptions({});
      } catch (error) {
        expect(error).toBeInstanceOf(FileServerError);
        expect((error as FileServerError).code).toBe("INVALID_CONFIG");
        expect((error as FileServerError).statusCode).toBe(500);
      }
    });

    it("should reject null root", () => {
      expect(() => {
        // @ts-expect-error Testing invalid input
        validateFileServerOptions({ root: null });
      }).toThrow(FileServerError);
    });

    it("should reject empty string root", () => {
      expect(() => {
        validateFileServerOptions({ root: "" });
      }).toThrow(FileServerError);
    });

    it("should reject non-string root", () => {
      expect(() => {
        // @ts-expect-error Testing invalid input
        validateFileServerOptions({ root: 123 });
      }).toThrow(FileServerError);

      expect(() => {
        // @ts-expect-error Testing invalid input
        validateFileServerOptions({ root: {} });
      }).toThrow(FileServerError);
    });

    it("should reject non-existent directory", () => {
      expect(() => {
        validateFileServerOptions({ root: "/non/existent/directory" });
      }).toThrow(FileServerError);

      try {
        validateFileServerOptions({ root: "/non/existent/directory" });
      } catch (error) {
        expect(error).toBeInstanceOf(FileServerError);
        expect((error as FileServerError).code).toBe("ROOT_NOT_ACCESSIBLE");
        expect((error as FileServerError).statusCode).toBe(500);
      }
    });

    it("should reject file as root", async () => {
      const filePath = await testFs.createFile("test.txt", "content");

      expect(() => {
        validateFileServerOptions({ root: filePath });
      }).toThrow(FileServerError);

      try {
        validateFileServerOptions({ root: filePath });
      } catch (error) {
        expect(error).toBeInstanceOf(FileServerError);
        expect((error as FileServerError).code).toBe("INVALID_ROOT");
        expect((error as FileServerError).statusCode).toBe(500);
        expect((error as FileServerError).message).toContain("not a directory");
      }
    });
  });

  describe("cache control validation", () => {
    it("should accept string cache control", () => {
      expect(() => {
        validateFileServerOptions({
          root: testFs.rootPath,
          cacheControl: "max-age=3600",
        });
      }).not.toThrow();
    });

    it("should accept undefined cache control", () => {
      expect(() => {
        validateFileServerOptions({
          root: testFs.rootPath,
          cacheControl: undefined,
        });
      }).not.toThrow();
    });

    it("should accept valid regex patterns", () => {
      expect(() => {
        validateFileServerOptions({
          root: testFs.rootPath,
          cacheControl: {
            "\\.js$": "max-age=3600",
            "\\.css$": "max-age=86400",
            "\\.png$": "max-age=604800",
          },
        });
      }).not.toThrow();
    });

    it("should reject invalid regex patterns", () => {
      expect(() => {
        validateFileServerOptions({
          root: testFs.rootPath,
          cacheControl: {
            "[invalid": "max-age=3600", // Invalid regex
          },
        });
      }).toThrow(FileServerError);

      try {
        validateFileServerOptions({
          root: testFs.rootPath,
          cacheControl: {
            "[invalid": "max-age=3600",
          },
        });
      } catch (error) {
        expect(error).toBeInstanceOf(FileServerError);
        expect((error as FileServerError).code).toBe("INVALID_CACHE_PATTERN");
        expect((error as FileServerError).statusCode).toBe(500);
      }
    });

    it("should reject non-string cache control values", () => {
      expect(() => {
        validateFileServerOptions({
          root: testFs.rootPath,
          cacheControl: {
            "\\.js$": 3600 as any, // Should be string
          },
        });
      }).toThrow(FileServerError);

      try {
        validateFileServerOptions({
          root: testFs.rootPath,
          cacheControl: {
            "\\.js$": 3600 as any,
          },
        });
      } catch (error) {
        expect(error).toBeInstanceOf(FileServerError);
        expect((error as FileServerError).code).toBe("INVALID_CACHE_VALUE");
        expect((error as FileServerError).statusCode).toBe(500);
      }
    });
  });

  describe("compression validation", () => {
    it("should accept boolean compression", () => {
      expect(() => {
        validateFileServerOptions({
          root: testFs.rootPath,
          compression: true,
        });
      }).not.toThrow();

      expect(() => {
        validateFileServerOptions({
          root: testFs.rootPath,
          compression: false,
        });
      }).not.toThrow();
    });

    it("should accept undefined compression", () => {
      expect(() => {
        validateFileServerOptions({
          root: testFs.rootPath,
          compression: undefined,
        });
      }).not.toThrow();
    });

    it("should accept valid compression algorithms", () => {
      expect(() => {
        validateFileServerOptions({
          root: testFs.rootPath,
          compression: ["br", "gzip", "deflate"],
        });
      }).not.toThrow();

      expect(() => {
        validateFileServerOptions({
          root: testFs.rootPath,
          compression: ["gzip"],
        });
      }).not.toThrow();

      expect(() => {
        validateFileServerOptions({
          root: testFs.rootPath,
          compression: [],
        });
      }).not.toThrow();
    });

    it("should reject invalid compression algorithms", () => {
      expect(() => {
        validateFileServerOptions({
          root: testFs.rootPath,
          compression: ["invalid", "gzip"],
        });
      }).toThrow(FileServerError);

      try {
        validateFileServerOptions({
          root: testFs.rootPath,
          compression: ["lzma", "bzip2"],
        });
      } catch (error) {
        expect(error).toBeInstanceOf(FileServerError);
        expect((error as FileServerError).code).toBe("INVALID_COMPRESSION");
        expect((error as FileServerError).statusCode).toBe(500);
        expect((error as FileServerError).message).toContain("Unsupported compression algorithm");
      }
    });
  });

  describe("index files validation", () => {
    it("should accept undefined index", () => {
      expect(() => {
        validateFileServerOptions({
          root: testFs.rootPath,
          index: undefined,
        });
      }).not.toThrow();
    });

    it("should accept valid index arrays", () => {
      expect(() => {
        validateFileServerOptions({
          root: testFs.rootPath,
          index: ["index.html"],
        });
      }).not.toThrow();

      expect(() => {
        validateFileServerOptions({
          root: testFs.rootPath,
          index: ["index.html", "index.htm", "default.html"],
        });
      }).not.toThrow();

      expect(() => {
        validateFileServerOptions({
          root: testFs.rootPath,
          index: [],
        });
      }).not.toThrow();
    });

    it("should reject non-array index", () => {
      expect(() => {
        validateFileServerOptions({
          root: testFs.rootPath,
          // @ts-expect-error Testing invalid input
          index: "index.html",
        });
      }).toThrow(FileServerError);

      try {
        validateFileServerOptions({
          root: testFs.rootPath,
          // @ts-expect-error Testing invalid input
          index: "index.html",
        });
      } catch (error) {
        expect(error).toBeInstanceOf(FileServerError);
        expect((error as FileServerError).code).toBe("INVALID_INDEX");
        expect((error as FileServerError).statusCode).toBe(500);
      }
    });

    it("should reject non-string index file names", () => {
      expect(() => {
        validateFileServerOptions({
          root: testFs.rootPath,
          // @ts-expect-error Testing invalid input
          index: [123, "index.html"],
        });
      }).toThrow(FileServerError);

      try {
        validateFileServerOptions({
          root: testFs.rootPath,
          // @ts-expect-error Testing invalid input
          index: [null, "index.html"],
        });
      } catch (error) {
        expect(error).toBeInstanceOf(FileServerError);
        expect((error as FileServerError).code).toBe("INVALID_INDEX_FILE");
        expect((error as FileServerError).statusCode).toBe(500);
      }
    });

    it("should reject empty string index file names", () => {
      expect(() => {
        validateFileServerOptions({
          root: testFs.rootPath,
          index: ["", "index.html"],
        });
      }).toThrow(FileServerError);

      expect(() => {
        validateFileServerOptions({
          root: testFs.rootPath,
          index: ["   ", "index.html"], // Whitespace only
        });
      }).toThrow(FileServerError);
    });
  });

  describe("complex validation scenarios", () => {
    it("should validate all options together", () => {
      expect(() => {
        validateFileServerOptions({
          root: testFs.rootPath,
          index: ["index.html", "index.htm"],
          dotfiles: "deny",
          headers: { "X-Custom": "value" },
          streaming: true,
          etag: "strong",
          compression: ["br", "gzip"],
          precompressed: true,
          cacheControl: {
            "\\.js$": "max-age=3600",
            "\\.css$": "max-age=86400",
          },
        });
      }).not.toThrow();
    });

    it("should stop on first validation error", () => {
      // Test that it throws on the first error it encounters
      expect(() => {
        validateFileServerOptions({
          root: "/non/existent", // This should fail first
          compression: ["invalid"], // This would also fail but shouldn't be reached
        });
      }).toThrow(FileServerError);

      try {
        validateFileServerOptions({
          root: "/non/existent",
          compression: ["invalid"] as any,
        });
      } catch (error) {
        expect(error).toBeInstanceOf(FileServerError);
        expect((error as FileServerError).code).toBe("ROOT_NOT_ACCESSIBLE");
      }
    });
  });
});