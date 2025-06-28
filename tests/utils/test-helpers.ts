import { mkdtemp, writeFile, mkdir, symlink, chmod } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { rmSync } from "node:fs";

/**
 * Test fixture for creating temporary file systems
 */
export class TestFileSystem {
  public readonly rootPath: string;

  constructor(rootPath: string) {
    this.rootPath = rootPath;
  }

  /**
   * Creates a temporary file system for testing
   */
  static async create(): Promise<TestFileSystem> {
    const rootPath = await mkdtemp(join(tmpdir(), "web-file-server-test-"));
    return new TestFileSystem(rootPath);
  }

  /**
   * Creates a file with content
   */
  async createFile(relativePath: string, content: string | Buffer): Promise<string> {
    const fullPath = join(this.rootPath, relativePath);
    const dir = join(fullPath, "..");
    await mkdir(dir, { recursive: true });
    await writeFile(fullPath, content);
    return fullPath;
  }

  /**
   * Creates a directory
   */
  async createDirectory(relativePath: string): Promise<string> {
    const fullPath = join(this.rootPath, relativePath);
    await mkdir(fullPath, { recursive: true });
    return fullPath;
  }

  /**
   * Creates a symbolic link
   */
  async createSymlink(relativePath: string, target: string): Promise<string> {
    const fullPath = join(this.rootPath, relativePath);
    const dir = join(fullPath, "..");
    await mkdir(dir, { recursive: true });
    await symlink(target, fullPath);
    return fullPath;
  }

  /**
   * Creates a file with specific permissions
   */
  async createFileWithPermissions(relativePath: string, content: string, mode: number): Promise<string> {
    const fullPath = await this.createFile(relativePath, content);
    await chmod(fullPath, mode);
    return fullPath;
  }

  /**
   * Gets the full path for a relative path
   */
  getPath(relativePath: string): string {
    return join(this.rootPath, relativePath);
  }

  /**
   * Cleans up the temporary file system
   */
  cleanup(): void {
    try {
      rmSync(this.rootPath, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Helper to create mock Request objects
 */
export function createMockRequest(
  url: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
  } = {}
): Request {
  return new Request(url, {
    method: options.method || "GET",
    headers: options.headers || {},
  });
}

/**
 * Helper to extract response details for testing
 */
export async function getResponseDetails(response: Response) {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });

  let body: string | null = null;
  try {
    body = await response.text();
  } catch {
    // Some responses might not have text content
  }

  return {
    status: response.status,
    statusText: response.statusText,
    headers,
    body,
  };
}

/**
 * Helper to create test content with known characteristics
 */
export const TEST_CONTENT = {
  HTML: "<!DOCTYPE html><html><head><title>Test</title></head><body><h1>Hello World</h1></body></html>",
  CSS: "body { color: red; font-size: 16px; }",
  JS: "console.log('Hello from JavaScript');",
  JSON: '{"name": "test", "value": 42}',
  TEXT: "This is a plain text file for testing purposes.",
  BINARY: new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), // PNG signature
  LARGE: "x".repeat(1024 * 1024), // 1MB of 'x' characters
  EMPTY: "",
} as const;

/**
 * Helper to create files with predictable dates
 */
export async function createFileWithDate(
  fs: TestFileSystem,
  relativePath: string,
  content: string,
  date: Date
): Promise<string> {
  const fullPath = await fs.createFile(relativePath, content);
  // Note: We can't easily mock file dates in tests, but we can document expected behavior
  return fullPath;
}

/**
 * Helper to generate consistent test data
 */
export function generateTestData(size: number, pattern = "test"): string {
  const repeatCount = Math.ceil(size / pattern.length);
  return pattern.repeat(repeatCount).slice(0, size);
}

/**
 * Helper to create a range of test files
 */
export async function createTestFiles(fs: TestFileSystem): Promise<Record<string, string>> {
  const files = {
    "index.html": await fs.createFile("index.html", TEST_CONTENT.HTML),
    "style.css": await fs.createFile("assets/style.css", TEST_CONTENT.CSS),
    "app.js": await fs.createFile("assets/app.js", TEST_CONTENT.JS),
    "data.json": await fs.createFile("api/data.json", TEST_CONTENT.JSON),
    "readme.txt": await fs.createFile("readme.txt", TEST_CONTENT.TEXT),
    "image.png": await fs.createFile("images/image.png", TEST_CONTENT.BINARY),
    "large.txt": await fs.createFile("large.txt", TEST_CONTENT.LARGE),
    "empty.txt": await fs.createFile("empty.txt", TEST_CONTENT.EMPTY),
    ".dotfile": await fs.createFile(".dotfile", "secret content"),
    ".env": await fs.createFile(".env", "SECRET_KEY=12345"),
  };

  // Create compressed versions  
  await fs.createFile("assets/app.js.gz", "compressed js content");
  await fs.createFile("assets/app.js.br", "brotli compressed js");
  await fs.createFile("assets/style.css.gz", "compressed css content");

  return files;
}

/**
 * Assertion helper for Response objects
 */
export function expectResponseStatus(response: Response, expectedStatus: number): void {
  if (response.status !== expectedStatus) {
    throw new Error(`Expected status ${expectedStatus}, got ${response.status}`);
  }
}

/**
 * Assertion helper for Response headers
 */
export function expectResponseHeader(response: Response, headerName: string, expectedValue?: string): void {
  const actualValue = response.headers.get(headerName);
  if (expectedValue === undefined) {
    if (actualValue === null) {
      throw new Error(`Expected header ${headerName} to be present`);
    }
  } else {
    if (actualValue !== expectedValue) {
      throw new Error(`Expected header ${headerName} to be "${expectedValue}", got "${actualValue}"`);
    }
  }
}