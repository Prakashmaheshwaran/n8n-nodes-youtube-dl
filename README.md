# n8n-nodes-youtube-dl

[![n8n-community-node](https://img.shields.io/badge/n8n-community%20node-brightgreen)](https://n8n.io/)

This is an n8n community node for downloading YouTube videos and audio. It uses [`@distube/ytdl-core`](https://github.com/distubejs/ytdl-core), a pure JavaScript library with no binary dependencies.

## Features

- **Download Video**: Download full YouTube videos with quality selection (360p, 480p, 720p, 1080p, highest, lowest)
- **Download Audio**: Extract audio only from YouTube videos in multiple formats (MP3, M4A, WebM)
- **Get Video Info**: Retrieve comprehensive metadata including title, description, author, view count, likes, thumbnails, and more
- **Pure JavaScript**: No external binaries or dependencies required
- **Partial Downloads**: Support for downloading specific time ranges
- **Custom File Names**: Option to specify custom file names for downloads

## Installation

### Community Nodes (Recommended)

1. Go to **Settings > Community Nodes** in your n8n instance
2. Click **Install**
3. Enter `n8n-nodes-youtube-dl`
4. Click **Install**

### Manual Installation

```bash
npm install n8n-nodes-youtube-dl
```

## Usage

### Download Video

1. Add the **YouTube DL** node to your workflow
2. Select **Download Video** as the operation
3. Enter the YouTube video URL
4. Choose the desired quality (highest, lowest, 1080p, 720p, 480p, or 360p)
5. (Optional) Configure additional options:
   - **Start Time**: Begin download at a specific timestamp (in seconds)
   - **End Time**: End download at a specific timestamp (0 = until end)
   - **File Name**: Custom file name without extension

### Download Audio

1. Add the **YouTube DL** node to your workflow
2. Select **Download Audio** as the operation
3. Enter the YouTube video URL
4. Choose audio quality and format (MP3, M4A, or WebM)
5. (Optional) Configure additional options (start time, end time, custom file name)

### Get Video Info

1. Add the **YouTube DL** node to your workflow
2. Select **Get Video Info** as the operation
3. Enter the YouTube video URL
4. The node will return metadata including:
   - Title and description
   - Author and channel information
   - View count and likes
   - Upload and publish dates
   - Thumbnails
   - Duration
   - Keywords and category

## Output

### Download Operations

Returns JSON data with:
- `success`: Boolean indicating successful download
- `title`: Video title
- `videoId`: YouTube video ID
- `fileName`: Downloaded file name
- `fileSize`: File size in bytes
- `quality`: Quality setting used
- `format`: Audio format (audio downloads only)

The binary file is attached to the output and can be processed by subsequent nodes (e.g., Write Binary File, HTTP Request, etc.).

### Get Video Info

Returns JSON data with:
- `id`: Video ID
- `title`: Video title
- `description`: Video description
- `author`: Channel name
- `authorId`: Channel ID
- `lengthSeconds`: Video duration in seconds
- `viewCount`: View count
- `likes`: Like count
- `uploadDate`: Upload date
- `publishDate`: Publish date
- `thumbnails`: Array of thumbnail objects
- `category`: Video category
- `keywords`: Array of keywords
- `averageRating`: Average rating
- `videoUrl`: Original URL
- `embedUrl`: Embed URL
- `videoId`: Video ID

## Error Handling

The node includes built-in error handling:
- Invalid YouTube URLs are detected and reported
- Network errors are caught and can be handled with n8n's continue-on-fail option
- Partial download failures are reported with detailed error messages

## Compatibility

- Requires n8n version 1.0.0 or higher
- Compatible with Node.js 18.x and higher

## Resources

- [n8n Community Nodes Documentation](https://docs.n8n.io/integrations/creating-nodes/)
- [@distube/ytdl-core Documentation](https://github.com/distubejs/ytdl-core)

## License

[MIT](LICENSE)

## Support

For issues and feature requests, please visit the [GitHub repository](https://github.com/prakashmaheshwaran/n8n-nodes-youtube-dl).
