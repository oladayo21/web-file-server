export interface FileServerOptions {
  root: string;
  index?: string[];
  dotfiles?: "allow" | "deny" | "ignore";
  headers?: Record<string, string>;
}

export type FileServerHandler = (request: Request) => Promise<Response>;

export function createFileServer(options: FileServerOptions): FileServerHandler {
  // Implementation to be added
  return async (request: Request): Promise<Response> => {
    return new Response("Not implemented", { status: 501 });
  };
}

export default createFileServer;
