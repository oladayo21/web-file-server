# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a platform-agnostic static file server library built with TypeScript that uses web standards (Request/Response) for maximum compatibility. The library exports a `createFileServer` function that returns a handler compatible with any JavaScript runtime supporting web standards.

## Build and Development Commands

- `pnpm build` - Build the library for production using tsup
- `pnpm dev` - Start development mode with file watching
- `pnpm test` - Run tests in watch mode
- `pnpm test:run` - Run tests once
- `pnpm test:coverage` - Run tests with coverage report
- `pnpm test:ui` - Run tests with UI interface
- `pnpm check` - Run Biome linting and formatting checks
- `pnpm check:fix` - Auto-fix linting and formatting issues
- `pnpm lint` / `pnpm lint:fix` - Run only linting checks/fixes
- `pnpm format` / `pnpm format:fix` - Run only formatting checks/fixes

## Implementation Status

**Features Implemented**:

- ✅ Core static file serving with web standards (Request/Response)
- ✅ HTTP standards compliance (range requests, caching, compression)
- ✅ Performance optimization and error handling
- ✅ Comprehensive test suite with coverage
- ✅ TypeScript with strict configuration
- ✅ CI/CD pipeline with GitHub Actions
- ✅ Published as `@foladayo/web-file-server`

## Pre-commit Requirements

Before committing and pushing changes, always run:

1. `pnpm test:run` - Ensure all tests pass
2. `pnpm check:fix` - Fix all linting and formatting issues
3. `pnpm build` - Ensure the build succeeds

The CI pipeline will automatically run these checks on pull requests and pushes.

## Architecture

The library follows a minimal, functional design with modular components:

- **Entry Point**: `src/index.ts` - Exports the main `createFileServer` function and types
- **Core Modules**:
  - `src/response.ts` - Response utilities and status handling
  - `src/fs-utils.ts` - File system operations and safety checks
  - `src/http-utils.ts` - HTTP headers, caching, and range request handling
  - `src/content-utils.ts` - MIME type detection and content processing
  - `src/compression.ts` - Gzip/Brotli compression support
  - `src/validators.ts` - Input validation and security checks
- **Core Types**:
  - `FileServerOptions` - Configuration interface for server behavior
  - `FileServerHandler` - Function type that matches web standard Request/Response pattern
- **Build Target**: ES2022 modules with TypeScript declarations
- **Output**: Single ESM bundle in `dist/` directory

The design is intentionally minimal to maximize compatibility across different JavaScript runtimes (Node.js, Deno, Bun, Cloudflare Workers, etc.).

## Code Standards

- Uses Biome for linting and formatting with double quotes and semicolons
- Follows strict TypeScript configuration
- ESM-only module format
- Web standards-first approach (Request/Response objects)
- Platform-agnostic design principles

## Package Configuration

This is published as `@foladayo/web-file-server` with:

- Main entry: `dist/index.js` (ESM)
- Types: `dist/index.d.ts`
- Exports only the `dist/` directory
- No runtime dependencies
- Comprehensive test suite with Vitest
- GitHub Actions CI/CD pipeline
- Reproducible builds with committed `pnpm-lock.yaml`
