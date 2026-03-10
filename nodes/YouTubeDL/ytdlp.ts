/**
 * Lightweight yt-dlp wrapper. Finds the binary (bundled or system)
 * and provides typed helpers for metadata + downloads.
 */

import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// ── Binary resolution ───────────────────────────────────────

const PACKAGE_ROOT = path.resolve(__dirname, '..', '..', '..');
const BIN_DIR = path.join(PACKAGE_ROOT, 'bin');

function findBinary(): string {
  const ext = process.platform === 'win32' ? '.exe' : '';

  // 1. Environment variable
  if (process.env.YT_DLP_PATH && fs.existsSync(process.env.YT_DLP_PATH)) {
    return process.env.YT_DLP_PATH;
  }

  // 2. Bundled standalone binary
  const standalone = path.join(BIN_DIR, `yt-dlp${ext}`);
  if (fs.existsSync(standalone)) return standalone;

  // 3. Bundled Python zipapp
  const zipapp = path.join(BIN_DIR, `yt-dlp-zipapp${ext}`);
  if (fs.existsSync(zipapp)) return zipapp;

  // 4. System yt-dlp on PATH
  return 'yt-dlp';
}

let cachedBinary: string | null = null;

function getBinary(): string {
  if (!cachedBinary) cachedBinary = findBinary();
  return cachedBinary;
}

// ── Core executor ───────────────────────────────────────────

export interface ExecResult {
  stdout: string;
  stderr: string;
}

export function runYtDlp(args: string[], timeoutMs = 300_000): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const bin = getBinary();
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
          if (msg.includes('ENOENT') || msg.includes('not found') || msg.includes('spawn')) {
            reject(
              new Error(
                `yt-dlp binary not found at "${bin}". ` +
                  'Reinstall this package or set the YT_DLP_PATH environment variable.',
              ),
            );
          } else {
            reject(new Error(msg));
          }
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
  const { stdout } = await runYtDlp([
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
  await runYtDlp(
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
