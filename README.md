# @foladayo/web-file-server

A Node.js static file server that uses web standard Request/Response objects. Compatible with any server that supports web standards.

## Installation

```bash
npm install @foladayo/web-file-server
```

## Quick Start

```typescript
import { createFileServer } from '@foladayo/web-file-server';

const handler = createFileServer({
  root: '/path/to/public'
});

// Takes a web Request, returns a web Response
const request = new Request('http://localhost/index.html');
const response = await handler(request);

console.log(response.status);    // 200
console.log(response.headers);   // Headers object
const content = await response.text(); // File content
```

## Configuration

```typescript
interface FileServerOptions {
  root: string;                              // Required: root directory
  index?: string[];                          // Default: ['index.html']
  dotfiles?: 'allow' | 'deny' | 'ignore';   // Default: 'ignore'
  headers?: Record<string, string>;          // Additional headers
  streaming?: boolean;                       // Default: true
  etag?: boolean | 'strong' | 'weak';       // Default: true (weak)
  compression?: boolean | string[];          // Default: true (['br', 'gzip', 'deflate'])
  precompressed?: boolean;                   // Default: true
  cacheControl?: string | Record<string, string>; // Cache-Control rules
}
```

### Examples

**Basic serving:**
```typescript
const handler = createFileServer({
  root: './public'
});
```

**Custom headers and caching:**
```typescript
const handler = createFileServer({
  root: './public',
  headers: {
    'X-Powered-By': 'My App'
  },
  cacheControl: {
    '\\.js$': 'max-age=31536000', // Cache JS files for 1 year
    '\\.css$': 'max-age=31536000',
    '\\.html$': 'no-cache'
  }
});
```

**Allow dotfiles with custom index:**
```typescript
const handler = createFileServer({
  root: './public',
  dotfiles: 'allow',
  index: ['index.html', 'index.htm', 'default.html']
});
```

**Disable compression and streaming:**
```typescript
const handler = createFileServer({
  root: './public',
  compression: false,
  streaming: false
});
```

## Features

- **Web standards**: Uses Request/Response objects for easy integration
- **Streaming responses**: Memory-efficient file serving
- **Range requests**: Supports partial content (HTTP 206)
- **Compression**: Automatic brotli/gzip/deflate with pre-compressed file support
- **ETags**: Efficient caching with weak/strong ETag options
- **Security**: Path traversal protection, symlink blocking, dotfile policies
- **Performance**: Conditional requests (304 Not Modified), streaming by default


## License

MIT