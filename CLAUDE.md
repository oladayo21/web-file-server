# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a platform-agnostic static file server library built with TypeScript that uses web standards (Request/Response) for maximum compatibility. The library exports a `createFileServer` function that returns a handler compatible with any JavaScript runtime supporting web standards.

## Build and Development Commands

- `pnpm build` - Build the library for production using tsup
- `pnpm dev` - Start development mode with file watching
- `pnpm check` - Run Biome linting and formatting checks
- `pnpm check:fix` - Auto-fix linting and formatting issues
- `pnpm lint` / `pnpm lint:fix` - Run only linting checks/fixes
- `pnpm format` / `pnpm format:fix` - Run only formatting checks/fixes

## Implementation Status

**Current Status**: ✅ **Phase 3 Complete** - Ready for Phase 4  
**Last Commit**: `ad462d4` - Complete Phases 1-3: Full-featured static file server

This project follows a **phase-by-phase collaborative implementation approach**. See `PROJECT_STATUS.md` for current progress and `IMPLEMENTATION_PLAN.md` for the complete roadmap. Each phase must be completed and reviewed before proceeding to the next.

**What's Done**: Core serving, HTTP standards compliance, performance optimization  
**What's Next**: Directory listings, CORS, custom error pages (Phase 4)

## Pre-commit Requirements

Before committing and pushing changes, always run:
1. `pnpm check:fix` - Fix all linting and formatting issues
2. `pnpm build` - Ensure the build succeeds

## Architecture

The library follows a minimal, functional design:

- **Entry Point**: `src/index.ts` - Exports the main `createFileServer` function and types
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