# n8n-nodes-youtube-dl

A community node for n8n that allows downloading YouTube videos and audio using pure JavaScript. No binary installation required!

## Features

- ✅ **Download Video** - Download YouTube videos in various qualities
- ✅ **Download Audio** - Extract audio from YouTube videos
- ✅ **Get Video Info** - Retrieve video metadata without downloading
- ✅ **Pure JavaScript** - No binary dependencies, works in Docker
- ✅ **Quality Selection** - Choose from highest, lowest, or specific quality

## Installation

### Install via n8n Community Nodes

1. Go to **Settings** > **Community Nodes** in your n8n instance
2. Click **Install**
3. Enter `n8n-nodes-youtube-dl`
4. Click **Install Node**

### Manual Installation

```bash
npm install n8n-nodes-youtube-dl
```

## Usage

### Download Video

1. Add the **YouTube Downloader** node to your workflow
2. Select **Download Video** operation
3. Enter the YouTube URL
4. Choose video quality and filter options
5. Run the node

### Download Audio

1. Select **Download Audio** operation
2. Enter the YouTube URL
3. Choose audio quality
4. The audio will be downloaded in WebM format

### Get Video Info

1. Select **Get Video Info** operation
2. Enter the YouTube URL
3. Get detailed metadata including title, author, duration, thumbnails, and available formats

## Parameters

| Parameter | Description | Required |
|-----------|-------------|----------|
| Video URL | YouTube video URL or ID | Yes |
| Operation | Download Video / Download Audio / Get Info | Yes |
| Video Quality | Highest / Lowest / Highest Audio / Lowest Audio | No |
| Filter | Video + Audio / Video Only / Audio Only | No |
| Output Filename | Custom filename (optional) | No |

## Output

### Binary Data

The node returns binary data that can be:
- Saved to disk using the **Write Binary File** node
- Uploaded to cloud storage
- Processed by other nodes

### JSON Data

The node also returns JSON metadata:
```json
{
  "success": true,
  "videoId": "...",
  "title": "Video Title",
  "author": "Channel Name",
  "lengthSeconds": 120,
  "viewCount": 100000,
  "downloadType": "video",
  "fileSize": 1234567
}
```

## Important Notes

### Legal Considerations

⚠️ **Warning**: Downloading YouTube videos may violate YouTube's Terms of Service. This node is intended for:
- Downloading your own content
- Videos with Creative Commons licenses
- Content you have permission to download

Please respect copyright laws and YouTube's Terms of Service.

### Rate Limiting

YouTube may rate-limit requests. The node includes basic error handling, but excessive use may result in temporary blocks.

### Memory Usage

Large videos consume memory during download. Ensure your n8n instance has sufficient memory allocated.

## Technical Details

This node uses [`@distube/ytdl-core`](https://www.npmjs.com/package/@distube/ytdl-core), a pure JavaScript YouTube downloader that doesn't require any binary installation.

**Key benefits:**
- ✅ No Python or FFmpeg required
- ✅ Works in Docker containers
- ✅ Works on all platforms (Windows, macOS, Linux)
- ✅ Smaller footprint than yt-dlp

## Development

```bash
# Clone the repository
git clone https://github.com/prakashmaheshwaran/n8n-nodes-youtube-dl.git

# Install dependencies
npm install

# Build the project
npm run build

# Link to n8n for testing
npm link
```

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Contributing

Contributions are welcome! Please submit a pull request or open an issue.

## Support

For issues or feature requests, please use the [GitHub Issues](https://github.com/prakashmaheshwaran/n8n-nodes-youtube-dl/issues) page.

## Credits

- Built with [`@distube/ytdl-core`](https://github.com/distubejs/ytdl-core)
- Inspired by n8n community node best practices
