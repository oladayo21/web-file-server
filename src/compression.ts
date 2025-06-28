import type { Stats } from "node:fs";
import { stat } from "node:fs/promises";
import { parseAcceptEncoding, sanitizeHeader } from "./http-utils.js";

/**
 * Finds a pre-compressed version of a file for the given encoding.
 * 
 * Looks for files with compression-specific extensions (.br, .gz)
 * to serve pre-compressed content when available.
 * 
 * @param filePath - The original file path to find a compressed version for
 * @param encoding - The compression encoding to look for (br, gzip, deflate)
 * @returns Promise resolving to the compressed file path, or null if not found
 * 
 * @example
 * ```typescript
 * const compressed = await findPrecompressedFile('/public/app.js', 'br');
 * // Returns '/public/app.js.br' if it exists, null otherwise
 * ```
 */
export async function findPrecompressedFile(
  filePath: string,
  encoding: string,
): Promise<string | null> {
  // Mapping of compression algorithms to file extensions
  const extensions: Record<string, string> = {
    br: ".br",
    gzip: ".gz",
    deflate: ".gz", // deflate uses same .gz extension as gzip
  };

  const ext = extensions[encoding];
  if (!ext) return null;

  const compressedPath = `${filePath}${ext}`;

  try {
    await stat(compressedPath);
    return compressedPath;
  } catch {
    return null;
  }
}

/**
 * Handles content compression by finding the best pre-compressed file.
 * 
 * Analyzes the client's Accept-Encoding header and attempts to serve
 * a pre-compressed version of the requested file if available.
 * 
 * @param filePath - The original file path being served
 * @param request - The HTTP request containing Accept-Encoding header
 * @param supportedEncodings - List of compression algorithms the server supports
 * @param precompressed - Whether to look for pre-compressed files
 * @returns Promise resolving to file info with optional compression details
 * 
 * @example
 * ```typescript
 * const result = await handleCompression(
 *   '/public/app.js',
 *   request,
 *   ['br', 'gzip'],
 *   true
 * );
 * // Might return: { finalFilePath: '/public/app.js.br', contentEncoding: 'br' }
 * ```
 */
export async function handleCompression(
  filePath: string,
  request: Request,
  supportedEncodings: string[],
  precompressed: boolean,
): Promise<{ finalFilePath: string; contentEncoding?: string; fileStats?: Stats }> {
  if (supportedEncodings.length === 0) {
    return { finalFilePath: filePath };
  }

  const acceptEncoding = sanitizeHeader(request.headers.get("accept-encoding"));
  const preferredEncoding = parseAcceptEncoding(acceptEncoding, supportedEncodings);

  if (!preferredEncoding || !precompressed) {
    return { finalFilePath: filePath };
  }

  const precompressedPath = await findPrecompressedFile(filePath, preferredEncoding);
  if (!precompressedPath) {
    return { finalFilePath: filePath };
  }

  try {
    const fileStats = await stat(precompressedPath);
    return {
      finalFilePath: precompressedPath,
      contentEncoding: preferredEncoding,
      fileStats,
    };
  } catch {
    return { finalFilePath: filePath };
  }
}
