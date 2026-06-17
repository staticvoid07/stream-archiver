const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { google } = require('googleapis');
const { getAuthedClient } = require('./youtubeAuth');
const { uploadVideo, attachCaptions } = require('./youtubeUpload');

async function listPlaylistVideos(accountId, playlistId) {
  const auth = getAuthedClient(accountId);
  const youtube = google.youtube({ version: 'v3', auth });
  const items = [];
  let pageToken;
  do {
    const res = await youtube.playlistItems.list({
      part: ['snippet'],
      playlistId,
      maxResults: 50,
      pageToken,
    });
    for (const item of res.data.items) {
      items.push({
        videoId: item.snippet.resourceId.videoId,
        title: item.snippet.title,
      });
    }
    pageToken = res.data.nextPageToken;
  } while (pageToken);
  return items;
}

async function listChannelVideos(accountId) {
  const auth = getAuthedClient(accountId);
  const youtube = google.youtube({ version: 'v3', auth });
  const channelsRes = await youtube.channels.list({ mine: true, part: ['contentDetails'] });
  const uploadsPlaylistId = channelsRes.data.items[0].contentDetails.relatedPlaylists.uploads;
  return listPlaylistVideos(accountId, uploadsPlaylistId);
}

async function getVideoMetadata(videoId, accountId) {
  const auth = getAuthedClient(accountId);
  const youtube = google.youtube({ version: 'v3', auth });
  const res = await youtube.videos.list({ part: ['snippet'], id: [videoId] });
  const video = res.data.items[0];
  if (!video) throw new Error(`Video ${videoId} not found`);
  return {
    title: video.snippet.title,
    description: video.snippet.description,
    tags: video.snippet.tags || [],
    thumbnailUrl: video.snippet.thumbnails && (video.snippet.thumbnails.maxres || video.snippet.thumbnails.high || video.snippet.thumbnails.default).url,
  };
}

const PROGRESS_TEMPLATE = 'download:%(progress._percent_str)s';
const PROGRESS_LINE_PATTERN = /download:\s*([\d.]+)%/;

function downloadVideo(videoId, destDir, onProgress) {
  return new Promise((resolve, reject) => {
    const outputTemplate = path.join(destDir, `${videoId}.%(ext)s`);
    const child = spawn('yt-dlp', [
      '--newline',
      '--progress-template', PROGRESS_TEMPLATE,
      '-o', outputTemplate,
      `https://www.youtube.com/watch?v=${videoId}`,
    ]);
    let stderr = '';
    let stdoutTail = '';
    child.stdout.on('data', (chunk) => {
      stdoutTail += chunk;
      const lines = stdoutTail.split('\n');
      stdoutTail = lines.pop();
      for (const line of lines) {
        const match = line.match(PROGRESS_LINE_PATTERN);
        if (match && onProgress) onProgress(parseFloat(match[1]));
      }
    });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('exit', (code) => {
      if (code !== 0) {
        return reject(new Error(`yt-dlp exited with code ${code}: ${stderr.slice(-500)}`));
      }
      const files = fs.readdirSync(destDir).filter((f) => f.startsWith(videoId));
      if (files.length === 0) {
        return reject(new Error('yt-dlp produced no output file'));
      }
      resolve(path.join(destDir, files[0]));
    });
    child.on('error', reject);
  });
}

async function downloadThumbnail(url, destPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download thumbnail: ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(destPath, buffer);
}

async function setThumbnail(videoId, thumbnailPath, accountId) {
  const auth = getAuthedClient(accountId);
  const youtube = google.youtube({ version: 'v3', auth });
  await youtube.thumbnails.set({
    videoId,
    media: { body: fs.createReadStream(thumbnailPath) },
  });
}

async function downloadCaptionTrack(videoId, accountId, destPath) {
  const auth = getAuthedClient(accountId);
  const youtube = google.youtube({ version: 'v3', auth });
  const list = await youtube.captions.list({ part: ['snippet'], videoId });
  const track = list.data.items.find((c) => c.snippet.language === 'en') || list.data.items[0];
  if (!track) return null;

  const res = await youtube.captions.download(
    { id: track.id, tfmt: 'srt' },
    { responseType: 'stream' }
  );
  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(destPath);
    res.data.pipe(out);
    res.data.on('error', reject);
    out.on('finish', resolve);
    out.on('error', reject);
  });
  return destPath;
}

async function transferOneVideo(item, job, onProgress) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yt-transfer-'));
  try {
    const metadata = await getVideoMetadata(item.source_video_id, job.source_account_id);
    const videoPath = await downloadVideo(item.source_video_id, tmpDir, (percent) => {
      if (onProgress) onProgress({ stage: 'downloading', percent });
    });

    const destVideoId = await uploadVideo(
      videoPath,
      {
        accountId: job.dest_account_id,
        title: metadata.title,
        description: metadata.description,
        privacy: job.privacy || 'unlisted',
        playlistId: job.dest_playlist_id,
      },
      (percent) => {
        if (onProgress) onProgress({ stage: 'uploading', percent });
      }
    );

    if (metadata.thumbnailUrl) {
      const thumbPath = path.join(tmpDir, 'thumb.jpg');
      try {
        await downloadThumbnail(metadata.thumbnailUrl, thumbPath);
        await setThumbnail(destVideoId, thumbPath, job.dest_account_id);
      } catch (err) {
        // Thumbnail copy is best-effort; don't fail the whole transfer over it.
      }
    }

    try {
      const srtPath = path.join(tmpDir, 'captions.srt');
      const downloaded = await downloadCaptionTrack(item.source_video_id, job.source_account_id, srtPath);
      if (downloaded) {
        await attachCaptions(destVideoId, downloaded, job.dest_account_id);
      }
    } catch (err) {
      // Caption copy is best-effort; don't fail the whole transfer over it.
    }

    return destVideoId;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

module.exports = {
  listPlaylistVideos,
  listChannelVideos,
  transferOneVideo,
};
