import type { Stats } from "node:fs";
import { open } from "node:fs/promises";
import type { parseRange } from "./http-utils.js";

/**
 * Creates a streaming HTTP response for efficient file serving.
 * 
 * Uses ReadableStream to serve files without loading them entirely into memory,
 * making it suitable for large files and better server memory usage.
 * 
 * @param filePath - Path to the file to serve
 * @param rangeRequest - Parsed range request info, or null for full file
 * @param fileStats - File statistics (used for calculating positions)
 * @param isHeadRequest - Whether this is a HEAD request (no body)
 * @param status - HTTP status code for the response
 * @param headers - HTTP headers to include in the response
 * @returns Promise resolving to a streaming Response
 * 
 * @example
 * ```typescript
 * const response = await createStreamingResponse(
 *   '/var/www/large-video.mp4',
 *   rangeRequest,
 *   fileStats,
 *   false,
 *   206,
 *   headers
 * );
 * ```
 */
export async function createStreamingResponse(
  filePath: string,
  rangeRequest: ReturnType<typeof parseRange>,
  fileStats: Stats,
  isHeadRequest: boolean,
  status: number,
  headers: Headers,
): Promise<Response> {
  const fileHandle = await open(filePath, "r");
  // 64KB chunks provide good balance between memory usage and I/O efficiency
  const chunkSize = 64 * 1024;

  const startPos = rangeRequest ? rangeRequest.start : 0;
  const endPos = rangeRequest ? rangeRequest.end : fileStats.size - 1;
  const totalToRead = endPos - startPos + 1;

  const webStream = new ReadableStream({
    async start(controller) {
      try {
        let position = startPos;
        let bytesRemaining = totalToRead;
        const buffer = new Uint8Array(chunkSize);

        while (bytesRemaining > 0) {
          const bytesToRead = Math.min(chunkSize, bytesRemaining);
          const { bytesRead } = await fileHandle.read(buffer, 0, bytesToRead, position);

          if (bytesRead === 0) break;

          controller.enqueue(buffer.slice(0, bytesRead));
          position += bytesRead;
          bytesRemaining -= bytesRead;
        }

        controller.close();
      } catch (error) {
        controller.error(error);
      } finally {
        await fileHandle.close();
      }
    },

    async cancel() {
      await fileHandle.close();
    },
  });

  return new Response(isHeadRequest ? null : webStream, { status, headers });
}

/**
 * Creates a buffered HTTP response by loading the entire file into memory.
 * 
 * More suitable for smaller files where the memory usage is acceptable
 * and the simplicity of buffered reading is preferred over streaming.
 * 
 * @param filePath - Path to the file to serve
 * @param rangeRequest - Parsed range request info, or null for full file
 * @param isHeadRequest - Whether this is a HEAD request (no body)
 * @param status - HTTP status code for the response
 * @param headers - HTTP headers to include in the response
 * @returns Promise resolving to a buffered Response
 * 
 * @example
 * ```typescript
 * const response = await createBufferedResponse(
 *   '/var/www/small-image.png',
 *   null, // Full file
 *   false,
 *   200,
 *   headers
 * );
 * ```
 */
export async function createBufferedResponse(
  filePath: string,
  rangeRequest: ReturnType<typeof parseRange>,
  isHeadRequest: boolean,
  status: number,
  headers: Headers,
): Promise<Response> {
  const { readFile } = await import("node:fs/promises");

  if (rangeRequest) {
    const fileHandle = await open(filePath, "r");
    const buffer = new Uint8Array(rangeRequest.contentLength);
    await fileHandle.read(buffer, 0, rangeRequest.contentLength, rangeRequest.start);
    await fileHandle.close();

    return new Response(isHeadRequest ? null : buffer, { status, headers });
  }

  const fileContent = await readFile(filePath);
  return new Response(isHeadRequest ? null : fileContent, { status, headers });
}
