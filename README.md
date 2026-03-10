# n8n-nodes-youtube-dl

[![npm version](https://img.shields.io/npm/v/n8n-nodes-youtube-dl.svg)](https://www.npmjs.com/package/n8n-nodes-youtube-dl)
[![npm downloads](https://img.shields.io/npm/dm/n8n-nodes-youtube-dl.svg)](https://www.npmjs.com/package/n8n-nodes-youtube-dl)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

An n8n community node for downloading YouTube videos and audio. Powered by [yt-dlp](https://github.com/yt-dlp/yt-dlp) — install the node, and it just works. No Python, no FFmpeg, no Docker modifications needed.

## Features

- **Download Video** — Save YouTube videos in MP4 or best available format
- **Download Audio** — Extract audio tracks (WebM, M4A, Opus)
- **Get Video Info** — Fetch metadata, thumbnails, formats, and stats without downloading
- **Plug-and-Play** — Auto-downloads the latest yt-dlp binary on install; auto-fixes Alpine/musl Docker environments at runtime
- **Proxy Support** — Route requests through HTTP, HTTPS, or SOCKS5 proxies
- **Cookie Authentication** — Access age-restricted or private videos with browser cookies
- **Zero Runtime Dependencies** — The npm package has no `node_modules` dependencies at all

## Installation

### Via n8n Community Nodes (Recommended)

1. Open **Settings > Community Nodes** in your n8n instance
2. Enter `n8n-nodes-youtube-dl`
3. Click **Install**

### Via npm

```bash
cd ~/.n8n/custom
npm install n8n-nodes-youtube-dl
```

The yt-dlp binary downloads automatically during `npm install`. If the download fails (e.g. air-gapped environments), the node will retry automatically on first use.

## Usage

### Download Video

1. Add the **YouTube Downloader** node to your workflow
2. Set the operation to **Download Video**
3. Enter a YouTube URL (or just a video ID like `dQw4w9WgXcQ`)
4. Choose quality: **Highest** or **Lowest**
5. The node outputs binary data you can pass to **Write Binary File**, **S3**, **Google Drive**, etc.

### Download Audio

1. Set the operation to **Download Audio**
2. Enter the YouTube URL
3. Choose quality: **Highest** or **Lowest**
4. Audio is extracted in the best available format (WebM, M4A, Opus)

### Get Video Info

1. Set the operation to **Get Video Info**
2. Enter the YouTube URL
3. Returns JSON metadata: title, description, duration, view count, upload date, channel info, thumbnails, and all available formats with codecs, bitrates, and resolutions

## Node Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| **Operation** | Select | Download Video, Download Audio, or Get Video Info |
| **Video URL** | String | YouTube URL, short URL, or 11-character video ID |
| **Video Quality** | Select | Highest or Lowest (video operations only) |
| **Audio Quality** | Select | Highest or Lowest (audio operation only) |
| **Output Filename** | String | Custom filename (optional — auto-generated from title if blank) |
| **Proxy** | Toggle | Enable proxy routing |
| **Proxy URL** | String | `http://user:pass@host:port` or `socks5://host:port` |

## Cookie Authentication

For age-restricted or private videos, configure **YouTube Cookies** credentials:

1. Install a browser cookie export extension (e.g. [EditThisCookie](https://www.editthiscookie.com/))
2. Export your YouTube cookies as JSON
3. In n8n, go to **Credentials > Add Credential > YouTube Cookies**
4. Paste the JSON array

## How It Works

The node uses [yt-dlp](https://github.com/yt-dlp/yt-dlp), the most actively maintained YouTube downloader. Here's how the binary management works:

1. **At install time** (`npm install`): Downloads the latest standalone yt-dlp binary for your platform
2. **At runtime** (if the binary is missing): Auto-downloads and caches the binary with curl/wget/https fallbacks
3. **On Alpine/musl** (Docker): Detects the musl libc incompatibility and automatically deploys a tiny compatibility shim via `LD_PRELOAD` — no root access or package installation needed

### Supported Platforms

| Platform | Architecture | Status |
|----------|-------------|--------|
| Linux (glibc) | x64, arm64 | Fully supported |
| Linux (musl/Alpine) | x64, arm64 | Fully supported (auto-shim) |
| macOS | x64, arm64 | Fully supported |
| Windows | x64 | Fully supported |

### Docker / n8n Cloud

This node works out of the box with the official `n8nio/n8n` Docker image (Alpine-based). No custom Dockerfile or `apk install` commands needed.

## Output

### Binary Data (Download operations)

The node returns binary data attached to the output item. Use it with:
- **Write Binary File** — Save to disk
- **S3 / Google Drive / Dropbox** — Upload to cloud storage
- **Send Email** — Attach to emails
- **HTTP Request** — POST to an API

### JSON Metadata

Every operation returns structured JSON:

```json
{
  "success": true,
  "videoId": "dQw4w9WgXcQ",
  "title": "Video Title",
  "author": "Channel Name",
  "lengthSeconds": "212",
  "viewCount": "1500000000",
  "downloadType": "video",
  "fileSize": 15234567,
  "format": "mp4"
}
```

The **Get Video Info** operation returns additional fields: description, upload date, channel URL, subscriber count, thumbnails, all available formats with codec/bitrate/resolution details, categories, tags, and live status.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `YT_DLP_PATH` | Path to a custom yt-dlp binary (skips auto-download) |
| `N8N_USER_FOLDER` | Custom n8n data directory (default: `~/.n8n`) |

## Troubleshooting

### Binary not found / download fails

The node tries multiple download methods (curl, wget, Node.js https) and multiple directories. If all fail:

```bash
# Option 1: Install yt-dlp manually
pip install yt-dlp

# Option 2: Point to an existing binary
export YT_DLP_PATH=/usr/local/bin/yt-dlp

# Option 3: Reinstall the node
npm install n8n-nodes-youtube-dl
```

### Rate limiting / bot detection

YouTube may block requests from server IPs. Solutions:
- Configure **YouTube Cookies** credentials (see above)
- Use a **proxy** (residential proxies work best)

## Legal Notice

Downloading YouTube videos may violate YouTube's Terms of Service. This tool is intended for:
- Downloading your own content
- Videos with Creative Commons licenses
- Content you have explicit permission to download

Please respect copyright laws and content creators' rights.

## Development

```bash
git clone https://github.com/prakashmaheshwaran/n8n-nodes-youtube-dl.git
cd n8n-nodes-youtube-dl
npm install
npm run build
npm link  # Link to your local n8n for testing
```

## License

[MIT](LICENSE)

## Credits

- [yt-dlp](https://github.com/yt-dlp/yt-dlp) — The powerful YouTube downloader that powers this node
- Built following [n8n community node](https://docs.n8n.io/integrations/creating-nodes/) best practices
