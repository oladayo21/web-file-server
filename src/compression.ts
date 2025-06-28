import type { Stats } from "node:fs";
import { stat } from "node:fs/promises";
import { sanitizeHeader } from "./http-utils.js";

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

  if (!acceptEncoding || !precompressed) {
    return { finalFilePath: filePath };
  }

  // Get all preferred encodings in order of preference
  const preferredEncodings = parseAcceptEncodingMultiple(acceptEncoding, supportedEncodings);

  // Try each encoding in order of preference
  for (const encoding of preferredEncodings) {
    const precompressedPath = await findPrecompressedFile(filePath, encoding);
    if (precompressedPath) {
      try {
        const fileStats = await stat(precompressedPath);
        return {
          finalFilePath: precompressedPath,
          contentEncoding: encoding,
          fileStats,
        };
      } catch {}
    }
  }

  return { finalFilePath: filePath };
}

// Helper function to get all preferred encodings in order
function parseAcceptEncodingMultiple(
  acceptEncoding: string | null,
  supportedEncodings: string[],
): string[] {
  if (!acceptEncoding) return [];

  // Parse Accept-Encoding header with quality values
  const encodings = acceptEncoding
    .split(",")
    .map((enc) => {
      const [encoding, q] = enc.trim().split(";");
      let quality = 1;
      if (q) {
        const qValue = parseFloat(q.replace(/q\s*=\s*/, ""));
        if (!Number.isNaN(qValue)) {
          quality = qValue;
        }
      }
      return { encoding: encoding.trim(), quality };
    })
    .filter((enc) => enc.quality > 0)
    .sort((a, b) => b.quality - a.quality);

  // Return all supported encodings in order of preference
  const result: string[] = [];
  for (const { encoding } of encodings) {
    if (supportedEncodings.includes(encoding) && !result.includes(encoding)) {
      result.push(encoding);
    }
  }

  return result;
}
