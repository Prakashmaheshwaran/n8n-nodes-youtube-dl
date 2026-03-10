/**
 * Lightweight yt-dlp wrapper. Finds the binary (bundled or system)
 * and provides typed helpers for metadata + downloads.
 *
 * If no binary is found at call time, it auto-downloads the correct
 * standalone build from GitHub — so the node is truly plug-and-play
 * even when postinstall didn't run (Docker, pnpm, etc.).
 *
 * Alpine Linux (musl): The glibc-linked standalone binary won't run
 * without `gcompat`. We detect this and provide clear instructions.
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

function isAlpine(): boolean {
  try {
    return fs.existsSync('/etc/alpine-release');
  } catch {
    return false;
  }
}

function isMusl(): boolean {
  if (process.platform !== 'linux') return false;
  try {
    // Check if ldd points to musl
    const out = execFileSync('ldd', ['--version'], {
      timeout: 5_000,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return out.toLowerCase().includes('musl');
  } catch (e: any) {
    // musl's ldd prints to stderr and exits with error
    const stderr = e?.stderr?.toString() || '';
    return stderr.toLowerCase().includes('musl');
  }
}

function hasGcompat(): boolean {
  try {
    return fs.existsSync('/lib/ld-linux-x86-64.so.2') ||
           fs.existsSync('/lib64/ld-linux-x86-64.so.2');
  } catch {
    return false;
  }
}

function hasPython3(): boolean {
  try {
    const out = execFileSync('python3', ['--version'], {
      timeout: 5_000,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.includes('3.');
  } catch {
    return false;
  }
}

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

  // 2. Check all candidate directories for a working binary
  for (const dir of getCandidateDirs()) {
    const candidate = path.join(dir, fname);
    if (fs.existsSync(candidate) && testBinary(candidate)) return candidate;
  }

  // 3. Check for zipapp + Python
  if (hasPython3()) {
    for (const dir of getCandidateDirs()) {
      const zipapp = path.join(dir, 'yt-dlp-zipapp');
      if (fs.existsSync(zipapp) && testBinary(zipapp)) return zipapp;
    }
  }

  // 4. System yt-dlp on PATH
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

/** Try to download and install the standalone binary */
async function tryStandalone(fname: string): Promise<string | null> {
  const name = getStandaloneName();
  if (!name) return null;

  const url = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${name}`;

  for (const dir of getCandidateDirs()) {
    try {
      fs.mkdirSync(dir, { recursive: true });

      // Quick write test
      const wt = path.join(dir, '.write-test');
      fs.writeFileSync(wt, 'ok');
      fs.unlinkSync(wt);

      const dest = path.join(dir, fname);
      const buffer = await httpsGet(url);
      fs.writeFileSync(dest, buffer);

      if (process.platform !== 'win32') {
        fs.chmodSync(dest, 0o755);
      }

      if (testBinary(dest)) return dest;

      // Didn't work — clean up
      try { fs.unlinkSync(dest); } catch { /* ignore */ }
    } catch {
      // Not writable or download failed — try next dir
    }
  }

  return null;
}

/** Try to download the Python zipapp (needs Python 3.8+) */
async function tryZipapp(): Promise<string | null> {
  if (!hasPython3()) return null;

  const url = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp';

  for (const dir of getCandidateDirs()) {
    try {
      fs.mkdirSync(dir, { recursive: true });

      const wt = path.join(dir, '.write-test');
      fs.writeFileSync(wt, 'ok');
      fs.unlinkSync(wt);

      const dest = path.join(dir, 'yt-dlp-zipapp');
      const buffer = await httpsGet(url);
      fs.writeFileSync(dest, buffer);
      fs.chmodSync(dest, 0o755);

      if (testBinary(dest)) return dest;

      try { fs.unlinkSync(dest); } catch { /* ignore */ }
    } catch {
      // try next dir
    }
  }

  return null;
}

/** Try to install via pip */
async function tryPipInstall(): Promise<string | null> {
  if (!hasPython3()) return null;

  try {
    execFileSync('pip3', ['install', '--user', 'yt-dlp'], {
      timeout: 120_000,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (testBinary('yt-dlp')) return 'yt-dlp';

    // Check common pip --user bin paths
    const userBin = path.join(os.homedir(), '.local', 'bin', 'yt-dlp');
    if (fs.existsSync(userBin) && testBinary(userBin)) return userBin;
  } catch {
    // pip not available or install failed
  }

  return null;
}

async function downloadBinary(): Promise<string> {
  const fname = binaryFilename();
  const alpine = isAlpine();
  const musl = isMusl();
  const diagnostics: string[] = [];

  // Strategy 1: Standalone binary (works on glibc Linux, macOS, Windows)
  diagnostics.push('Trying standalone binary...');
  const standalone = await tryStandalone(fname);
  if (standalone) return standalone;

  if (musl || alpine) {
    diagnostics.push('Standalone binary failed (Alpine/musl detected — needs gcompat).');
  } else {
    diagnostics.push('Standalone binary failed.');
  }

  // Strategy 2: Python zipapp (works if Python 3.8+ available)
  diagnostics.push('Trying Python zipapp...');
  const zipapp = await tryZipapp();
  if (zipapp) return zipapp;
  diagnostics.push(hasPython3() ? 'Zipapp failed.' : 'No Python3 found, skipping zipapp.');

  // Strategy 3: pip install (works if pip available)
  diagnostics.push('Trying pip3 install...');
  const pip = await tryPipInstall();
  if (pip) return pip;
  diagnostics.push('pip install failed or unavailable.');

  // ── Build a helpful error message ─────────────────────────
  const isDocker = fs.existsSync('/.dockerenv') ||
    ((): boolean => { try { return fs.readFileSync('/proc/1/cgroup', 'utf-8').includes('docker'); } catch { return false; } })();

  let errorMsg = 'yt-dlp binary could not be installed automatically.\n\n';
  errorMsg += `Platform: ${process.platform}/${process.arch}`;
  if (alpine) errorMsg += ' (Alpine Linux)';
  if (musl) errorMsg += ' (musl libc)';
  if (isDocker) errorMsg += ' (Docker)';
  errorMsg += '\n';
  errorMsg += `Diagnostics: ${diagnostics.join(' ')}\n\n`;

  if ((alpine || musl) && isDocker) {
    errorMsg += '═══ FIX FOR DOCKER (Alpine) ═══\n';
    errorMsg += 'Run this command on your host machine:\n\n';
    errorMsg += '  docker exec -u root <CONTAINER> apk add --no-cache gcompat\n';
    errorMsg += '  docker restart <CONTAINER>\n\n';
    errorMsg += 'For a permanent fix, use a custom Dockerfile:\n\n';
    errorMsg += '  FROM n8nio/n8n:latest\n';
    errorMsg += '  USER root\n';
    errorMsg += '  RUN apk add --no-cache gcompat\n';
    errorMsg += '  USER node\n\n';
    errorMsg += 'Then rebuild: docker compose build && docker compose up -d\n';
  } else if (alpine || musl) {
    errorMsg += '═══ FIX FOR ALPINE LINUX ═══\n';
    errorMsg += 'Install gcompat: sudo apk add --no-cache gcompat\n';
    errorMsg += 'Then restart n8n.\n';
  } else if (isDocker) {
    errorMsg += '═══ FIX FOR DOCKER ═══\n';
    errorMsg += 'Install yt-dlp in your container:\n';
    errorMsg += '  docker exec -u root <CONTAINER> apt-get update && apt-get install -y yt-dlp\n';
    errorMsg += 'Or add it to your Dockerfile.\n';
  } else {
    errorMsg += '═══ HOW TO FIX ═══\n';
    errorMsg += 'Option 1: Install yt-dlp (https://github.com/yt-dlp/yt-dlp#installation)\n';
    errorMsg += 'Option 2: Set YT_DLP_PATH=/path/to/yt-dlp environment variable\n';
  }

  throw new Error(errorMsg);
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
