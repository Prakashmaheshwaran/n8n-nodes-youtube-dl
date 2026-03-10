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

// youtube-dl-exec is ESM-first but has CJS compat
// eslint-disable-next-line @typescript-eslint/no-var-requires
const youtubeDlExec = require('youtube-dl-exec');

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
  const urlMatch = trimmed.match(
    /(?:youtube\.com\/(?:watch\?.*v=|embed\/|shorts\/|live\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/,
  );
  if (urlMatch) return urlMatch[1];
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return trimmed;
  return trimmed.slice(0, 20); // fallback for display
}

/** Write cookies (EditThisCookie JSON format) to a Netscape cookie file for yt-dlp */
function writeCookieFile(cookies: any[]): string {
  const tmpFile = path.join(os.tmpdir(), `ytdl_cookies_${Date.now()}.txt`);
  const lines = ['# Netscape HTTP Cookie File'];

  for (const c of cookies) {
    const domain = c.domain || '.youtube.com';
    const includeSubdomains = domain.startsWith('.') ? 'TRUE' : 'FALSE';
    const cookiePath = c.path || '/';
    const secure = c.secure ? 'TRUE' : 'FALSE';
    const expiry = c.expirationDate ? String(Math.floor(c.expirationDate)) : '0';
    lines.push(
      `${domain}\t${includeSubdomains}\t${cookiePath}\t${secure}\t${expiry}\t${c.name}\t${c.value}`,
    );
  }

  fs.writeFileSync(tmpFile, lines.join('\n') + '\n');
  return tmpFile;
}

/** Build common yt-dlp flags from node parameters and credentials */
async function getCommonFlags(
  context: IExecuteFunctions,
  itemIndex: number,
): Promise<Record<string, any>> {
  const flags: Record<string, any> = {
    noCheckCertificates: true,
    noWarnings: true,
  };

  // Proxy
  const useProxy = context.getNodeParameter('useProxy', itemIndex) as boolean;
  if (useProxy) {
    const proxyUrl = context.getNodeParameter('proxyUrl', itemIndex) as string;
    if (proxyUrl) {
      flags.proxy = proxyUrl;
    }
  }

  // Cookies
  try {
    const credentials = await context.getCredentials('youTubeDLCookies');
    if (credentials?.cookiesJson) {
      const parsed = JSON.parse(credentials.cookiesJson as string);
      if (Array.isArray(parsed) && parsed.length > 0) {
        flags.cookies = writeCookieFile(parsed);
      }
    }
  } catch {
    // No credentials configured
  }

  return flags;
}

/** Clean up temp cookie file if one was created */
function cleanupFlags(flags: Record<string, any>) {
  if (flags.cookies) {
    try {
      fs.unlinkSync(flags.cookies);
    } catch {
      // Ignore cleanup errors
    }
  }
}

/** Find a downloaded file matching a base path (yt-dlp adds the extension) */
function findOutputFile(tmpBase: string): string | undefined {
  const dir = path.dirname(tmpBase);
  const base = path.basename(tmpBase);
  const files = fs.readdirSync(dir).filter((f) => f.startsWith(base));
  if (files.length === 0) return undefined;
  return path.join(dir, files[0]);
}

// ──────────────────────────────────────────────────────────────
// Operations
// ──────────────────────────────────────────────────────────────

async function downloadVideo(
  context: IExecuteFunctions,
  videoUrl: string,
  videoId: string,
  itemIndex: number,
  returnData: INodeExecutionData[],
): Promise<void> {
  const videoQuality = context.getNodeParameter('videoQuality', itemIndex) as string;
  const customFilename = context.getNodeParameter('outputFilename', itemIndex) as string;
  const useProxy = context.getNodeParameter('useProxy', itemIndex) as boolean;

  const flags = await getCommonFlags(context, itemIndex);
  const tmpBase = path.join(
    os.tmpdir(),
    `ytdl_video_${Date.now()}_${Math.random().toString(36).slice(2)}`,
  );

  try {
    // Get metadata first
    const info = await youtubeDlExec(videoUrl, {
      ...flags,
      dumpSingleJson: true,
      noDownload: true,
    });

    // Build format string
    let format: string;
    if (videoQuality === 'lowest') {
      format = 'worst[ext=mp4]/worst';
    } else {
      format = 'best[ext=mp4]/best';
    }

    // Download
    await youtubeDlExec(videoUrl, {
      ...flags,
      format,
      output: `${tmpBase}.%(ext)s`,
    });

    // Find the output file
    const outputFile = findOutputFile(tmpBase);
    if (!outputFile) {
      throw new Error('Download completed but output file not found');
    }

    const buffer = fs.readFileSync(outputFile);
    const ext = path.extname(outputFile).slice(1) || 'mp4';
    const title = info.title || 'video';
    const filename = customFilename || `${title.replace(/[^a-z0-9]/gi, '_')}_${videoId}`;
    const mimeType = ext === 'webm' ? 'video/webm' : 'video/mp4';

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
          mimeType,
          fileExtension: ext,
          fileName: `${filename}.${ext}`,
        },
      },
    });

    // Cleanup output file
    try {
      fs.unlinkSync(outputFile);
    } catch {
      // Ignore
    }
  } finally {
    cleanupFlags(flags);
  }
}

async function downloadAudio(
  context: IExecuteFunctions,
  videoUrl: string,
  videoId: string,
  itemIndex: number,
  returnData: INodeExecutionData[],
): Promise<void> {
  const audioQuality = context.getNodeParameter('audioQuality', itemIndex) as string;
  const customFilename = context.getNodeParameter('outputFilename', itemIndex) as string;
  const useProxy = context.getNodeParameter('useProxy', itemIndex) as boolean;

  const flags = await getCommonFlags(context, itemIndex);
  const tmpBase = path.join(
    os.tmpdir(),
    `ytdl_audio_${Date.now()}_${Math.random().toString(36).slice(2)}`,
  );

  try {
    // Get metadata first
    const info = await youtubeDlExec(videoUrl, {
      ...flags,
      dumpSingleJson: true,
      noDownload: true,
    });

    // Build format string - download native audio (no ffmpeg needed)
    const format = audioQuality === 'lowest' ? 'worstaudio' : 'bestaudio';

    // Download
    await youtubeDlExec(videoUrl, {
      ...flags,
      format,
      output: `${tmpBase}.%(ext)s`,
    });

    // Find the output file
    const outputFile = findOutputFile(tmpBase);
    if (!outputFile) {
      throw new Error('Audio download completed but output file not found');
    }

    const buffer = fs.readFileSync(outputFile);
    const ext = path.extname(outputFile).slice(1) || 'webm';
    const title = info.title || 'audio';
    const filename =
      customFilename || `${title.replace(/[^a-z0-9]/gi, '_')}_${videoId}_audio`;

    // Determine MIME type from extension
    let mimeType: string;
    switch (ext) {
      case 'm4a':
        mimeType = 'audio/mp4';
        break;
      case 'opus':
        mimeType = 'audio/opus';
        break;
      case 'mp3':
        mimeType = 'audio/mpeg';
        break;
      default:
        mimeType = 'audio/webm';
    }

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
          mimeType,
          fileExtension: ext,
          fileName: `${filename}.${ext}`,
        },
      },
    });

    // Cleanup
    try {
      fs.unlinkSync(outputFile);
    } catch {
      // Ignore
    }
  } finally {
    cleanupFlags(flags);
  }
}

async function getVideoInfo(
  context: IExecuteFunctions,
  videoUrl: string,
  videoId: string,
  itemIndex: number,
  returnData: INodeExecutionData[],
): Promise<void> {
  const useProxy = context.getNodeParameter('useProxy', itemIndex) as boolean;
  const flags = await getCommonFlags(context, itemIndex);

  try {
    const info = await youtubeDlExec(videoUrl, {
      ...flags,
      dumpSingleJson: true,
      noDownload: true,
    });

    const formats = (info.formats || []).map((f: any) => ({
      formatId: f.format_id,
      formatNote: f.format_note,
      ext: f.ext,
      quality: f.quality,
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
    cleanupFlags(flags);
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
    description: 'Download YouTube videos and audio using yt-dlp (requires Python 3.9+)',
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
        displayOptions: {
          show: {
            operation: ['downloadVideo'],
          },
        },
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
        displayOptions: {
          show: {
            operation: ['downloadAudio'],
          },
        },
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
        displayOptions: {
          show: {
            useProxy: [true],
          },
        },
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
            await downloadVideo(this, videoUrl, videoId, i, returnData);
            break;

          case 'downloadAudio':
            await downloadAudio(this, videoUrl, videoId, i, returnData);
            break;

          case 'getInfo':
            await getVideoInfo(this, videoUrl, videoId, i, returnData);
            break;

          default:
            throw new NodeOperationError(this.getNode(), `Unknown operation: ${operation}`, {
              itemIndex: i,
            });
        }
      } catch (error: any) {
        if (this.continueOnFail()) {
          const message = error.stderr || error.message || String(error);
          returnData.push({
            json: {
              success: false,
              error: message,
            },
          });
          continue;
        }

        // Provide helpful error for common issues
        const msg = error.message || '';
        if (msg.includes('ENOENT') || msg.includes('not found') || msg.includes('python')) {
          throw new NodeOperationError(
            this.getNode(),
            'yt-dlp requires Python 3.9+ to be installed. For Docker: add "apk add python3" to your Dockerfile.',
            { itemIndex: i },
          );
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
