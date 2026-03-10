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
import { getInfo, download } from './ytdlp';

// ──────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────

function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
    return `https://www.youtube.com/watch?v=${trimmed}`;
  }
  return trimmed;
}

function isValidYouTubeInput(input: string): boolean {
  const trimmed = input.trim();
  if (/(?:youtube\.com\/(?:watch|embed|shorts|live)|youtu\.be\/)/.test(trimmed)) return true;
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return true;
  return false;
}

function extractVideoId(input: string): string {
  const trimmed = input.trim();
  const m = trimmed.match(
    /(?:youtube\.com\/(?:watch\?.*v=|embed\/|shorts\/|live\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/,
  );
  if (m) return m[1];
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return trimmed;
  return trimmed.slice(0, 20);
}

/** Write cookies (EditThisCookie JSON array) → Netscape cookie file for yt-dlp */
function writeCookieFile(cookies: any[]): string {
  const tmpFile = path.join(os.tmpdir(), `ytdl_cookies_${Date.now()}.txt`);
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

  // Cookies
  try {
    const creds = await context.getCredentials('youTubeDLCookies');
    if (creds?.cookiesJson) {
      const parsed = JSON.parse(creds.cookiesJson as string);
      if (Array.isArray(parsed) && parsed.length > 0) {
        cookieFile = writeCookieFile(parsed);
        flags.push('--cookies', cookieFile);
      }
    }
  } catch {
    // No credentials configured
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
  const files = fs.readdirSync(dir).filter((f) => f.startsWith(base));
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
    default: return 'application/octet-stream';
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
  returnData: INodeExecutionData[],
): Promise<void> {
  const videoQuality = context.getNodeParameter('videoQuality', itemIndex) as string;
  const customFilename = context.getNodeParameter('outputFilename', itemIndex) as string;
  const useProxy = context.getNodeParameter('useProxy', itemIndex) as boolean;
  const { flags, cookieFile } = await buildExtraFlags(context, itemIndex);

  const tmpBase = path.join(
    os.tmpdir(),
    `ytdl_v_${Date.now()}_${Math.random().toString(36).slice(2)}`,
  );
  let outputFile: string | undefined;

  try {
    // Metadata
    const info = await getInfo(videoUrl, flags);

    // Format
    const format = videoQuality === 'lowest' ? 'worst[ext=mp4]/worst' : 'best[ext=mp4]/best';

    // Download
    await download(videoUrl, `${tmpBase}.%(ext)s`, [...flags, '-f', format]);

    outputFile = findOutputFile(tmpBase);
    if (!outputFile) throw new Error('Download completed but output file not found');

    const buffer = fs.readFileSync(outputFile);
    const ext = path.extname(outputFile).slice(1) || 'mp4';
    const title = info.title || 'video';
    const filename = customFilename || `${title.replace(/[^a-z0-9]/gi, '_')}_${videoId}`;

    returnData.push({
      json: {
        success: true,
        videoId,
        title: info.title,
        author: info.uploader || info.channel,
        lengthSeconds: String(info.duration || 0),
        viewCount: String(info.view_count || 0),
        downloadType: 'video',
        fileSize: buffer.length,
        format: ext,
        proxyUsed: useProxy,
      },
      binary: {
        [filename]: {
          data: buffer.toString('base64'),
          mimeType: mimeFromExt(ext),
          fileExtension: ext,
          fileName: `${filename}.${ext}`,
        },
      },
    });
  } finally {
    cleanup(outputFile, cookieFile);
  }
}

async function opDownloadAudio(
  context: IExecuteFunctions,
  videoUrl: string,
  videoId: string,
  itemIndex: number,
  returnData: INodeExecutionData[],
): Promise<void> {
  const audioQuality = context.getNodeParameter('audioQuality', itemIndex) as string;
  const customFilename = context.getNodeParameter('outputFilename', itemIndex) as string;
  const useProxy = context.getNodeParameter('useProxy', itemIndex) as boolean;
  const { flags, cookieFile } = await buildExtraFlags(context, itemIndex);

  const tmpBase = path.join(
    os.tmpdir(),
    `ytdl_a_${Date.now()}_${Math.random().toString(36).slice(2)}`,
  );
  let outputFile: string | undefined;

  try {
    const info = await getInfo(videoUrl, flags);

    const format = audioQuality === 'lowest' ? 'worstaudio' : 'bestaudio';

    await download(videoUrl, `${tmpBase}.%(ext)s`, [...flags, '-f', format]);

    outputFile = findOutputFile(tmpBase);
    if (!outputFile) throw new Error('Audio download completed but output file not found');

    const buffer = fs.readFileSync(outputFile);
    const ext = path.extname(outputFile).slice(1) || 'webm';
    const title = info.title || 'audio';
    const filename =
      customFilename || `${title.replace(/[^a-z0-9]/gi, '_')}_${videoId}_audio`;

    returnData.push({
      json: {
        success: true,
        videoId,
        title: info.title,
        author: info.uploader || info.channel,
        lengthSeconds: String(info.duration || 0),
        downloadType: 'audio',
        fileSize: buffer.length,
        format: ext,
        proxyUsed: useProxy,
      },
      binary: {
        [filename]: {
          data: buffer.toString('base64'),
          mimeType: mimeFromExt(ext),
          fileExtension: ext,
          fileName: `${filename}.${ext}`,
        },
      },
    });
  } finally {
    cleanup(outputFile, cookieFile);
  }
}

async function opGetVideoInfo(
  context: IExecuteFunctions,
  videoUrl: string,
  videoId: string,
  itemIndex: number,
  returnData: INodeExecutionData[],
): Promise<void> {
  const useProxy = context.getNodeParameter('useProxy', itemIndex) as boolean;
  const { flags, cookieFile } = await buildExtraFlags(context, itemIndex);

  try {
    const info = await getInfo(videoUrl, flags);

    const formats = (info.formats || []).map((f: any) => ({
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

    returnData.push({
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
        proxyUsed: useProxy,
      },
    });
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
    description: 'Download YouTube videos and audio using yt-dlp',
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
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        options: [
          {
            name: 'Download Video',
            value: 'downloadVideo',
            description: 'Download video from YouTube',
            action: 'Download video',
          },
          {
            name: 'Download Audio',
            value: 'downloadAudio',
            description: 'Extract audio from YouTube video',
            action: 'Download audio',
          },
          {
            name: 'Get Video Info',
            value: 'getInfo',
            description: 'Get video metadata without downloading',
            action: 'Get video info',
          },
        ],
        default: 'downloadVideo',
      },
      {
        displayName: 'Video URL',
        name: 'videoUrl',
        type: 'string',
        default: '',
        required: true,
        description: 'YouTube video URL or ID',
        placeholder: 'https://www.youtube.com/watch?v=...',
      },
      {
        displayName: 'Video Quality',
        name: 'videoQuality',
        type: 'options',
        options: [
          { name: 'Highest', value: 'highest' },
          { name: 'Lowest', value: 'lowest' },
        ],
        default: 'highest',
        displayOptions: { show: { operation: ['downloadVideo'] } },
      },
      {
        displayName: 'Audio Quality',
        name: 'audioQuality',
        type: 'options',
        options: [
          { name: 'Highest', value: 'highest' },
          { name: 'Lowest', value: 'lowest' },
        ],
        default: 'highest',
        displayOptions: { show: { operation: ['downloadAudio'] } },
      },
      {
        displayName: 'Output Filename',
        name: 'outputFilename',
        type: 'string',
        default: '',
        placeholder: 'auto-generated',
        description: 'Custom filename (optional, extension auto-added)',
      },
      {
        displayName: 'Proxy',
        name: 'useProxy',
        type: 'boolean',
        default: false,
        description: 'Whether to use a proxy for the request',
      },
      {
        displayName: 'Proxy URL',
        name: 'proxyUrl',
        type: 'string',
        default: '',
        placeholder: 'http://user:pass@proxy:port or socks5://proxy:port',
        description: 'Proxy URL (supports HTTP, HTTPS, and SOCKS5)',
        displayOptions: { show: { useProxy: [true] } },
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

        if (!isValidYouTubeInput(rawUrl)) {
          throw new NodeOperationError(
            this.getNode(),
            `Invalid YouTube URL or video ID: ${rawUrl}`,
            { itemIndex: i },
          );
        }

        const videoUrl = normalizeUrl(rawUrl);
        const videoId = extractVideoId(rawUrl);

        switch (operation) {
          case 'downloadVideo':
            await opDownloadVideo(this, videoUrl, videoId, i, returnData);
            break;
          case 'downloadAudio':
            await opDownloadAudio(this, videoUrl, videoId, i, returnData);
            break;
          case 'getInfo':
            await opGetVideoInfo(this, videoUrl, videoId, i, returnData);
            break;
          default:
            throw new NodeOperationError(this.getNode(), `Unknown operation: ${operation}`, {
              itemIndex: i,
            });
        }
      } catch (error: any) {
        if (this.continueOnFail()) {
          returnData.push({
            json: { success: false, error: error.stderr || error.message || String(error) },
          });
          continue;
        }
        throw new NodeOperationError(
          this.getNode(),
          `${operation} failed: ${error.stderr || error.message}`,
          { itemIndex: i },
        );
      }
    }

    return [returnData];
  }
}
