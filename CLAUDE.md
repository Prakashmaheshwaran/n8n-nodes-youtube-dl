# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run build          # Compile TypeScript + copy icons to dist (runs before publish)
npm run dev            # Watch mode TypeScript compilation
npm run lint           # ESLint with auto-fix on nodes/**/*.ts
npm run format         # Prettier format on nodes/ directory
```

There are no tests in this project.

## Architecture

This is an **n8n community node package** with two source directories:

- `nodes/YouTubeDL/` — The n8n node
- `credentials/` — Cookie-based authentication credential

### Two-file node design

**`YouTubeDL.node.ts`** is the UI/UX layer: n8n parameter definitions, operation dispatch, output formatting, and error handling. It implements five operations: Download Video, Download Audio, Get Video Info, Get Transcript, Download Subtitles.

**`ytdlp.ts`** is the core business logic: yt-dlp binary management, subprocess execution, platform detection. This file is intentionally self-contained with zero npm dependencies.

### Binary management in ytdlp.ts

The wrapper auto-downloads the correct `yt-dlp` binary from GitHub releases at runtime. Download uses curl → wget → Node.js https fallbacks. The binary path is cached and can be overridden via `YT_DLP_PATH`.

**Alpine/musl compatibility** is the most complex part: Python 3.13 PyInstaller binaries fail on musl libc (Alpine Linux, common in Docker) due to a missing `posix_fallocate64` symbol. The solution is an embedded compiled shim (tiny `.so` files, base64-encoded directly in `ytdlp.ts`) that is written to disk and injected via `LD_PRELOAD`. This requires no root access and no gcompat. Do not remove or simplify this mechanism without understanding the Alpine Docker use case.

### Output format convention

- **Downloads** (video/audio/subtitles): Returns n8n binary data via `prepareBinaryData` with file streams — never buffer entire files in memory.
- **Metadata/transcript**: Returns JSON in `json` field of the output item.

### Build output

TypeScript compiles to `dist/`. The `gulp build:icons` step copies `*.svg` from `nodes/` to `dist/nodes/`. The `n8n` field in `package.json` points to compiled paths under `dist/`.
