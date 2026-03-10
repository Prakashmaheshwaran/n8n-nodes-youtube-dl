/**
 * Postinstall: pre-downloads the yt-dlp standalone binary.
 *
 * This is a best-effort optimization — if it fails, the node's runtime
 * code (ytdlp.ts) will download and set up the binary on first use.
 *
 * Never fails the install — just warns if the download doesn't work.
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
  if (p === 'win32') return 'yt-dlp.exe';
  return null;
}

function binaryFilename() {
  return process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
}

// ── Download helper ─────────────────────────────────────────

async function download(url, dest) {
  const res = await fetch(url, {
    redirect: 'follow',
    headers: { 'User-Agent': 'n8n-nodes-youtube-dl/postinstall' },
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
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

// ── Main ────────────────────────────────────────────────────

async function main() {
  fs.mkdirSync(BIN_DIR, { recursive: true });

  // Skip if user manages their own binary
  if (process.env.YT_DLP_PATH) {
    console.log(`[yt-dlp] Using user-provided binary: ${process.env.YT_DLP_PATH}`);
    return;
  }

  // Check if binary already works
  const dest = path.join(BIN_DIR, binaryFilename());
  if (fs.existsSync(dest) && testBinary(dest)) {
    console.log('[yt-dlp] Binary already installed and working.');
    return;
  }

  // Download standalone binary
  const standaloneName = getStandaloneName();
  if (!standaloneName) {
    console.log(`[yt-dlp] Unsupported platform: ${process.platform}/${process.arch}`);
    console.log('[yt-dlp] The node will attempt to download at runtime.');
    return;
  }

  const url = `${RELEASE_BASE}/${standaloneName}`;
  console.log(`[yt-dlp] Downloading binary for ${process.platform}/${process.arch}...`);

  try {
    await download(url, dest);
    if (testBinary(dest)) {
      console.log('[yt-dlp] Binary installed successfully.');
      return;
    }
    // Binary downloaded but won't run here (e.g. musl/Alpine).
    // That's fine — the runtime code has a musl compatibility shim.
    console.log('[yt-dlp] Binary downloaded. Compatibility will be handled at runtime.');
  } catch (err) {
    console.log(`[yt-dlp] Download skipped: ${err.message}`);
    console.log('[yt-dlp] The node will download the binary on first use.');
  }
}

main().catch((err) => {
  console.warn(`[yt-dlp] postinstall: ${err.message}`);
  // Never fail the install
});
