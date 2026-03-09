import {
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
  NodeOperationError,
} from 'n8n-workflow';
import { Innertube } from 'youtubei.js';

function extractVideoId(input: string): string {
  const trimmed = input.trim();

  // Handle YouTube URLs
  const urlMatch = trimmed.match(
    /(?:youtube\.com\/(?:watch\?.*v=|embed\/|shorts\/|live\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/,
  );
  if (urlMatch) return urlMatch[1];

  // Handle bare video ID
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return trimmed;

  throw new Error(`Could not extract video ID from: ${input}`);
}

function isValidYouTubeInput(input: string): boolean {
  try {
    extractVideoId(input);
    return true;
  } catch {
    return false;
  }
}

async function collectStreamWithTimeout(
  stream: ReadableStream<Uint8Array>,
  timeoutMs: number,
): Promise<Buffer> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let timer: ReturnType<typeof setTimeout>;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reader.cancel();
      reject(new Error(`Download timed out after ${timeoutMs / 1000} seconds`));
    }, timeoutMs);
  });

  const collectPromise = (async () => {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
      return Buffer.concat(chunks);
    } finally {
      clearTimeout(timer!);
    }
  })();

  return Promise.race([collectPromise, timeoutPromise]);
}

async function createInnertubeClient(context: IExecuteFunctions): Promise<Innertube> {
  // Get cookies from credentials
  let cookieString: string | undefined;
  try {
    const credentials = await context.getCredentials('youTubeDLCookies');
    if (credentials?.cookiesJson) {
      const parsed = JSON.parse(credentials.cookiesJson as string);
      if (Array.isArray(parsed) && parsed.length > 0) {
        cookieString = parsed.map((c: any) => `${c.name}=${c.value}`).join('; ');
      }
    }
  } catch {
    // No credentials configured
  }

  // Get proxy settings
  const useProxy = context.getNodeParameter('useProxy', 0) as boolean;
  let proxyUrl: string | undefined;
  if (useProxy) {
    proxyUrl = context.getNodeParameter('proxyUrl', 0) as string;
    if (proxyUrl?.startsWith('socks')) {
      throw new Error(
        'SOCKS proxies are not supported in this version. Please use an HTTP or HTTPS proxy.',
      );
    }
    try {
      new URL(proxyUrl);
    } catch {
      throw new Error(`Invalid proxy URL: ${proxyUrl}`);
    }
  }

  const options: any = {};

  if (cookieString) {
    options.cookie = cookieString;
  }

  if (proxyUrl) {
    // undici is bundled with Node.js 20+ (required by n8n)
    const { ProxyAgent } = require('undici');
    const dispatcher = new ProxyAgent(proxyUrl);
    options.fetch = (input: any, init: any) => {
      return fetch(input, { ...init, dispatcher } as any);
    };
  }

  return Innertube.create(options);
}

async function downloadVideo(
  innertube: Innertube,
  context: IExecuteFunctions,
  videoId: string,
  itemIndex: number,
  returnData: INodeExecutionData[],
): Promise<void> {
  const videoQuality = context.getNodeParameter('videoQuality', itemIndex) as string;
  const videoFilter = context.getNodeParameter('videoFilter', itemIndex) as string;
  const customFilename = context.getNodeParameter('outputFilename', itemIndex) as string;
  const timeoutSeconds = context.getNodeParameter('timeoutSeconds', itemIndex, 300) as number;
  const useProxy = context.getNodeParameter('useProxy', itemIndex) as boolean;

  const info = await innertube.getInfo(videoId);
  const title = info.basic_info?.title || 'video';
  const filename = customFilename || `${title.replace(/[^a-z0-9]/gi, '_')}_${videoId}`;

  // Map quality options
  const quality = videoQuality === 'lowest' || videoQuality === 'lowestaudio'
    ? 'bestefficiency'
    : 'best';

  // Map filter to download type
  let type: string;
  switch (videoFilter) {
    case 'videoonly':
      type = 'video';
      break;
    case 'audioonly':
      type = 'audio';
      break;
    default:
      type = 'video+audio';
  }

  const stream = await innertube.download(videoId, { quality, type } as any);
  const buffer = await collectStreamWithTimeout(stream, timeoutSeconds * 1000);
  const base64Data = buffer.toString('base64');

  const mimeType = videoFilter === 'audioonly' ? 'audio/webm' : 'video/mp4';
  const extension = videoFilter === 'audioonly' ? 'webm' : 'mp4';

  returnData.push({
    json: {
      success: true,
      videoId,
      title,
      author: info.basic_info?.author || '',
      lengthSeconds: String(info.basic_info?.duration || 0),
      viewCount: String(info.basic_info?.view_count || 0),
      downloadType: 'video',
      fileSize: buffer.length,
      proxyUsed: useProxy,
    },
    binary: {
      [filename]: {
        data: base64Data,
        mimeType,
        fileExtension: extension,
        fileName: `${filename}.${extension}`,
      },
    },
  });
}

async function downloadAudio(
  innertube: Innertube,
  context: IExecuteFunctions,
  videoId: string,
  itemIndex: number,
  returnData: INodeExecutionData[],
): Promise<void> {
  const audioQuality = context.getNodeParameter('audioQuality', itemIndex) as string;
  const customFilename = context.getNodeParameter('outputFilename', itemIndex) as string;
  const timeoutSeconds = context.getNodeParameter('timeoutSeconds', itemIndex, 300) as number;
  const useProxy = context.getNodeParameter('useProxy', itemIndex) as boolean;

  const info = await innertube.getInfo(videoId);
  const title = info.basic_info?.title || 'audio';
  const filename =
    customFilename || `${title.replace(/[^a-z0-9]/gi, '_')}_${videoId}_audio`;

  const quality = audioQuality === 'lowest' ? 'bestefficiency' : 'best';
  const stream = await innertube.download(videoId, { type: 'audio', quality } as any);
  const buffer = await collectStreamWithTimeout(stream, timeoutSeconds * 1000);
  const base64Data = buffer.toString('base64');

  returnData.push({
    json: {
      success: true,
      videoId,
      title,
      author: info.basic_info?.author || '',
      lengthSeconds: String(info.basic_info?.duration || 0),
      downloadType: 'audio',
      fileSize: buffer.length,
      proxyUsed: useProxy,
    },
    binary: {
      [filename]: {
        data: base64Data,
        mimeType: 'audio/webm',
        fileExtension: 'webm',
        fileName: `${filename}.webm`,
      },
    },
  });
}

async function getVideoInfo(
  innertube: Innertube,
  context: IExecuteFunctions,
  videoId: string,
  itemIndex: number,
  returnData: INodeExecutionData[],
): Promise<void> {
  const useProxy = context.getNodeParameter('useProxy', itemIndex) as boolean;

  const info = await innertube.getInfo(videoId);

  const allFormats = [
    ...(info.streaming_data?.formats || []),
    ...(info.streaming_data?.adaptive_formats || []),
  ];

  const formats = allFormats.map((format: any) => ({
    itag: format.itag,
    quality: format.quality,
    qualityLabel: format.quality_label,
    mimeType: format.mime_type,
    hasVideo: format.has_video,
    hasAudio: format.has_audio,
    bitrate: format.bitrate,
    fps: format.fps,
    width: format.width,
    height: format.height,
    contentLength: format.content_length,
  }));

  returnData.push({
    json: {
      success: true,
      videoId,
      title: info.basic_info?.title,
      description: info.basic_info?.short_description,
      lengthSeconds: String(info.basic_info?.duration || 0),
      viewCount: String(info.basic_info?.view_count || 0),
      author: {
        name: info.basic_info?.author,
        channelUrl: info.basic_info?.channel?.url,
      },
      thumbnails: info.basic_info?.thumbnail,
      formats,
      keywords: info.basic_info?.keywords,
      isLive: info.basic_info?.is_live,
      videoUrl: `https://www.youtube.com/watch?v=${videoId}`,
      proxyUsed: useProxy,
    },
  });
}

export class YouTubeDL implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'YouTube Downloader',
    name: 'youTubeDL',
    icon: 'file:youtube.svg',
    group: ['transform'],
    version: 1,
    subtitle: '={{$parameter["operation"]}}',
    description: 'Download YouTube videos and audio using pure JavaScript',
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
        displayName: 'Filter',
        name: 'videoFilter',
        type: 'options',
        options: [
          { name: 'Video + Audio', value: 'audioandvideo' },
          { name: 'Video Only', value: 'videoonly' },
          { name: 'Audio Only', value: 'audioonly' },
        ],
        default: 'audioandvideo',
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
        displayName: 'Timeout (Seconds)',
        name: 'timeoutSeconds',
        type: 'number',
        default: 300,
        description: 'Maximum time in seconds to wait for the download to complete',
        displayOptions: {
          show: {
            operation: ['downloadVideo', 'downloadAudio'],
          },
        },
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
        placeholder: 'http://user:pass@proxy:port',
        description: 'Proxy URL (supports HTTP and HTTPS proxies)',
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

    // Create Innertube client once for all items
    const innertube = await createInnertubeClient(this);

    for (let i = 0; i < items.length; i++) {
      try {
        const videoUrl = this.getNodeParameter('videoUrl', i) as string;

        if (!videoUrl) {
          throw new NodeOperationError(this.getNode(), 'Video URL is required', {
            itemIndex: i,
          });
        }

        if (!isValidYouTubeInput(videoUrl)) {
          throw new NodeOperationError(
            this.getNode(),
            `Invalid YouTube URL or video ID: ${videoUrl}`,
            { itemIndex: i },
          );
        }

        const videoId = extractVideoId(videoUrl);

        switch (operation) {
          case 'downloadVideo':
            await downloadVideo(innertube, this, videoId, i, returnData);
            break;

          case 'downloadAudio':
            await downloadAudio(innertube, this, videoId, i, returnData);
            break;

          case 'getInfo':
            await getVideoInfo(innertube, this, videoId, i, returnData);
            break;

          default:
            throw new NodeOperationError(this.getNode(), `Unknown operation: ${operation}`, {
              itemIndex: i,
            });
        }
      } catch (error: any) {
        if (this.continueOnFail()) {
          returnData.push({
            json: {
              success: false,
              error: error.message,
            },
          });
          continue;
        }
        throw error;
      }
    }

    return [returnData];
  }
}
