/**
 * Lightweight yt-dlp wrapper — truly plug-and-play.
 *
 * Binary resolution order:
 *   1. YT_DLP_PATH environment variable
 *   2. Previously downloaded binary in candidate dirs
 *   3. System yt-dlp on PATH
 *   4. Auto-download from GitHub (curl → wget → Node https)
 *
 * Download tries multiple methods because Docker containers
 * have varying tool availability and TLS configurations.
 */

import { execFile, execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as https from 'https';

// ── Constants ───────────────────────────────────────────────

const PACKAGE_ROOT = path.resolve(__dirname, '..', '..', '..');
const BIN_DIR = path.join(PACKAGE_ROOT, 'bin');
const RELEASE_URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download';

// ── Candidate directories ───────────────────────────────────

function getCandidateDirs(): string[] {
  const dirs: string[] = [];

  // 1. Package bin/ directory
  dirs.push(BIN_DIR);

  // 2. n8n data directory (writable in Docker — persists across restarts)
  const n8nDir = process.env.N8N_USER_FOLDER || path.join(os.homedir(), '.n8n');
  dirs.push(path.join(n8nDir, 'ytdlp'));

  // 3. Home directory bin (common for --user installs)
  dirs.push(path.join(os.homedir(), '.local', 'bin'));

  // 4. Temp directory (always writable, but doesn't persist)
  dirs.push(path.join(os.tmpdir(), 'ytdlp'));

  return dirs;
}

// ── Platform detection ──────────────────────────────────────

function isAlpine(): boolean {
  try { return fs.existsSync('/etc/alpine-release'); } catch { return false; }
}

function isMusl(): boolean {
  if (process.platform !== 'linux') return false;
  try {
    const out = execFileSync('ldd', ['--version'], {
      timeout: 5_000, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    return out.toLowerCase().includes('musl');
  } catch (e: any) {
    const stderr = e?.stderr?.toString() || '';
    return stderr.toLowerCase().includes('musl');
  }
}

function isDocker(): boolean {
  if (fs.existsSync('/.dockerenv')) return true;
  try { return fs.readFileSync('/proc/1/cgroup', 'utf-8').includes('docker'); } catch { return false; }
}

function hasCurl(): boolean {
  try { execFileSync('curl', ['--version'], { timeout: 5_000, stdio: 'ignore' }); return true; } catch { return false; }
}

function hasWget(): boolean {
  try { execFileSync('wget', ['--version'], { timeout: 5_000, stdio: 'ignore' }); return true; } catch { return false; }
}

function hasPython3(): boolean {
  try {
    const out = execFileSync('python3', ['--version'], {
      timeout: 5_000, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.includes('3.');
  } catch { return false; }
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

// ── Binary testing ──────────────────────────────────────────

function testBinary(binPath: string): { ok: boolean; error?: string } {
  try {
    const out = execFileSync(binPath, ['--version'], {
      timeout: 15_000, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (out.trim().length > 0) return { ok: true };
    return { ok: false, error: 'Empty version output' };
  } catch (e: any) {
    const msg = e?.stderr?.toString()?.trim() || e?.message || String(e);
    return { ok: false, error: msg.slice(0, 200) };
  }
}

// ── Find existing binary ────────────────────────────────────

function findExistingBinary(): string | null {
  // 1. Environment variable
  if (process.env.YT_DLP_PATH) {
    if (fs.existsSync(process.env.YT_DLP_PATH) && testBinary(process.env.YT_DLP_PATH).ok) {
      return process.env.YT_DLP_PATH;
    }
  }

  const fname = binaryFilename();

  // 2. Candidate directories — standalone binary
  for (const dir of getCandidateDirs()) {
    const p = path.join(dir, fname);
    if (fs.existsSync(p) && testBinary(p).ok) return p;
  }

  // 3. Candidate directories — zipapp
  for (const dir of getCandidateDirs()) {
    const p = path.join(dir, 'yt-dlp-zipapp');
    if (fs.existsSync(p) && testBinary(p).ok) return p;
  }

  // 4. System yt-dlp on PATH
  if (testBinary('yt-dlp').ok) return 'yt-dlp';

  return null;
}

// ── Download methods ────────────────────────────────────────

/** Download with curl (most reliable in Docker — handles redirects, TLS, proxies) */
function downloadWithCurl(url: string, dest: string): void {
  execFileSync('curl', ['-fsSL', '--connect-timeout', '30', '-o', dest, url], {
    timeout: 120_000,
    stdio: ['ignore', 'ignore', 'pipe'],
  });
}

/** Download with wget (available in Alpine by default) */
function downloadWithWget(url: string, dest: string): void {
  execFileSync('wget', ['-q', '-O', dest, url], {
    timeout: 120_000,
    stdio: ['ignore', 'ignore', 'pipe'],
  });
}

/** Download with Node.js https (no external deps needed) */
function downloadWithHttps(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const request = (u: string, redirects = 0) => {
      if (redirects > 10) { reject(new Error('Too many redirects')); return; }
      https.get(u, { headers: { 'User-Agent': 'n8n-nodes-youtube-dl/2.x' } }, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          request(res.headers.location, redirects + 1);
          return;
        }
        if (!res.statusCode || res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}`));
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

/**
 * Download a file using the best available method.
 * Tries curl → wget → Node https. Returns detailed error on failure.
 */
async function downloadFile(url: string, dest: string): Promise<{ ok: true } | { ok: false; errors: string[] }> {
  const errors: string[] = [];

  // Method 1: curl (most reliable in Docker)
  if (hasCurl()) {
    try {
      downloadWithCurl(url, dest);
      if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return { ok: true };
      errors.push('curl: downloaded but file is empty');
    } catch (e: any) {
      errors.push(`curl: ${(e?.stderr?.toString() || e?.message || String(e)).trim().slice(0, 150)}`);
    }
  } else {
    errors.push('curl: not available');
  }

  // Method 2: wget (default on Alpine)
  if (hasWget()) {
    try {
      downloadWithWget(url, dest);
      if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return { ok: true };
      errors.push('wget: downloaded but file is empty');
    } catch (e: any) {
      errors.push(`wget: ${(e?.stderr?.toString() || e?.message || String(e)).trim().slice(0, 150)}`);
    }
  } else {
    errors.push('wget: not available');
  }

  // Method 3: Node.js https
  try {
    const buffer = await downloadWithHttps(url);
    if (buffer.length > 0) {
      fs.writeFileSync(dest, buffer);
      return { ok: true };
    }
    errors.push('node-https: downloaded but buffer is empty');
  } catch (e: any) {
    errors.push(`node-https: ${(e?.message || String(e)).trim().slice(0, 150)}`);
  }

  return { ok: false, errors };
}

// ── Directory helpers ───────────────────────────────────────

function isWritableDir(dir: string): boolean {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const t = path.join(dir, '.write-test-' + process.pid);
    fs.writeFileSync(t, 'ok');
    fs.unlinkSync(t);
    return true;
  } catch {
    return false;
  }
}

function isExecutableDir(dir: string): boolean {
  // Check if we can execute from this directory (some /tmp mounts have noexec)
  if (process.platform === 'win32') return true;
  try {
    const testScript = path.join(dir, '.exec-test-' + process.pid);
    fs.writeFileSync(testScript, '#!/bin/sh\necho ok\n');
    fs.chmodSync(testScript, 0o755);
    const out = execFileSync(testScript, [], {
      timeout: 5_000, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'],
    });
    fs.unlinkSync(testScript);
    return out.trim() === 'ok';
  } catch {
    try { fs.unlinkSync(path.join(dir, '.exec-test-' + process.pid)); } catch { /* ignore */ }
    return false;
  }
}

// ── Main download logic ─────────────────────────────────────

async function downloadBinary(): Promise<string> {
  const fname = binaryFilename();
  const alpine = isAlpine();
  const musl = isMusl();
  const docker = isDocker();
  const diagnostics: string[] = [];

  diagnostics.push(`[env: ${process.platform}/${process.arch}${alpine ? ' alpine' : ''}${musl ? ' musl' : ''}${docker ? ' docker' : ''}]`);

  // ── Strategy 1: Standalone binary ───────────────────────
  const standaloneName = getStandaloneName();
  if (standaloneName) {
    const url = `${RELEASE_URL}/${standaloneName}`;

    for (const dir of getCandidateDirs()) {
      if (!isWritableDir(dir)) {
        diagnostics.push(`[${dir}: not writable]`);
        continue;
      }
      if (!isExecutableDir(dir)) {
        diagnostics.push(`[${dir}: noexec mount]`);
        continue;
      }

      const dest = path.join(dir, fname);
      diagnostics.push(`[downloading standalone to ${dir}]`);

      const dlResult = await downloadFile(url, dest);
      if (!dlResult.ok) {
        diagnostics.push(`[download failed: ${dlResult.errors.join('; ')}]`);
        continue;
      }

      if (process.platform !== 'win32') {
        try { fs.chmodSync(dest, 0o755); } catch { /* ignore */ }
      }

      const runTest = testBinary(dest);
      if (runTest.ok) {
        return dest;
      }

      diagnostics.push(`[binary test failed: ${runTest.error}]`);
      try { fs.unlinkSync(dest); } catch { /* ignore */ }
    }
  }

  // ── Strategy 2: Python zipapp ───────────────────────────
  if (hasPython3()) {
    const url = `${RELEASE_URL}/yt-dlp`;
    for (const dir of getCandidateDirs()) {
      if (!isWritableDir(dir)) continue;

      const dest = path.join(dir, 'yt-dlp-zipapp');
      diagnostics.push(`[downloading zipapp to ${dir}]`);

      const dlResult = await downloadFile(url, dest);
      if (!dlResult.ok) { diagnostics.push(`[zipapp download failed]`); continue; }

      try { fs.chmodSync(dest, 0o755); } catch { /* ignore */ }

      const runTest = testBinary(dest);
      if (runTest.ok) return dest;

      diagnostics.push(`[zipapp test failed: ${runTest.error}]`);
      try { fs.unlinkSync(dest); } catch { /* ignore */ }
    }
  } else {
    diagnostics.push('[no python3]');
  }

  // ── Strategy 3: pip install ─────────────────────────────
  if (hasPython3()) {
    try {
      diagnostics.push('[trying pip3 install --user yt-dlp]');
      execFileSync('pip3', ['install', '--user', '--break-system-packages', 'yt-dlp'], {
        timeout: 120_000, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'],
      });
      if (testBinary('yt-dlp').ok) return 'yt-dlp';
      const userBin = path.join(os.homedir(), '.local', 'bin', 'yt-dlp');
      if (fs.existsSync(userBin) && testBinary(userBin).ok) return userBin;
      diagnostics.push('[pip installed but binary not on PATH]');
    } catch (e: any) {
      diagnostics.push(`[pip failed: ${(e?.message || '').slice(0, 80)}]`);
    }
  }

  // ── All strategies failed — build error message ─────────
  let msg = 'yt-dlp could not be installed automatically.\n\n';
  msg += `Platform: ${process.platform}/${process.arch}`;
  if (alpine) msg += ' (Alpine)';
  if (musl) msg += ' (musl)';
  if (docker) msg += ' (Docker)';
  msg += '\n\nDiagnostics:\n' + diagnostics.join('\n') + '\n\n';

  if (docker) {
    if (alpine || musl) {
      msg += '══ FIX: Run on your host machine ══\n\n';
      msg += '  docker exec -u root YOUR_CONTAINER sh -c "apk add --no-cache gcompat && rm -rf /home/node/.n8n/nodes/node_modules/n8n-nodes-youtube-dl/bin"\n\n';
      msg += 'Then restart the container. The node will auto-download yt-dlp on next run.\n\n';
      msg += '══ PERMANENT FIX: Custom Dockerfile ══\n\n';
      msg += '  FROM n8nio/n8n:latest\n';
      msg += '  USER root\n';
      msg += '  RUN apk add --no-cache gcompat\n';
      msg += '  USER node\n';
    } else {
      msg += '══ FIX: Run on your host machine ══\n\n';
      msg += '  docker exec -u root YOUR_CONTAINER sh -c "\\\n';
      msg += '    apt-get update && apt-get install -y curl && \\\n';
      msg += '    curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux -o /usr/local/bin/yt-dlp && \\\n';
      msg += '    chmod 755 /usr/local/bin/yt-dlp"\n\n';
      msg += 'Then restart the container.\n\n';
      msg += '══ PERMANENT FIX: Custom Dockerfile ══\n\n';
      msg += '  FROM n8nio/n8n:latest\n';
      msg += '  USER root\n';
      msg += '  RUN apt-get update && apt-get install -y --no-install-recommends curl \\\n';
      msg += '      && curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux -o /usr/local/bin/yt-dlp \\\n';
      msg += '      && chmod 755 /usr/local/bin/yt-dlp \\\n';
      msg += '      && rm -rf /var/lib/apt/lists/*\n';
      msg += '  USER node\n';
    }
  } else {
    msg += '══ HOW TO FIX ══\n';
    msg += '  Option 1: Install yt-dlp → https://github.com/yt-dlp/yt-dlp#installation\n';
    msg += '  Option 2: Set YT_DLP_PATH=/path/to/yt-dlp environment variable\n';
  }

  throw new Error(msg);
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
        maxBuffer: 100 * 1024 * 1024,
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
