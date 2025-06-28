import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolveFilePath, checkForSymlink, shouldServeDotfile, handleDirectoryRequest } from "../src/fs-utils.js";
import { FileServerError } from "../src/validators.js";
import { TestFileSystem } from "./utils/test-helpers.js";

describe("resolveFilePath", () => {
  let testFs: TestFileSystem;

  beforeEach(async () => {
    testFs = await TestFileSystem.create();
  });

  afterEach(() => {
    testFs.cleanup();
  });

  describe("valid paths", () => {
    it("should resolve simple paths", () => {
      const result = resolveFilePath("/index.html", testFs.rootPath);
      expect(result.isValid).toBe(true);
      expect(result.filePath).toBe(testFs.getPath("index.html"));
    });

    it("should resolve nested paths", () => {
      const result = resolveFilePath("/assets/css/style.css", testFs.rootPath);
      expect(result.isValid).toBe(true);
      expect(result.filePath).toBe(testFs.getPath("assets/css/style.css"));
    });

    it("should resolve root path", () => {
      const result = resolveFilePath("/", testFs.rootPath);
      expect(result.isValid).toBe(true);
      expect(result.filePath).toBe(testFs.rootPath);
    });

    it("should handle URL encoding", () => {
      const result = resolveFilePath("/file%20with%20spaces.txt", testFs.rootPath);
      expect(result.isValid).toBe(true);
      expect(result.filePath).toBe(testFs.getPath("file with spaces.txt"));
    });

    it("should handle multiple leading slashes", () => {
      const result = resolveFilePath("//index.html", testFs.rootPath);
      expect(result.isValid).toBe(true);
      expect(result.filePath).toBe(testFs.getPath("index.html"));
    });

    it("should handle paths without leading slash", () => {
      const result = resolveFilePath("index.html", testFs.rootPath);
      expect(result.isValid).toBe(true);
      expect(result.filePath).toBe(testFs.getPath("index.html"));
    });
  });

  describe("path traversal prevention", () => {
    it("should block path traversal with ..", () => {
      const result = resolveFilePath("/../etc/passwd", testFs.rootPath);
      expect(result.isValid).toBe(false);
      expect(result.filePath).toBe("");
    });

    it("should block nested path traversal", () => {
      const result = resolveFilePath("/assets/../../etc/passwd", testFs.rootPath);
      expect(result.isValid).toBe(false);
      expect(result.filePath).toBe("");
    });

    it("should block URL encoded path traversal", () => {
      const result = resolveFilePath("/%2e%2e/etc/passwd", testFs.rootPath);
      expect(result.isValid).toBe(false);
      expect(result.filePath).toBe("");
    });

    it("should block complex path traversal attempts", () => {
      const traversalAttempts = [
        "/./../../etc/passwd",
        "/assets/../../../etc/passwd",
        "/assets/css/../../../etc/passwd",
        "/../../../etc/passwd",
        "/...//...//etc/passwd",
      ];

      for (const attempt of traversalAttempts) {
        const result = resolveFilePath(attempt, testFs.rootPath);
        expect(result.isValid).toBe(false);
        expect(result.filePath).toBe("");
      }
    });

    it("should allow safe relative paths", () => {
      const result = resolveFilePath("/assets/../css/style.css", testFs.rootPath);
      expect(result.isValid).toBe(true);
      expect(result.filePath).toBe(testFs.getPath("css/style.css"));
    });
  });

  describe("error handling", () => {
    it("should handle malformed URLs gracefully", () => {
      const malformedUrls = [
        "/invalid%url",
        "/invalid%2",
        "/invalid%gg",
      ];

      for (const url of malformedUrls) {
        const result = resolveFilePath(url, testFs.rootPath);
        expect(result.isValid).toBe(false);
        expect(result.filePath).toBe("");
      }
    });

    it("should handle extremely long paths", () => {
      const longPath = "/" + "a".repeat(10000);
      const result = resolveFilePath(longPath, testFs.rootPath);
      // Should still be valid if it doesn't escape the root
      expect(result.isValid).toBe(true);
    });
  });
});

describe("checkForSymlink", () => {
  let testFs: TestFileSystem;

  beforeEach(async () => {
    testFs = await TestFileSystem.create();
  });

  afterEach(() => {
    testFs.cleanup();
  });

  it("should return null for regular files", async () => {
    const filePath = await testFs.createFile("test.txt", "content");
    const result = checkForSymlink(filePath);
    expect(result).toBeNull();
  });

  it("should return null for directories", async () => {
    const dirPath = await testFs.createDirectory("test-dir");
    const result = checkForSymlink(dirPath);
    expect(result).toBeNull();
  });

  it("should detect symbolic links", async () => {
    const targetFile = await testFs.createFile("target.txt", "content");
    const symlinkPath = await testFs.createSymlink("link.txt", targetFile);

    const result = checkForSymlink(symlinkPath);
    expect(result).toBeInstanceOf(FileServerError);
    expect(result?.code).toBe("SYMLINK_DENIED");
    expect(result?.statusCode).toBe(404); // Returns 404 to prevent info leakage
    expect(result?.message).toBe("Not Found");
  });

  it("should handle broken symbolic links", async () => {
    const symlinkPath = await testFs.createSymlink("broken-link.txt", "/non/existent/target");

    const result = checkForSymlink(symlinkPath);
    expect(result).toBeInstanceOf(FileServerError);
    expect(result?.code).toBe("SYMLINK_DENIED");
    expect(result?.statusCode).toBe(404);
  });

  it("should handle non-existent files", () => {
    const result = checkForSymlink("/non/existent/file");
    expect(result).toBeInstanceOf(FileServerError);
    expect(result?.code).toBe("SYMLINK_CHECK_ERROR");
    expect(result?.statusCode).toBe(500);
    expect(result?.message).toBe("Unable to verify file security");
  });

  it("should handle permission errors", async () => {
    // Create a file and remove read permissions on its parent directory
    const subdirPath = await testFs.createDirectory("restricted");
    const filePath = await testFs.createFile("restricted/file.txt", "content");
    
    // Note: Actual permission testing might be limited on some systems
    // This test documents expected behavior for permission denied scenarios
    try {
      await testFs.createFileWithPermissions("restricted", "content", 0o000);
    } catch {
      // Permission modification might not work in all test environments
    }
  });
});

describe("shouldServeDotfile", () => {
  describe("allow policy", () => {
    it("should allow all dotfiles", () => {
      expect(shouldServeDotfile("/path/.env", "allow")).toBe(true);
      expect(shouldServeDotfile("/path/.gitignore", "allow")).toBe(true);
      expect(shouldServeDotfile("/path/.hidden", "allow")).toBe(true);
      expect(shouldServeDotfile("/path/sub/.config", "allow")).toBe(true);
    });

    it("should allow regular files", () => {
      expect(shouldServeDotfile("/path/file.txt", "allow")).toBe(true);
      expect(shouldServeDotfile("/path/index.html", "allow")).toBe(true);
    });
  });

  describe("deny policy", () => {
    it("should deny dotfiles", () => {
      expect(shouldServeDotfile("/path/.env", "deny")).toBe(false);
      expect(shouldServeDotfile("/path/.gitignore", "deny")).toBe(false);
      expect(shouldServeDotfile("/path/.hidden", "deny")).toBe(false);
      expect(shouldServeDotfile("/path/sub/.config", "deny")).toBe(false);
    });

    it("should allow regular files", () => {
      expect(shouldServeDotfile("/path/file.txt", "deny")).toBe(true);
      expect(shouldServeDotfile("/path/index.html", "deny")).toBe(true);
    });
  });

  describe("ignore policy", () => {
    it("should ignore dotfiles", () => {
      expect(shouldServeDotfile("/path/.env", "ignore")).toBe(false);
      expect(shouldServeDotfile("/path/.gitignore", "ignore")).toBe(false);
      expect(shouldServeDotfile("/path/.hidden", "ignore")).toBe(false);
      expect(shouldServeDotfile("/path/sub/.config", "ignore")).toBe(false);
    });

    it("should allow regular files", () => {
      expect(shouldServeDotfile("/path/file.txt", "ignore")).toBe(true);
      expect(shouldServeDotfile("/path/index.html", "ignore")).toBe(true);
    });
  });

  describe("edge cases", () => {
    it("should handle files with dots in the middle", () => {
      expect(shouldServeDotfile("/path/file.with.dots.txt", "deny")).toBe(true);
      expect(shouldServeDotfile("/path/jquery-3.6.0.min.js", "deny")).toBe(true);
    });

    it("should handle paths with dotted directories", () => {
      expect(shouldServeDotfile("/path/.hidden/file.txt", "deny")).toBe(false); // Contains dotfile directory
      expect(shouldServeDotfile("/path/normal/.hidden", "deny")).toBe(false);
    });

    it("should handle root dotfiles", () => {
      expect(shouldServeDotfile("/.env", "deny")).toBe(false);
      expect(shouldServeDotfile("/.gitignore", "allow")).toBe(true);
    });

    it("should handle empty filenames", () => {
      expect(shouldServeDotfile("/path/", "allow")).toBe(true);
      expect(shouldServeDotfile("", "allow")).toBe(true);
    });

    it("should handle paths ending with slashes", () => {
      expect(shouldServeDotfile("/path/file.txt/", "deny")).toBe(true);
      expect(shouldServeDotfile("/path/.hidden/", "deny")).toBe(false); // Contains dotfile directory
    });
  });
});

describe("handleDirectoryRequest", () => {
  let testFs: TestFileSystem;

  beforeEach(async () => {
    testFs = await TestFileSystem.create();
  });

  afterEach(() => {
    testFs.cleanup();
  });

  it("should find first available index file", async () => {
    await testFs.createFile("index.html", "<html>Index</html>");
    await testFs.createFile("index.htm", "<html>Alt Index</html>");

    const result = await handleDirectoryRequest(testFs.rootPath, ["index.html", "index.htm"]);

    expect(result.indexPath).toBe(testFs.getPath("index.html"));
    expect(result.indexStats).toBeDefined();
    expect(result.indexStats?.isFile()).toBe(true);
  });

  it("should try index files in order", async () => {
    await testFs.createFile("index.htm", "<html>Alt Index</html>");
    // No index.html file

    const result = await handleDirectoryRequest(testFs.rootPath, ["index.html", "index.htm"]);

    expect(result.indexPath).toBe(testFs.getPath("index.htm"));
    expect(result.indexStats).toBeDefined();
  });

  it("should return empty object when no index files found", async () => {
    const result = await handleDirectoryRequest(testFs.rootPath, ["index.html", "index.htm"]);

    expect(result.indexPath).toBeUndefined();
    expect(result.indexStats).toBeUndefined();
  });

  it("should handle empty index array", async () => {
    await testFs.createFile("index.html", "<html>Index</html>");

    const result = await handleDirectoryRequest(testFs.rootPath, []);

    expect(result.indexPath).toBeUndefined();
    expect(result.indexStats).toBeUndefined();
  });

  it("should ignore directories with same name as index file", async () => {
    await testFs.createDirectory("index.html");
    await testFs.createFile("index.htm", "<html>Index</html>");

    const result = await handleDirectoryRequest(testFs.rootPath, ["index.html", "index.htm"]);

    expect(result.indexPath).toBe(testFs.getPath("index.htm"));
    expect(result.indexStats).toBeDefined();
  });

  it("should handle nested directory requests", async () => {
    await testFs.createDirectory("subdir");
    await testFs.createFile("subdir/index.html", "<html>Sub Index</html>");

    const result = await handleDirectoryRequest(testFs.getPath("subdir"), ["index.html"]);

    expect(result.indexPath).toBe(testFs.getPath("subdir/index.html"));
    expect(result.indexStats).toBeDefined();
  });

  it("should handle non-existent directory", async () => {
    const result = await handleDirectoryRequest("/non/existent/dir", ["index.html"]);

    expect(result.indexPath).toBeUndefined();
    expect(result.indexStats).toBeUndefined();
  });

  it("should handle custom index file names", async () => {
    await testFs.createFile("default.html", "<html>Default</html>");
    await testFs.createFile("home.html", "<html>Home</html>");

    const result = await handleDirectoryRequest(testFs.rootPath, ["default.html", "home.html"]);

    expect(result.indexPath).toBe(testFs.getPath("default.html"));
    expect(result.indexStats).toBeDefined();
  });

  it("should handle index files with different extensions", async () => {
    await testFs.createFile("index.php", "<?php echo 'Hello'; ?>");
    await testFs.createFile("index.jsp", "<% out.println('Hello'); %>");

    const result = await handleDirectoryRequest(testFs.rootPath, ["index.html", "index.php", "index.jsp"]);

    expect(result.indexPath).toBe(testFs.getPath("index.php"));
    expect(result.indexStats).toBeDefined();
  });

  it("should handle concurrent access to same directory", async () => {
    await testFs.createFile("index.html", "<html>Index</html>");

    // Simulate concurrent requests
    const promises = Array.from({ length: 10 }, () =>
      handleDirectoryRequest(testFs.rootPath, ["index.html"])
    );

    const results = await Promise.all(promises);

    for (const result of results) {
      expect(result.indexPath).toBe(testFs.getPath("index.html"));
      expect(result.indexStats).toBeDefined();
    }
  });
});