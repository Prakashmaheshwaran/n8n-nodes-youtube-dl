import {
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
  NodeOperationError,
} from 'n8n-workflow';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { getInfo, download, runYtDlp, ensureBinary } from './ytdlp';

// ──────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────

interface CookieEntry {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  secure?: boolean;
  httpOnly?: boolean;
  expirationDate?: number;
}

// ──────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────

function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  // Bare 11-char YouTube video ID
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
    return `https://www.youtube.com/watch?v=${trimmed}`;
  }
  // Add https:// if missing protocol
  if (trimmed && !trimmed.match(/^https?:\/\//i)) {
    return `https://${trimmed}`;
  }
  return trimmed;
}

function isValidInput(input: string): boolean {
  const trimmed = input.trim();
  if (!trimmed) return false;
  // YouTube URL patterns
  if (/(?:youtube\.com\/(?:watch|embed|shorts|live|playlist)|youtu\.be\/)/.test(trimmed)) return true;
  // Bare 11-char YouTube video ID
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return true;
  // Any URL — let yt-dlp handle validation (it supports 1000+ sites)
  if (/^https?:\/\/.+/i.test(trimmed)) return true;
  return false;
}

function extractVideoId(input: string): string {
  const trimmed = input.trim();
  const m = trimmed.match(
    /(?:youtube\.com\/(?:watch\?.*v=|embed\/|shorts\/|live\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/,
  );
  if (m) return m[1];
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return trimmed;
  // For non-YouTube URLs, derive a short identifier from the URL
  try {
    const u = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`);
    const slug = u.pathname.split('/').filter(Boolean).pop() || u.hostname;
    return slug.replace(/[^a-z0-9_-]/gi, '_').slice(0, 40);
  } catch {
    return trimmed.replace(/[^a-z0-9_-]/gi, '_').slice(0, 20);
  }
}

/** Write cookies (EditThisCookie JSON array) → Netscape cookie file for yt-dlp */
function writeCookieFile(cookies: CookieEntry[]): string {
  const tmpFile = path.join(os.tmpdir(), `ytdl_cookies_${Date.now()}_${process.pid}.txt`);
  const lines = ['# Netscape HTTP Cookie File'];

  for (const c of cookies) {
    const domain = c.domain || '.youtube.com';
    const sub = domain.startsWith('.') ? 'TRUE' : 'FALSE';
    const p = c.path || '/';
    const sec = c.secure ? 'TRUE' : 'FALSE';
    const exp = c.expirationDate ? String(Math.floor(c.expirationDate)) : '0';
    lines.push(`${domain}\t${sub}\t${p}\t${sec}\t${exp}\t${c.name}\t${c.value}`);
  }

  fs.writeFileSync(tmpFile, lines.join('\n') + '\n');
  return tmpFile;
}

/** Build extra yt-dlp flags from node parameters + credentials */
async function buildExtraFlags(
  context: IExecuteFunctions,
  itemIndex: number,
): Promise<{ flags: string[]; cookieFile?: string }> {
  const flags: string[] = [];
  let cookieFile: string | undefined;

  // Proxy
  const useProxy = context.getNodeParameter('useProxy', itemIndex) as boolean;
  if (useProxy) {
    const proxyUrl = context.getNodeParameter('proxyUrl', itemIndex) as string;
    if (proxyUrl) {
      flags.push('--proxy', proxyUrl);
    }
  }

  // Custom yt-dlp flags
  const customFlags = context.getNodeParameter('customFlags', itemIndex, '') as string;
  if (customFlags.trim()) {
    // Split respecting quoted strings
    const parts = customFlags.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
    flags.push(...parts.map(p => p.replace(/^"|"$/g, '')));
  }

  // Cookies
  try {
    const creds = await context.getCredentials('youTubeDLCookies');
    if (creds?.cookiesJson) {
      let parsed: CookieEntry[];
      try {
        parsed = JSON.parse(creds.cookiesJson as string);
      } catch {
        throw new Error('Invalid cookies JSON format. Expected a JSON array of cookie objects.');
      }
      if (Array.isArray(parsed) && parsed.length > 0) {
        cookieFile = writeCookieFile(parsed);
        flags.push('--cookies', cookieFile);
      }
    }
  } catch (e: any) {
    // Re-throw cookie format errors, ignore "no credentials configured"
    if (e?.message?.includes('Invalid cookies')) throw e;
  }

  return { flags, cookieFile };
}

function cleanup(...files: (string | undefined)[]) {
  for (const f of files) {
    if (f) {
      try { fs.unlinkSync(f); } catch { /* ignore */ }
    }
  }
}

/** Find the file yt-dlp wrote (it adds the extension via %(ext)s) */
function findOutputFile(tmpBase: string): string | undefined {
  const dir = path.dirname(tmpBase);
  const base = path.basename(tmpBase);
  const files = fs.readdirSync(dir)
    .filter((f) => f.startsWith(base) && !f.endsWith('.part') && !f.endsWith('.temp'));
  return files.length > 0 ? path.join(dir, files[0]) : undefined;
}

function mimeFromExt(ext: string): string {
  switch (ext) {
    case 'mp4': return 'video/mp4';
    case 'webm': return 'video/webm';
    case 'mkv': return 'video/x-matroska';
    case 'm4a': return 'audio/mp4';
    case 'opus': return 'audio/opus';
    case 'mp3': return 'audio/mpeg';
    case 'ogg': return 'audio/ogg';
    case 'flac': return 'audio/flac';
    case 'wav': return 'audio/wav';
    case 'srt': return 'text/plain';
    case 'vtt': return 'text/vtt';
    case 'ass': return 'text/plain';
    case 'json': return 'application/json';
    default: return 'application/octet-stream';
  }
}

// ── Format selection helper ─────────────────────────────────

function buildFormatFlag(quality: string): string {
  switch (quality) {
    case '2160p': return 'bestvideo[height<=2160]+bestaudio/best[height<=2160]/best';
    case '1440p': return 'bestvideo[height<=1440]+bestaudio/best[height<=1440]/best';
    case '1080p': return 'bestvideo[height<=1080]+bestaudio/best[height<=1080]/best';
    case '720p': return 'bestvideo[height<=720]+bestaudio/best[height<=720]/best';
    case '480p': return 'bestvideo[height<=480]+bestaudio/best[height<=480]/best';
    case '360p': return 'bestvideo[height<=360]+bestaudio/best[height<=360]/best';
    case 'lowest': return 'worst[ext=mp4]/worst';
    case 'highest':
    default:
      return 'best[ext=mp4]/best';
  }
}

// ──────────────────────────────────────────────────────────────
// Operations
// ──────────────────────────────────────────────────────────────

async function opDownloadVideo(
  context: IExecuteFunctions,
  videoUrl: string,
  videoId: string,
  itemIndex: number,
): Promise<INodeExecutionData> {
  const videoQuality = context.getNodeParameter('videoQuality', itemIndex) as string;
  const customFilename = context.getNodeParameter('outputFilename', itemIndex, '') as string;
  const { flags, cookieFile } = await buildExtraFlags(context, itemIndex);

  const tmpBase = path.join(
    os.tmpdir(),
    `ytdl_v_${Date.now()}_${process.pid}_${Math.random().toString(36).slice(2, 8)}`,
  );
  let outputFile: string | undefined;

  try {
    const info = await getInfo(videoUrl, flags);
    const format = buildFormatFlag(videoQuality);

    await download(videoUrl, `${tmpBase}.%(ext)s`, [...flags, '-f', format]);

    outputFile = findOutputFile(tmpBase);
    if (!outputFile) throw new Error('Download completed but output file not found');

    const ext = path.extname(outputFile).slice(1) || 'mp4';
    const title = info.title || 'video';
    const filename = customFilename || `${title.replace(/[^a-z0-9]/gi, '_')}_${videoId}`;
    const fileSize = fs.statSync(outputFile).size;

    // Use n8n's prepareBinaryData for streaming — handles large files without OOM
    const binaryData = await context.helpers.prepareBinaryData(
      fs.createReadStream(outputFile),
      `${filename}.${ext}`,
      mimeFromExt(ext),
    );

    return {
      json: {
        success: true,
        videoId,
        title: info.title,
        author: info.uploader || info.channel,
        lengthSeconds: String(info.duration || 0),
        viewCount: String(info.view_count || 0),
        downloadType: 'video',
        fileSize,
        format: ext,
      },
      binary: { data: binaryData },
      pairedItem: { item: itemIndex },
    };
  } finally {
    cleanup(outputFile, cookieFile);
  }
}

async function opDownloadAudio(
  context: IExecuteFunctions,
  videoUrl: string,
  videoId: string,
  itemIndex: number,
): Promise<INodeExecutionData> {
  const audioQuality = context.getNodeParameter('audioQuality', itemIndex) as string;
  const customFilename = context.getNodeParameter('outputFilename', itemIndex, '') as string;
  const { flags, cookieFile } = await buildExtraFlags(context, itemIndex);

  const tmpBase = path.join(
    os.tmpdir(),
    `ytdl_a_${Date.now()}_${process.pid}_${Math.random().toString(36).slice(2, 8)}`,
  );
  let outputFile: string | undefined;

  try {
    const info = await getInfo(videoUrl, flags);
    const format = audioQuality === 'lowest' ? 'worstaudio' : 'bestaudio';

    await download(videoUrl, `${tmpBase}.%(ext)s`, [...flags, '-f', format]);

    outputFile = findOutputFile(tmpBase);
    if (!outputFile) throw new Error('Audio download completed but output file not found');

    const ext = path.extname(outputFile).slice(1) || 'webm';
    const title = info.title || 'audio';
    const filename =
      customFilename || `${title.replace(/[^a-z0-9]/gi, '_')}_${videoId}_audio`;
    const fileSize = fs.statSync(outputFile).size;

    const binaryData = await context.helpers.prepareBinaryData(
      fs.createReadStream(outputFile),
      `${filename}.${ext}`,
      mimeFromExt(ext),
    );

    return {
      json: {
        success: true,
        videoId,
        title: info.title,
        author: info.uploader || info.channel,
        lengthSeconds: String(info.duration || 0),
        downloadType: 'audio',
        fileSize,
        format: ext,
      },
      binary: { data: binaryData },
      pairedItem: { item: itemIndex },
    };
  } finally {
    cleanup(outputFile, cookieFile);
  }
}

async function opGetVideoInfo(
  context: IExecuteFunctions,
  videoUrl: string,
  videoId: string,
  itemIndex: number,
): Promise<INodeExecutionData> {
  const { flags, cookieFile } = await buildExtraFlags(context, itemIndex);

  try {
    const info = await getInfo(videoUrl, flags);

    const formats = (info.formats || []).map((f: Record<string, unknown>) => ({
      formatId: f.format_id,
      formatNote: f.format_note,
      ext: f.ext,
      resolution: f.resolution,
      fps: f.fps,
      hasVideo: f.vcodec !== 'none',
      hasAudio: f.acodec !== 'none',
      videoCodec: f.vcodec,
      audioCodec: f.acodec,
      bitrate: f.tbr,
      videoBitrate: f.vbr,
      audioBitrate: f.abr,
      width: f.width,
      height: f.height,
      filesize: f.filesize || f.filesize_approx,
    }));

    return {
      json: {
        success: true,
        videoId,
        title: info.title,
        description: info.description,
        lengthSeconds: String(info.duration || 0),
        viewCount: String(info.view_count || 0),
        uploadDate: info.upload_date,
        author: {
          name: info.uploader || info.channel,
          channelUrl: info.channel_url || info.uploader_url,
          subscriberCount: info.channel_follower_count,
        },
        thumbnails: info.thumbnails,
        formats,
        category: info.categories?.[0],
        keywords: info.tags,
        isLive: info.is_live || false,
        videoUrl: info.webpage_url,
      },
      pairedItem: { item: itemIndex },
    };
  } finally {
    cleanup(cookieFile);
  }
}

async function opGetTranscript(
  context: IExecuteFunctions,
  videoUrl: string,
  videoId: string,
  itemIndex: number,
): Promise<INodeExecutionData> {
  const subtitleLang = context.getNodeParameter('subtitleLanguage', itemIndex, 'en') as string;
  const { flags, cookieFile } = await buildExtraFlags(context, itemIndex);

  const tmpBase = path.join(
    os.tmpdir(),
    `ytdl_t_${Date.now()}_${process.pid}_${Math.random().toString(36).slice(2, 8)}`,
  );

  try {
    // Get metadata first
    const info = await getInfo(videoUrl, flags);

    const bin = await ensureBinary();

    // Try auto-generated subtitles first, then manual
    const subFlags = [
      '--skip-download',
      '--write-auto-subs',
      '--write-subs',
      '--sub-lang', subtitleLang,
      '--sub-format', 'json3',
      '--no-check-certificates',
      '--no-warnings',
      '-o', `${tmpBase}.%(ext)s`,
      ...flags,
      videoUrl,
    ];

    await runYtDlp(bin, subFlags, 60_000);

    // Find subtitle file (yt-dlp writes .LANG.json3)
    const dir = path.dirname(tmpBase);
    const base = path.basename(tmpBase);
    const subFiles = fs.readdirSync(dir)
      .filter(f => f.startsWith(base) && (f.endsWith('.json3') || f.endsWith('.vtt') || f.endsWith('.srt')));

    if (subFiles.length === 0) {
      return {
        json: {
          success: true,
          videoId,
          title: info.title,
          transcript: null,
          language: subtitleLang,
          message: `No subtitles found for language "${subtitleLang}"`,
        },
        pairedItem: { item: itemIndex },
      };
    }

    const subFile = path.join(dir, subFiles[0]);
    const raw = fs.readFileSync(subFile, 'utf-8');

    // Parse json3 subtitle format into clean text
    let transcriptText = '';
    let segments: Array<{ start: number; end: number; text: string }> = [];

    try {
      const json3 = JSON.parse(raw);
      if (json3.events) {
        for (const event of json3.events) {
          if (!event.segs) continue;
          const text = event.segs.map((s: Record<string, unknown>) => s.utf8 || '').join('').trim();
          if (!text || text === '\n') continue;
          segments.push({
            start: (event.tStartMs || 0) / 1000,
            end: ((event.tStartMs || 0) + (event.dDurationMs || 0)) / 1000,
            text,
          });
        }
        transcriptText = segments.map(s => s.text).join(' ').replace(/\s+/g, ' ').trim();
      }
    } catch {
      // If not json3, return raw text
      transcriptText = raw;
    }

    // Cleanup subtitle file
    cleanup(subFile);

    return {
      json: {
        success: true,
        videoId,
        title: info.title,
        language: subtitleLang,
        transcript: transcriptText,
        segments,
        wordCount: transcriptText.split(/\s+/).length,
      },
      pairedItem: { item: itemIndex },
    };
  } finally {
    cleanup(cookieFile);
  }
}

async function opDownloadSubtitles(
  context: IExecuteFunctions,
  videoUrl: string,
  videoId: string,
  itemIndex: number,
): Promise<INodeExecutionData> {
  const subtitleLang = context.getNodeParameter('subtitleLanguage', itemIndex, 'en') as string;
  const subtitleFormat = context.getNodeParameter('subtitleFormat', itemIndex, 'srt') as string;
  const { flags, cookieFile } = await buildExtraFlags(context, itemIndex);

  const tmpBase = path.join(
    os.tmpdir(),
    `ytdl_s_${Date.now()}_${process.pid}_${Math.random().toString(36).slice(2, 8)}`,
  );

  try {
    const info = await getInfo(videoUrl, flags);
    const bin = await ensureBinary();

    const subFlags = [
      '--skip-download',
      '--write-auto-subs',
      '--write-subs',
      '--sub-lang', subtitleLang,
      '--sub-format', subtitleFormat,
      '--convert-subs', subtitleFormat,
      '--no-check-certificates',
      '--no-warnings',
      '-o', `${tmpBase}.%(ext)s`,
      ...flags,
      videoUrl,
    ];

    await runYtDlp(bin, subFlags, 60_000);

    const dir = path.dirname(tmpBase);
    const base = path.basename(tmpBase);
    const subFiles = fs.readdirSync(dir)
      .filter(f => f.startsWith(base) && !f.endsWith('.part'));

    if (subFiles.length === 0) {
      return {
        json: {
          success: false,
          videoId,
          title: info.title,
          error: `No subtitles found for language "${subtitleLang}"`,
        },
        pairedItem: { item: itemIndex },
      };
    }

    const subFile = path.join(dir, subFiles[0]);
    const ext = path.extname(subFile).slice(1) || subtitleFormat;
    const title = info.title || 'subtitles';
    const filename = `${title.replace(/[^a-z0-9]/gi, '_')}_${videoId}_${subtitleLang}`;

    const binaryData = await context.helpers.prepareBinaryData(
      fs.createReadStream(subFile),
      `${filename}.${ext}`,
      mimeFromExt(ext),
    );

    cleanup(subFile);

    return {
      json: {
        success: true,
        videoId,
        title: info.title,
        language: subtitleLang,
        format: ext,
      },
      binary: { data: binaryData },
      pairedItem: { item: itemIndex },
    };
  } finally {
    cleanup(cookieFile);
  }
}

// ──────────────────────────────────────────────────────────────
// Node class
// ──────────────────────────────────────────────────────────────

export class YouTubeDL implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'YouTube Downloader',
    name: 'youTubeDL',
    icon: 'file:youtube.svg',
    group: ['transform'],
    version: 1,
    subtitle: '={{$parameter["operation"]}}',
    description: 'Download videos, audio, transcripts, and subtitles via yt-dlp',
    defaults: {
      name: 'YouTube Downloader',
    },
    inputs: ['main'],
    outputs: ['main'],
    credentials: [
      {
        name: 'youTubeDLCookies',
        required: false,
      },
    ],
    properties: [
      // ── Operation ──
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        options: [
          {
            name: 'Download Video',
            value: 'downloadVideo',
            description: 'Download video from a URL',
            action: 'Download video',
          },
          {
            name: 'Download Audio',
            value: 'downloadAudio',
            description: 'Extract audio track from a video',
            action: 'Download audio',
          },
          {
            name: 'Get Video Info',
            value: 'getInfo',
            description: 'Get video metadata without downloading',
            action: 'Get video info',
          },
          {
            name: 'Get Transcript',
            value: 'getTranscript',
            description: 'Extract transcript/subtitles as text',
            action: 'Get transcript',
          },
          {
            name: 'Download Subtitles',
            value: 'downloadSubtitles',
            description: 'Download subtitle file (SRT, VTT, etc.)',
            action: 'Download subtitles',
          },
        ],
        default: 'downloadVideo',
      },

      // ── URL ──
      {
        displayName: 'Video URL',
        name: 'videoUrl',
        type: 'string',
        default: '',
        required: true,
        description: 'YouTube URL, video ID, or any URL supported by yt-dlp (1000+ sites)',
        placeholder: 'https://www.youtube.com/watch?v=... or any video URL',
      },

      // ── Quality ──
      {
        displayName: 'Video Quality',
        name: 'videoQuality',
        type: 'options',
        options: [
          { name: 'Highest', value: 'highest', description: 'Best available quality' },
          { name: '4K (2160p)', value: '2160p', description: 'Up to 3840×2160' },
          { name: '1440p', value: '1440p', description: 'Up to 2560×1440' },
          { name: '1080p', value: '1080p', description: 'Up to 1920×1080' },
          { name: '720p', value: '720p', description: 'Up to 1280×720' },
          { name: '480p', value: '480p', description: 'Up to 854×480' },
          { name: '360p', value: '360p', description: 'Up to 640×360' },
          { name: 'Lowest', value: 'lowest', description: 'Smallest file size' },
        ],
        default: 'highest',
        description: 'Maximum video resolution to download',
        displayOptions: { show: { operation: ['downloadVideo'] } },
      },
      {
        displayName: 'Audio Quality',
        name: 'audioQuality',
        type: 'options',
        options: [
          { name: 'Highest', value: 'highest', description: 'Best available audio quality' },
          { name: 'Lowest', value: 'lowest', description: 'Smallest file size' },
        ],
        default: 'highest',
        description: 'Audio quality to download',
        displayOptions: { show: { operation: ['downloadAudio'] } },
      },

      // ── Subtitle options ──
      {
        displayName: 'Language',
        name: 'subtitleLanguage',
        type: 'string',
        default: 'en',
        description: 'Subtitle language code (e.g. en, es, fr, de, ja, ko, zh)',
        placeholder: 'en',
        displayOptions: { show: { operation: ['getTranscript', 'downloadSubtitles'] } },
      },
      {
        displayName: 'Subtitle Format',
        name: 'subtitleFormat',
        type: 'options',
        options: [
          { name: 'SRT', value: 'srt', description: 'SubRip format (most compatible)' },
          { name: 'VTT', value: 'vtt', description: 'WebVTT format (web-native)' },
          { name: 'ASS', value: 'ass', description: 'Advanced SubStation Alpha' },
        ],
        default: 'srt',
        description: 'Output format for the subtitle file',
        displayOptions: { show: { operation: ['downloadSubtitles'] } },
      },

      // ── Output ──
      {
        displayName: 'Output Filename',
        name: 'outputFilename',
        type: 'string',
        default: '',
        placeholder: 'auto-generated from title',
        description: 'Custom filename without extension (auto-generated if blank)',
        displayOptions: { show: { operation: ['downloadVideo', 'downloadAudio', 'downloadSubtitles'] } },
      },

      // ── Proxy ──
      {
        displayName: 'Use Proxy',
        name: 'useProxy',
        type: 'boolean',
        default: false,
        description: 'Whether to route the request through a proxy server',
      },
      {
        displayName: 'Proxy URL',
        name: 'proxyUrl',
        type: 'string',
        default: '',
        placeholder: 'http://user:pass@proxy:port or socks5://proxy:port',
        description: 'Proxy URL — supports HTTP, HTTPS, and SOCKS5 protocols',
        displayOptions: { show: { useProxy: [true] } },
      },

      // ── Advanced ──
      {
        displayName: 'Custom yt-dlp Flags',
        name: 'customFlags',
        type: 'string',
        default: '',
        placeholder: '--limit-rate 1M --geo-bypass',
        description: 'Additional yt-dlp command-line flags for advanced use cases (e.g. rate limiting, geo-bypass, SponsorBlock)',
      },
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const returnData: INodeExecutionData[] = [];
    const operation = this.getNodeParameter('operation', 0) as string;

    for (let i = 0; i < items.length; i++) {
      try {
        const rawUrl = this.getNodeParameter('videoUrl', i) as string;

        if (!rawUrl) {
          throw new NodeOperationError(this.getNode(), 'Video URL is required', {
            itemIndex: i,
          });
        }

        if (!isValidInput(rawUrl)) {
          throw new NodeOperationError(
            this.getNode(),
            `Invalid URL or video ID: "${rawUrl}". Provide a YouTube URL, video ID, or any supported URL.`,
            { itemIndex: i },
          );
        }

        const videoUrl = normalizeUrl(rawUrl);
        const videoId = extractVideoId(rawUrl);

        let result: INodeExecutionData;
        switch (operation) {
          case 'downloadVideo':
            result = await opDownloadVideo(this, videoUrl, videoId, i);
            break;
          case 'downloadAudio':
            result = await opDownloadAudio(this, videoUrl, videoId, i);
            break;
          case 'getInfo':
            result = await opGetVideoInfo(this, videoUrl, videoId, i);
            break;
          case 'getTranscript':
            result = await opGetTranscript(this, videoUrl, videoId, i);
            break;
          case 'downloadSubtitles':
            result = await opDownloadSubtitles(this, videoUrl, videoId, i);
            break;
          default:
            throw new NodeOperationError(this.getNode(), `Unknown operation: ${operation}`, {
              itemIndex: i,
            });
        }
        returnData.push(result);
      } catch (error: any) {
        if (this.continueOnFail()) {
          returnData.push({
            json: { success: false, error: error.message || String(error) },
            pairedItem: { item: i },
          });
          continue;
        }
        throw new NodeOperationError(
          this.getNode(),
          `${operation} failed: ${error.message}`,
          { itemIndex: i },
        );
      }
    }

    return [returnData];
  }
}
