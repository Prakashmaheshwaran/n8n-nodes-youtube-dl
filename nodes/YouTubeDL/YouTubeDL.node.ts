import {
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
  NodeOperationError,
} from 'n8n-workflow';
import ytdl from '@distube/ytdl-core';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';

function createProxyAgent(proxyUrl: string): HttpsProxyAgent<string> | SocksProxyAgent | undefined {
  if (!proxyUrl) return undefined;
  
  if (proxyUrl.startsWith('socks')) {
    return new SocksProxyAgent(proxyUrl);
  }
  return new HttpsProxyAgent(proxyUrl);
}

async function downloadVideo(
  context: IExecuteFunctions,
  videoUrl: string,
  videoId: string,
  itemIndex: number,
  returnData: INodeExecutionData[]
): Promise<void> {
  const videoQuality = context.getNodeParameter('videoQuality', itemIndex) as string;
  const videoFilter = context.getNodeParameter('videoFilter', itemIndex) as ytdl.Filter;
  const customFilename = context.getNodeParameter('outputFilename', itemIndex) as string;
  const useProxy = context.getNodeParameter('useProxy', itemIndex) as boolean;
  
  let agent: HttpsProxyAgent<string> | SocksProxyAgent | undefined;
  if (useProxy) {
    const proxyUrl = context.getNodeParameter('proxyUrl', itemIndex) as string;
    agent = createProxyAgent(proxyUrl);
  }

  const info = await ytdl.getInfo(videoUrl, { agent: agent as any });
  const filename = customFilename || 
    `${info.videoDetails.title.replace(/[^a-z0-9]/gi, '_')}_${videoId}`;

  const chunks: Buffer[] = [];
  const stream = ytdl(videoUrl, {
    quality: videoQuality as any,
    filter: videoFilter,
    agent: agent as any,
  });

  return new Promise((resolve, reject) => {
    stream.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });

    stream.on('end', () => {
      const buffer = Buffer.concat(chunks);
      const base64Data = buffer.toString('base64');

      const mimeType = videoFilter === 'audioonly' ? 'audio/webm' : 'video/mp4';
      const extension = videoFilter === 'audioonly' ? 'webm' : 'mp4';

      returnData.push({
        json: {
          success: true,
          videoId,
          title: info.videoDetails.title,
          author: info.videoDetails.author.name,
          lengthSeconds: info.videoDetails.lengthSeconds,
          viewCount: info.videoDetails.viewCount,
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
      resolve();
    });

    stream.on('error', (error: Error) => {
      reject(new NodeOperationError(
        context.getNode(),
        `Download failed: ${error.message}`,
        { itemIndex }
      ));
    });
  });
}

async function downloadAudio(
  context: IExecuteFunctions,
  videoUrl: string,
  videoId: string,
  itemIndex: number,
  returnData: INodeExecutionData[]
): Promise<void> {
  const audioQuality = context.getNodeParameter('audioQuality', itemIndex) as string;
  const customFilename = context.getNodeParameter('outputFilename', itemIndex) as string;
  const useProxy = context.getNodeParameter('useProxy', itemIndex) as boolean;
  
  let agent: HttpsProxyAgent<string> | SocksProxyAgent | undefined;
  if (useProxy) {
    const proxyUrl = context.getNodeParameter('proxyUrl', itemIndex) as string;
    agent = createProxyAgent(proxyUrl);
  }

  const info = await ytdl.getInfo(videoUrl, { agent: agent as any });
  const filename = customFilename || 
    `${info.videoDetails.title.replace(/[^a-z0-9]/gi, '_')}_${videoId}_audio`;

  const chunks: Buffer[] = [];
  const stream = ytdl(videoUrl, {
    filter: 'audioonly',
    quality: audioQuality as any,
    agent: agent as any,
  });

  return new Promise((resolve, reject) => {
    stream.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });

    stream.on('end', () => {
      const buffer = Buffer.concat(chunks);
      const base64Data = buffer.toString('base64');

      returnData.push({
        json: {
          success: true,
          videoId,
          title: info.videoDetails.title,
          author: info.videoDetails.author.name,
          lengthSeconds: info.videoDetails.lengthSeconds,
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
      resolve();
    });

    stream.on('error', (error: Error) => {
      reject(new NodeOperationError(
        context.getNode(),
        `Audio download failed: ${error.message}`,
        { itemIndex }
      ));
    });
  });
}

async function getVideoInfo(
  context: IExecuteFunctions,
  videoUrl: string,
  videoId: string,
  itemIndex: number,
  returnData: INodeExecutionData[]
): Promise<void> {
  const useProxy = context.getNodeParameter('useProxy', itemIndex) as boolean;
  
  let agent: HttpsProxyAgent<string> | SocksProxyAgent | undefined;
  if (useProxy) {
    const proxyUrl = context.getNodeParameter('proxyUrl', itemIndex) as string;
    agent = createProxyAgent(proxyUrl);
  }

  const info = await ytdl.getInfo(videoUrl, { agent: agent as any });

  const formats = info.formats.map(format => ({
    itag: format.itag,
    quality: format.quality,
    qualityLabel: format.qualityLabel,
    container: format.container,
    hasVideo: format.hasVideo,
    hasAudio: format.hasAudio,
    videoCodec: format.videoCodec,
    audioCodec: format.audioCodec,
    bitrate: format.bitrate,
    audioBitrate: format.audioBitrate,
    fps: format.fps,
    width: format.width,
    height: format.height,
  }));

  returnData.push({
    json: {
      success: true,
      videoId,
      title: info.videoDetails.title,
      description: info.videoDetails.description,
      lengthSeconds: info.videoDetails.lengthSeconds,
      viewCount: info.videoDetails.viewCount,
      uploadDate: info.videoDetails.uploadDate,
      author: {
        name: info.videoDetails.author.name,
        channelUrl: info.videoDetails.author.channel_url,
        subscriberCount: info.videoDetails.author.subscriber_count,
      },
      thumbnails: info.videoDetails.thumbnails,
      formats: formats,
      category: info.videoDetails.category,
      keywords: info.videoDetails.keywords,
      isLive: info.videoDetails.isLiveContent,
      videoUrl: info.videoDetails.video_url,
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
    credentials: [],
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
          { name: 'Highest Audio', value: 'highestaudio' },
          { name: 'Lowest Audio', value: 'lowestaudio' },
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
        description: 'Proxy URL (supports HTTP, HTTPS, SOCKS4, SOCKS5)',
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
        const videoUrl = this.getNodeParameter('videoUrl', i) as string;
        
        if (!videoUrl) {
          throw new NodeOperationError(
            this.getNode(),
            'Video URL is required',
            { itemIndex: i }
          );
        }

        if (!ytdl.validateURL(videoUrl)) {
          throw new NodeOperationError(
            this.getNode(),
            `Invalid YouTube URL: ${videoUrl}`,
            { itemIndex: i }
          );
        }

        const videoId = ytdl.getVideoID(videoUrl);

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
            throw new NodeOperationError(
              this.getNode(),
              `Unknown operation: ${operation}`,
              { itemIndex: i }
            );
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
