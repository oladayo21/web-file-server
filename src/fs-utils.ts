import type { Stats } from "node:fs";
import { lstatSync } from "node:fs";
import { stat } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { FileServerError } from "./validators.js";

/**
 * Resolves and validates a file path against the server root directory.
 *
 * Performs security validation to prevent path traversal attacks and
 * ensures all file access stays within the configured root directory.
 *
 * @param pathname - The URL pathname from the HTTP request
 * @param root - The root directory to serve files from
 * @returns Object containing the resolved file path and validation status
 *
 * @example
 * ```typescript
 * const { filePath, isValid } = resolveFilePath('/app.js', '/var/www');
 * if (isValid) {
 *   // Safe to serve file at filePath
 * } else {
 *   // Path traversal attempt blocked
 * }
 * ```
 */
export function resolveFilePath(
  pathname: string,
  root: string,
): { filePath: string; isValid: boolean } {
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
 * Checks if a file path is a symbolic link and blocks access for security.
 *
 * Symbolic links are denied to prevent access to files outside the
 * configured root directory, which could be a security vulnerability.
 *
 * @param filePath - The file path to check for symbolic links
 * @returns FileServerError if symlink detected or check failed, null if safe
 *
 * @example
 * ```typescript
 * const error = checkForSymlink('/var/www/suspicious-link');
 * if (error) {
 *   return new Response(error.message, { status: error.statusCode });
 * }
 * ```
 */
export function checkForSymlink(filePath: string): FileServerError | null {
  try {
    const stats = lstatSync(filePath);

    if (stats.isSymbolicLink()) {
      // Always deny symlinks for security - return 404 to avoid information leakage
      return new FileServerError("SYMLINK_DENIED", "Not Found", 404, filePath, "symlink_check");
    }

    return null; // Not a symlink, safe to proceed
  } catch (cause) {
    // If we can't check, treat it as an error
    return new FileServerError(
      "SYMLINK_CHECK_ERROR",
      "Unable to verify file security",
      500,
      filePath,
      "symlink_check",
      cause instanceof Error ? cause : new Error(String(cause)),
    );
  }
}

/**
 * Determines whether dotfiles should be served based on policy.
 *
 * Dotfiles (files starting with '.') often contain sensitive configuration
 * data and may need special handling based on server policy.
 *
 * @param filePath - The file path to check
 * @param dotfiles - The dotfile serving policy ('allow', 'deny', or 'ignore')
 * @returns True if the file should be served, false otherwise
 *
 * @example
 * ```typescript
 * shouldServeDotfile('/.env', 'deny');   // Returns false
 * shouldServeDotfile('/.env', 'allow');  // Returns true
 * shouldServeDotfile('/app.js', 'deny'); // Returns true (not a dotfile)
 * ```
 */
export function shouldServeDotfile(
  filePath: string,
  dotfiles: "allow" | "deny" | "ignore",
): boolean {
  // Check if any part of the path is a dotfile
  const pathParts = filePath.split("/").filter((part) => part !== "");
  const isDotfile = pathParts.some((part) => part.startsWith("."));

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

/**
 * Handles directory requests by looking for index files.
 *
 * When a directory is requested, searches for configured index files
 * (like index.html) to serve instead of showing directory contents.
 *
 * @param filePath - The directory path being requested
 * @param indexFiles - Array of index filenames to search for
 * @returns Object containing the found index file path and stats, if any
 *
 * @example
 * ```typescript
 * const { indexPath, indexStats } = await handleDirectoryRequest(
 *   '/var/www/app',
 *   ['index.html', 'index.htm']
 * );
 * if (indexPath) {
 *   // Serve the index file instead of directory listing
 * }
 * ```
 */
export async function handleDirectoryRequest(
  filePath: string,
  indexFiles: string[],
): Promise<{ indexPath?: string; indexStats?: Stats }> {
  for (const indexFile of indexFiles) {
    const indexPath = resolve(filePath, indexFile);
    try {
      const indexStats = await stat(indexPath);
      if (indexStats.isFile()) {
        return { indexPath, indexStats };
      }
    } catch {}
  }
  return {};
}
