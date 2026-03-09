import type {
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
  IDataObject,
  IBinaryKeyData,
} from 'n8n-workflow';

import ytdl from '@distube/ytdl-core';

export class YouTubeDL implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'YouTube DL',
    name: 'youTubeDL',
    icon: 'file:youtube.svg',
    group: ['transform'],
    version: 1,
    subtitle: '={{$parameter["operation"]}}',
    description: 'Download YouTube videos and audio',
    defaults: {
      name: 'YouTube DL',
    },
    inputs: ['main'],
    outputs: ['main'],
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
            action: 'Download video from YouTube',
          },
          {
            name: 'Download Audio',
            value: 'downloadAudio',
            description: 'Download audio only from YouTube',
            action: 'Download audio only from YouTube',
          },
          {
            name: 'Get Video Info',
            value: 'getVideoInfo',
            description: 'Get metadata and info about a YouTube video',
            action: 'Get metadata and info about a YouTube video',
          },
        ],
        default: 'downloadVideo',
      },
      {
        displayName: 'Video URL',
        name: 'videoUrl',
        type: 'string',
        default: '',
        placeholder: 'https://www.youtube.com/watch?v=...',
        required: true,
        displayOptions: {
          show: {
            operation: ['downloadVideo', 'downloadAudio', 'getVideoInfo'],
          },
        },
        description: 'The URL of the YouTube video',
      },
      {
        displayName: 'Quality',
        name: 'quality',
        type: 'options',
        options: [
          {
            name: 'Highest',
            value: 'highest',
            description: 'Highest quality available',
          },
          {
            name: 'Lowest',
            value: 'lowest',
            description: 'Lowest quality available',
          },
          {
            name: '1080p',
            value: '1080p',
            description: '1080p or lower',
          },
          {
            name: '720p',
            value: '720p',
            description: '720p or lower',
          },
          {
            name: '480p',
            value: '480p',
            description: '480p or lower',
          },
          {
            name: '360p',
            value: '360p',
            description: '360p or lower',
          },
        ],
        default: 'highest',
        displayOptions: {
          show: {
            operation: ['downloadVideo'],
          },
        },
        description: 'Video quality to download',
      },
      {
        displayName: 'Audio Quality',
        name: 'audioQuality',
        type: 'options',
        options: [
          {
            name: 'Highest',
            value: 'highest',
            description: 'Highest audio quality available',
          },
          {
            name: 'Lowest',
            value: 'lowest',
            description: 'Lowest audio quality available',
          },
          {
            name: 'Medium',
            value: 'medium',
            description: 'Medium audio quality',
          },
        ],
        default: 'highest',
        displayOptions: {
          show: {
            operation: ['downloadAudio'],
          },
        },
        description: 'Audio quality to download',
      },
      {
        displayName: 'Format',
        name: 'format',
        type: 'options',
        options: [
          {
            name: 'MP3',
            value: 'mp3',
          },
          {
            name: 'MP4 (Audio Only)',
            value: 'm4a',
          },
          {
            name: 'WebM',
            value: 'webm',
          },
        ],
        default: 'mp3',
        displayOptions: {
          show: {
            operation: ['downloadAudio'],
          },
        },
        description: 'Audio format to download',
      },
      {
        displayName: 'Additional Options',
        name: 'additionalOptions',
        type: 'collection',
        placeholder: 'Add Option',
        default: {},
        displayOptions: {
          show: {
            operation: ['downloadVideo', 'downloadAudio'],
          },
        },
        options: [
          {
            displayName: 'Start Time',
            name: 'startTime',
            type: 'number',
            default: 0,
            placeholder: '0',
            description: 'Start time in seconds (for partial downloads)',
          },
          {
            displayName: 'End Time',
            name: 'endTime',
            type: 'number',
            default: 0,
            placeholder: '0',
            description: 'End time in seconds (0 = until end)',
          },
          {
            displayName: 'File Name',
            name: 'fileName',
            type: 'string',
            default: '',
            placeholder: 'video',
            description: 'Custom file name (without extension)',
          },
        ],
      },
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const returnData: INodeExecutionData[] = [];

    for (let i = 0; i < items.length; i++) {
      try {
        const operation = this.getNodeParameter('operation', i) as string;
        const videoUrl = this.getNodeParameter('videoUrl', i) as string;

        if (!videoUrl || !ytdl.validateURL(videoUrl)) {
          throw new Error(`Invalid YouTube URL: ${videoUrl}`);
        }

        const videoId = ytdl.getVideoID(videoUrl);

        if (operation === 'getVideoInfo') {
          const info = await ytdl.getInfo(videoUrl);
          const videoInfo: IDataObject = {
            id: info.videoDetails.videoId,
            title: info.videoDetails.title,
            description: info.videoDetails.description,
            author: info.videoDetails.author.name,
            authorId: info.videoDetails.author.id,
            lengthSeconds: parseInt(info.videoDetails.lengthSeconds, 10),
            viewCount: parseInt(info.videoDetails.viewCount, 10),
            likes: info.videoDetails.likes,
            uploadDate: info.videoDetails.uploadDate,
            publishDate: info.videoDetails.publishDate,
            thumbnails: info.videoDetails.thumbnails,
            category: info.videoDetails.category,
            keywords: info.videoDetails.keywords,
            averageRating: info.videoDetails.averageRating,
            videoUrl: videoUrl,
            embedUrl: `https://www.youtube.com/embed/${videoId}`,
            videoId: videoId,
          };

          returnData.push({
            json: videoInfo,
            pairedItem: { item: i },
          });
        } else if (operation === 'downloadVideo') {
          const quality = this.getNodeParameter('quality', i) as string;
          const additionalOptions = this.getNodeParameter(
            'additionalOptions',
            i
          ) as IDataObject;

          const info = await ytdl.getInfo(videoUrl);
          const title = (additionalOptions.fileName as string) || info.videoDetails.title;
          const sanitizedTitle = title.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_');

          let qualityOption: string;
          switch (quality) {
            case 'highest':
              qualityOption = 'highest';
              break;
            case 'lowest':
              qualityOption = 'lowest';
              break;
            case '1080p':
              qualityOption = 'highestvideoheight:1080';
              break;
            case '720p':
              qualityOption = 'highestvideoheight:720';
              break;
            case '480p':
              qualityOption = 'highestvideoheight:480';
              break;
            case '360p':
              qualityOption = 'highestvideoheight:360';
              break;
            default:
              qualityOption = 'highest';
          }

          const streamOptions: ytdl.downloadOptions = {
            quality: qualityOption as ytdl.quality,
            filter: 'audioandvideo',
          };

          if (additionalOptions.startTime) {
            streamOptions.begin = `${additionalOptions.startTime}s`;
          }

          const stream = ytdl(videoUrl, streamOptions);
          const chunks: Buffer[] = [];

          await new Promise<void>((resolve, reject) => {
            stream.on('data', (chunk: Buffer) => {
              chunks.push(chunk);
            });

            stream.on('end', () => {
              resolve();
            });

            stream.on('error', (error: Error) => {
              reject(error);
            });
          });

          const buffer = Buffer.concat(chunks);
          const binaryData: IBinaryKeyData = {
            data: buffer.toString('base64'),
            mimeType: 'video/mp4',
            fileName: `${sanitizedTitle}.mp4`,
            fileExtension: 'mp4',
          };

          returnData.push({
            json: {
              success: true,
              title: info.videoDetails.title,
              videoId: videoId,
              fileName: `${sanitizedTitle}.mp4`,
              fileSize: buffer.length,
              quality: quality,
            },
            binary: {
              video: binaryData,
            },
            pairedItem: { item: i },
          });
        } else if (operation === 'downloadAudio') {
          const audioQuality = this.getNodeParameter('audioQuality', i) as string;
          const format = this.getNodeParameter('format', i) as string;
          const additionalOptions = this.getNodeParameter(
            'additionalOptions',
            i
          ) as IDataObject;

          const info = await ytdl.getInfo(videoUrl);
          const title = (additionalOptions.fileName as string) || info.videoDetails.title;
          const sanitizedTitle = title.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_');

          let qualityOption: string;
          switch (audioQuality) {
            case 'highest':
              qualityOption = 'highest';
              break;
            case 'lowest':
              qualityOption = 'lowest';
              break;
            case 'medium':
              qualityOption = 'highestaudio';
              break;
            default:
              qualityOption = 'highest';
          }

          let mimeType: string;
          let extension: string;
          let filter: 'audio' | 'audioonly';

          switch (format) {
            case 'mp3':
              mimeType = 'audio/mpeg';
              extension = 'mp3';
              filter = 'audio';
              break;
            case 'm4a':
              mimeType = 'audio/mp4';
              extension = 'm4a';
              filter = 'audio';
              break;
            case 'webm':
              mimeType = 'audio/webm';
              extension = 'webm';
              filter = 'audioonly';
              break;
            default:
              mimeType = 'audio/mpeg';
              extension = 'mp3';
              filter = 'audio';
          }

          const streamOptions: ytdl.downloadOptions = {
            quality: qualityOption as ytdl.quality,
            filter: filter,
          };

          if (additionalOptions.startTime) {
            streamOptions.begin = `${additionalOptions.startTime}s`;
          }

          const stream = ytdl(videoUrl, streamOptions);
          const chunks: Buffer[] = [];

          await new Promise<void>((resolve, reject) => {
            stream.on('data', (chunk: Buffer) => {
              chunks.push(chunk);
            });

            stream.on('end', () => {
              resolve();
            });

            stream.on('error', (error: Error) => {
              reject(error);
            });
          });

          const buffer = Buffer.concat(chunks);
          const binaryData: IBinaryKeyData = {
            data: buffer.toString('base64'),
            mimeType: mimeType,
            fileName: `${sanitizedTitle}.${extension}`,
            fileExtension: extension,
          };

          returnData.push({
            json: {
              success: true,
              title: info.videoDetails.title,
              videoId: videoId,
              fileName: `${sanitizedTitle}.${extension}`,
              fileSize: buffer.length,
              format: format,
              quality: audioQuality,
            },
            binary: {
              audio: binaryData,
            },
            pairedItem: { item: i },
          });
        }
      } catch (error) {
        if (this.continueOnFail()) {
          returnData.push({
            json: {
              error: error instanceof Error ? error.message : String(error),
            },
            pairedItem: { item: i },
          });
          continue;
        }
        throw error;
      }
    }

    return [returnData];
  }
}
