const fs = require('fs');
const { PassThrough } = require('stream');
const { google } = require('googleapis');
const { getAuthedClient } = require('./youtubeAuth');

function progressStream(filepath, onProgress) {
  const totalBytes = fs.statSync(filepath).size;
  let uploadedBytes = 0;
  const source = fs.createReadStream(filepath);
  const counter = new PassThrough();
  source.on('data', (chunk) => {
    uploadedBytes += chunk.length;
    if (onProgress) onProgress(totalBytes === 0 ? 100 : (uploadedBytes / totalBytes) * 100);
  });
  source.pipe(counter);
  return counter;
}

async function uploadVideo(filepath, { accountId, title, description, privacy, playlistId }, onProgress) {
  const auth = getAuthedClient(accountId);
  const youtube = google.youtube({ version: 'v3', auth });

  const res = await youtube.videos.insert(
    {
      part: ['snippet', 'status'],
      requestBody: {
        snippet: { title, description: description || '' },
        status: { privacyStatus: privacy || 'unlisted' },
      },
      media: {
        body: progressStream(filepath, onProgress),
      },
    },
    {
      // googleapis performs a resumable upload automatically when given a stream body.
    }
  );

  const videoId = res.data.id;

  if (playlistId) {
    await addToPlaylist(videoId, playlistId, accountId);
  }

  return videoId;
}

async function attachCaptions(videoId, srtPath, accountId) {
  const auth = getAuthedClient(accountId);
  const youtube = google.youtube({ version: 'v3', auth });
  await youtube.captions.insert({
    part: ['snippet'],
    requestBody: {
      snippet: { videoId, language: 'en', name: 'English', isDraft: false },
    },
    media: {
      body: fs.createReadStream(srtPath),
    },
  });
}

async function addToPlaylist(videoId, playlistId, accountId) {
  const auth = getAuthedClient(accountId);
  const youtube = google.youtube({ version: 'v3', auth });
  await youtube.playlistItems.insert({
    part: ['snippet'],
    requestBody: {
      snippet: {
        playlistId,
        resourceId: { kind: 'youtube#video', videoId },
      },
    },
  });
}

module.exports = { uploadVideo, attachCaptions, addToPlaylist };
