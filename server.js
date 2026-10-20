// ebice.site backend — requires: Node 18+, yt-dlp and ffmpeg installed on the server
const express = require('express');
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const YTDLP = process.env.YTDLP_PATH || 'yt-dlp';

// CORS: la web (GitHub Pages) vive en otro dominio que este backend
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'https://ebice.site,https://www.ebice.site')
  .split(',').map(s => s.trim());
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.set('trust proxy', 1); // detrás de Render/Railway/Nginx, para que el rate limit vea la IP real
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- Helpers ----------
const ALLOWED_HOSTS = new Set([
  'youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be'
]);

function validUrl(raw) {
  try {
    const u = new URL(raw);
    return ['http:', 'https:'].includes(u.protocol) && ALLOWED_HOSTS.has(u.hostname) ? u.href : null;
  } catch { return null; }
}

// Very simple per-IP rate limit: 20 requests / minute
const hits = new Map();
function rateLimit(req, res, next) {
  const now = Date.now();
  const arr = (hits.get(req.ip) || []).filter(t => now - t < 60000);
  arr.push(now);
  hits.set(req.ip, arr);
  if (arr.length > 20) return res.status(429).json({ message: 'Too many requests, wait a minute.' });
  next();
}

function run(args, timeout = 300000) {
  return new Promise((resolve, reject) => {
    execFile(YTDLP, args, { timeout, maxBuffer: 20 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(new Error((stderr || err.message).split('\n').filter(Boolean).pop()));
      resolve(stdout);
    });
  });
}

function fmtDuration(s) {
  if (!s) return '';
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const p = n => String(n).padStart(2, '0');
  return h ? `${h}:${p(m)}:${p(sec)}` : `${m}:${p(sec)}`;
}

// ---------- GET /info?url= ----------
app.get('/info', rateLimit, async (req, res) => {
  const url = validUrl(req.query.url);
  if (!url) return res.status(400).json({ message: 'Invalid YouTube URL.' });
  try {
    const out = await run(['-J', '--no-playlist', '--no-warnings', '--', url], 60000);
    const d = JSON.parse(out);
    res.json({
      title: d.title,
      channel: d.uploader || d.channel,
      thumbnail: d.thumbnail,
      duration: fmtDuration(d.duration),
      views: d.view_count
    });
  } catch (e) {
    res.status(500).json({ message: 'Could not get video info: ' + e.message });
  }
});

// ---------- GET /download?url=&format=mp4|mp3 ----------
app.get('/download', rateLimit, async (req, res) => {
  const url = validUrl(req.query.url);
  const format = req.query.format === 'mp3' ? 'mp3' : 'mp4';
  if (!url) return res.status(400).json({ message: 'Invalid YouTube URL.' });

  const id = crypto.randomBytes(8).toString('hex');
  const base = path.join(os.tmpdir(), `ebice-${id}`);
  const common = ['--no-playlist', '--no-warnings', '-o', `${base}.%(ext)s`];
  const args = format === 'mp3'
    ? [...common, '-f', 'bestaudio/best', '-x', '--audio-format', 'mp3', '--audio-quality', '192K', '--', url]
    : [...common, '-f', 'bv*[height<=1080]+ba/b[height<=1080]/b', '--merge-output-format', 'mp4', '--', url];

  const file = `${base}.${format}`;
  const cleanup = () => fs.unlink(file, () => {});
  try {
    await run(args);
    if (!fs.existsSync(file)) throw new Error('Output file not found.');
    res.download(file, `video.${format}`, cleanup);
    res.on('close', cleanup);
  } catch (e) {
    cleanup();
    if (!res.headersSent) res.status(500).json({ message: 'Download failed: ' + e.message });
  }
});

app.listen(PORT, () => console.log(`ebice.site running on http://localhost:${PORT}`));
