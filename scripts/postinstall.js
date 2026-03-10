/**
 * Postinstall script: downloads standalone yt-dlp binary.
 *
 * Strategy (tries in order):
 *   1. Standalone binary (no Python needed, ~30-40 MB)
 *   2. Python zipapp (needs Python 3.9+, ~3 MB)
 *   3. System yt-dlp already on PATH
 *
 * Never fails the install — just warns if nothing works.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const BIN_DIR = path.join(__dirname, '..', 'bin');
const RELEASE_BASE = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download';

// ── Platform → binary name mapping ──────────────────────────

function getStandaloneName() {
  const p = process.platform;
  const a = process.arch;
  if (p === 'linux') return a === 'arm64' ? 'yt-dlp_linux_aarch64' : 'yt-dlp_linux';
  if (p === 'darwin') return 'yt-dlp_macos';
  if (p === 'win32') return a === 'arm64' ? 'yt-dlp.exe' : 'yt-dlp.exe';
  return null;
}

function getZipappName() {
  if (process.platform === 'win32') return 'yt-dlp';
  return 'yt-dlp';
}

function destPath(variant) {
  const ext = process.platform === 'win32' ? '.exe' : '';
  const name = variant === 'standalone' ? `yt-dlp${ext}` : `yt-dlp-zipapp${ext}`;
  return path.join(BIN_DIR, name);
}

// ── Download with redirect following ────────────────────────

async function download(url, dest) {
  // Use built-in fetch (Node 20+) with redirect following
  const res = await fetch(url, {
    redirect: 'follow',
    headers: { 'User-Agent': 'n8n-nodes-youtube-dl/postinstall' },
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buffer);

  if (process.platform !== 'win32') {
    fs.chmodSync(dest, 0o755);
  }
}

// ── Test that a binary actually runs ────────────────────────

function testBinary(binPath) {
  try {
    const out = execFileSync(binPath, ['--version'], {
      timeout: 15000,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.trim().length > 0;
  } catch {
    return false;
  }
}

function hasPython() {
  try {
    const out = execFileSync('python3', ['--version'], {
      timeout: 5000,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.includes('3.');
  } catch {
    return false;
  }
}

// ── Main ────────────────────────────────────────────────────

async function main() {
  fs.mkdirSync(BIN_DIR, { recursive: true });

  // Skip if user set YT_DLP_PATH (they manage their own binary)
  if (process.env.YT_DLP_PATH) {
    console.log(`[yt-dlp] Using user-provided binary: ${process.env.YT_DLP_PATH}`);
    return;
  }

  // Check if standalone already works
  const standaloneDest = destPath('standalone');
  if (fs.existsSync(standaloneDest) && testBinary(standaloneDest)) {
    console.log('[yt-dlp] Standalone binary already installed and working.');
    return;
  }

  // Strategy 1: standalone binary (no Python needed)
  const standaloneName = getStandaloneName();
  if (standaloneName) {
    const url = `${RELEASE_BASE}/${standaloneName}`;
    console.log(`[yt-dlp] Downloading standalone binary for ${process.platform}/${process.arch}...`);
    try {
      await download(url, standaloneDest);
      if (testBinary(standaloneDest)) {
        console.log('[yt-dlp] Standalone binary installed successfully.');
        return;
      }
      console.log('[yt-dlp] Standalone binary downloaded but failed to run (likely musl/Alpine).');
      fs.unlinkSync(standaloneDest);
    } catch (err) {
      console.log(`[yt-dlp] Standalone download failed: ${err.message}`);
    }
  }

  // Strategy 2: Python zipapp (needs Python 3.9+)
  if (hasPython()) {
    const zipappDest = destPath('zipapp');
    const zipappUrl = `${RELEASE_BASE}/${getZipappName()}`;
    console.log('[yt-dlp] Python found. Downloading zipapp fallback...');
    try {
      await download(zipappUrl, zipappDest);
      if (testBinary(zipappDest)) {
        console.log('[yt-dlp] Python zipapp installed successfully.');
        return;
      }
      fs.unlinkSync(zipappDest);
    } catch (err) {
      console.log(`[yt-dlp] Zipapp download failed: ${err.message}`);
    }
  }

  // Strategy 3: check system yt-dlp
  try {
    const sysPath = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
    if (testBinary(sysPath)) {
      console.log('[yt-dlp] Found system yt-dlp on PATH. Will use that.');
      return;
    }
  } catch {
    // Not on PATH
  }

  // Nothing worked
  console.warn('\n' +
    '╔══════════════════════════════════════════════════════════════╗\n' +
    '║  WARNING: Could not install yt-dlp binary.                 ║\n' +
    '║                                                            ║\n' +
    '║  The YouTube Downloader node needs yt-dlp to work.         ║\n' +
    '║  Options:                                                  ║\n' +
    '║    • Install Python 3.9+ and reinstall this package        ║\n' +
    '║    • Install yt-dlp manually: pip install yt-dlp           ║\n' +
    '║    • Set YT_DLP_PATH=/path/to/yt-dlp environment variable  ║\n' +
    '║    • For Alpine Docker: apk add python3 gcompat            ║\n' +
    '╚══════════════════════════════════════════════════════════════╝\n'
  );
}

main().catch((err) => {
  console.warn(`[yt-dlp] postinstall warning: ${err.message}`);
  // Never fail the install
});
