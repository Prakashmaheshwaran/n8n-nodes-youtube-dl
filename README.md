# n8n-nodes-youtube-dl

[![npm version](https://img.shields.io/npm/v/n8n-nodes-youtube-dl.svg)](https://www.npmjs.com/package/n8n-nodes-youtube-dl)
[![npm downloads](https://img.shields.io/npm/dm/n8n-nodes-youtube-dl.svg)](https://www.npmjs.com/package/n8n-nodes-youtube-dl)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

An n8n community node for downloading videos, audio, transcripts, and subtitles from YouTube and 1000+ other sites. Powered by [yt-dlp](https://github.com/yt-dlp/yt-dlp) — install the node, and it just works. No Python, no FFmpeg, no Docker modifications needed.

## Features

- **Download Video** — Save videos in MP4 or any resolution (360p to 4K)
- **Download Audio** — Extract audio tracks (WebM, M4A, Opus)
- **Get Video Info** — Fetch metadata, thumbnails, formats, and stats without downloading
- **Get Transcript** — Extract video transcripts/subtitles as structured text with timestamps
- **Download Subtitles** — Save subtitle files in SRT, VTT, or ASS formats
- **1000+ Sites** — Works with YouTube, Vimeo, Twitter/X, TikTok, and [many more](https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md)
- **Plug-and-Play** — Auto-downloads the latest yt-dlp binary on install; auto-fixes Alpine/musl Docker environments at runtime
- **Resolution Selection** — Choose from Highest, 4K, 1440p, 1080p, 720p, 480p, 360p, or Lowest
- **Proxy Support** — Route requests through HTTP, HTTPS, or SOCKS5 proxies
- **Cookie Authentication** — Access age-restricted or private videos with browser cookies
- **Custom yt-dlp Flags** — Pass any yt-dlp flags for advanced use cases (rate limiting, SponsorBlock, geo-bypass, etc.)
- **Zero Runtime Dependencies** — The npm package has no `node_modules` dependencies at all
- **Memory Efficient** — Streams large files instead of buffering them in memory

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
3. Enter a video URL (YouTube, Vimeo, Twitter, TikTok, or any supported site)
4. Choose resolution: **Highest**, **4K**, **1080p**, **720p**, **480p**, **360p**, or **Lowest**
5. The node outputs binary data you can pass to **Write Binary File**, **S3**, **Google Drive**, etc.

### Download Audio

1. Set the operation to **Download Audio**
2. Enter the video URL
3. Choose quality: **Highest** or **Lowest**
4. Audio is extracted in the best available format (WebM, M4A, Opus)

### Get Video Info

1. Set the operation to **Get Video Info**
2. Enter the video URL
3. Returns JSON metadata: title, description, duration, view count, upload date, channel info, thumbnails, and all available formats with codecs, bitrates, and resolutions

### Get Transcript

1. Set the operation to **Get Transcript**
2. Enter the video URL
3. Choose subtitle language (default: `en`)
4. Returns the full transcript as text plus timestamped segments — perfect for AI summarization, search indexing, or content repurposing

### Download Subtitles

1. Set the operation to **Download Subtitles**
2. Enter the video URL
3. Choose language and format (SRT, VTT, or ASS)
4. Returns the subtitle file as binary data

## Node Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| **Operation** | Select | Download Video, Download Audio, Get Video Info, Get Transcript, or Download Subtitles |
| **Video URL** | String | YouTube URL, video ID, or any URL supported by yt-dlp |
| **Video Quality** | Select | Highest, 4K, 1440p, 1080p, 720p, 480p, 360p, or Lowest |
| **Audio Quality** | Select | Highest or Lowest |
| **Language** | String | Subtitle/transcript language code (e.g. `en`, `es`, `fr`, `de`, `ja`) |
| **Subtitle Format** | Select | SRT, VTT, or ASS |
| **Output Filename** | String | Custom filename (optional — auto-generated from title if blank) |
| **Use Proxy** | Toggle | Enable proxy routing |
| **Proxy URL** | String | `http://user:pass@host:port` or `socks5://host:port` |
| **Custom yt-dlp Flags** | String | Additional yt-dlp flags (e.g. `--limit-rate 1M --geo-bypass`) |

## Cookie Authentication

For age-restricted or private videos, configure **YouTube Cookies** credentials:

1. Install a browser cookie export extension (e.g. [EditThisCookie](https://www.editthiscookie.com/))
2. Export your YouTube cookies as JSON
3. In n8n, go to **Credentials > Add Credential > YouTube Cookies**
4. Paste the JSON array

## How It Works

The node uses [yt-dlp](https://github.com/yt-dlp/yt-dlp), the most actively maintained video downloader. Here's how the binary management works:

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

The **Get Transcript** operation returns the full transcript text, timestamped segments with start/end times, and word count.

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
- Use the custom flags field to pass `--cookies-from-browser` if running locally

### No subtitles found

Not all videos have subtitles. Try:
- A different language code (e.g. `en`, `en-US`, `auto`)
- The auto-generated subtitle option (enabled by default)

## Legal Notice

Downloading videos may violate the Terms of Service of some platforms. This tool is intended for:
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

- [yt-dlp](https://github.com/yt-dlp/yt-dlp) — The powerful video downloader that powers this node
- Built following [n8n community node](https://docs.n8n.io/integrations/creating-nodes/) best practices
