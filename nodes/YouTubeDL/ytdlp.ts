/**
 * Lightweight yt-dlp wrapper. Finds the binary (bundled or system)
 * and provides typed helpers for metadata + downloads.
 *
 * If no binary is found at call time, it auto-downloads the correct
 * standalone build from GitHub — so the node is truly plug-and-play
 * even when postinstall didn't run (Docker, pnpm, etc.).
 */

import { execFile, execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as https from 'https';

// ── Binary search paths ─────────────────────────────────────

const PACKAGE_ROOT = path.resolve(__dirname, '..', '..', '..');
const BIN_DIR = path.join(PACKAGE_ROOT, 'bin');

/** Extra locations to look for / install the binary */
function getCandidateDirs(): string[] {
  const dirs = [BIN_DIR];

  // n8n data directory (writable in Docker)
  const n8nDir = process.env.N8N_USER_FOLDER || path.join(os.homedir(), '.n8n');
  dirs.push(path.join(n8nDir, 'ytdlp'));

  // Temp directory (always writable)
  dirs.push(path.join(os.tmpdir(), 'ytdlp'));

  return dirs;
}

// ── Platform helpers ────────────────────────────────────────

function getStandaloneName(): string | null {
  const p = process.platform;
  const a = process.arch;
  if (p === 'linux') return a === 'arm64' ? 'yt-dlp_linux_aarch64' : 'yt-dlp_linux';
  if (p === 'darwin') return 'yt-dlp_macos';
  if (p === 'win32') return 'yt-dlp.exe';
  return null;
}

function binaryFilename(): string {
  return process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
}

// ── Binary resolution ───────────────────────────────────────

function testBinary(binPath: string): boolean {
  try {
    const out = execFileSync(binPath, ['--version'], {
      timeout: 15_000,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.trim().length > 0;
  } catch {
    return false;
  }
}

function findExistingBinary(): string | null {
  // 1. Environment variable
  if (process.env.YT_DLP_PATH && fs.existsSync(process.env.YT_DLP_PATH)) {
    return process.env.YT_DLP_PATH;
  }

  const fname = binaryFilename();

  // 2. Check all candidate directories
  for (const dir of getCandidateDirs()) {
    const candidate = path.join(dir, fname);
    if (fs.existsSync(candidate)) return candidate;
  }

  // 3. System yt-dlp on PATH
  if (testBinary('yt-dlp')) return 'yt-dlp';

  return null;
}

// ── Runtime download ────────────────────────────────────────

function httpsGet(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const request = (u: string, redirects = 0) => {
      if (redirects > 5) { reject(new Error('Too many redirects')); return; }
      https.get(u, { headers: { 'User-Agent': 'n8n-nodes-youtube-dl' } }, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          request(res.headers.location, redirects + 1);
          return;
        }
        if (!res.statusCode || res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode} downloading yt-dlp`));
          return;
        }
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
      }).on('error', reject);
    };
    request(url);
  });
}

async function downloadBinary(): Promise<string> {
  const name = getStandaloneName();
  if (!name) {
    throw new Error(
      `Unsupported platform: ${process.platform}/${process.arch}. ` +
        'Install yt-dlp manually and set YT_DLP_PATH.',
    );
  }

  const url = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${name}`;
  const fname = binaryFilename();

  // Try each candidate directory until one is writable
  for (const dir of getCandidateDirs()) {
    try {
      fs.mkdirSync(dir, { recursive: true });

      // Quick write test
      const testFile = path.join(dir, '.write-test');
      fs.writeFileSync(testFile, 'ok');
      fs.unlinkSync(testFile);

      const dest = path.join(dir, fname);
      const buffer = await httpsGet(url);
      fs.writeFileSync(dest, buffer);

      if (process.platform !== 'win32') {
        fs.chmodSync(dest, 0o755);
      }

      // Verify it actually runs
      if (testBinary(dest)) {
        return dest;
      }

      // Binary doesn't run (e.g. Alpine/musl) — clean up and try next
      try { fs.unlinkSync(dest); } catch { /* ignore */ }
    } catch {
      // Directory not writable or download failed — try next
    }
  }

  throw new Error(
    'Failed to download yt-dlp binary. Possible causes:\n' +
      '  • No internet access from this environment\n' +
      '  • Alpine Linux (install gcompat: apk add gcompat)\n' +
      '  • All candidate directories are read-only\n' +
      'Fix: install yt-dlp manually (pip install yt-dlp, or apk add yt-dlp)\n' +
      'and set the YT_DLP_PATH environment variable.',
  );
}

// ── Cached binary with auto-download ────────────────────────

let cachedBinary: string | null = null;
let ensurePromise: Promise<string> | null = null;

/**
 * Ensures a working yt-dlp binary is available.
 * Downloads one automatically if not found.
 * Safe to call concurrently — only one download happens.
 */
export async function ensureBinary(): Promise<string> {
  if (cachedBinary) return cachedBinary;

  if (!ensurePromise) {
    ensurePromise = (async () => {
      const existing = findExistingBinary();
      if (existing) {
        cachedBinary = existing;
        return existing;
      }

      // Auto-download at runtime
      const downloaded = await downloadBinary();
      cachedBinary = downloaded;
      return downloaded;
    })();
  }

  return ensurePromise;
}

// ── Core executor ───────────────────────────────────────────

export interface ExecResult {
  stdout: string;
  stderr: string;
}

export function runYtDlp(
  bin: string,
  args: string[],
  timeoutMs = 300_000,
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    execFile(
      bin,
      args,
      {
        maxBuffer: 100 * 1024 * 1024, // 100 MB for large JSON
        timeout: timeoutMs,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error) {
          const msg = stderr?.trim() || error.message;
          reject(new Error(msg));
          return;
        }
        resolve({ stdout: stdout || '', stderr: stderr || '' });
      },
    );
  });
}

// ── Typed helpers ───────────────────────────────────────────

/**
 * Get full video metadata as parsed JSON.
 */
export async function getInfo(url: string, extraFlags: string[] = []): Promise<any> {
  const bin = await ensureBinary();
  const { stdout } = await runYtDlp(bin, [
    '--dump-single-json',
    '--no-download',
    '--no-check-certificates',
    '--no-warnings',
    ...extraFlags,
    url,
  ]);
  return JSON.parse(stdout);
}

/**
 * Download a video/audio to the specified output path template.
 * Use `%(ext)s` in the output path for auto-extension.
 */
export async function download(
  url: string,
  outputTemplate: string,
  extraFlags: string[] = [],
  timeoutMs = 600_000,
): Promise<void> {
  const bin = await ensureBinary();
  await runYtDlp(
    bin,
    [
      '--no-check-certificates',
      '--no-warnings',
      '-o',
      outputTemplate,
      ...extraFlags,
      url,
    ],
    timeoutMs,
  );
}
