import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomBytes } from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = Number(process.env.PORT || 3000);

app.disable('x-powered-by');

app.use((req, res, next) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

app.use((req, res, next) => {
  const origin = req.headers.origin;
  const configured = process.env.APP_URL;
  const allowed = new Set([
    'http://localhost:3000',
    'http://localhost:5173',
    'https://scriptflow-pro.onrender.com',
    configured,
  ].filter(Boolean));

  if (origin && (allowed.has(origin) || origin.endsWith('.onrender.com'))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.json({ limit: '1mb' }));

// Keep health before the SPA wildcard so /health returns JSON.
app.get('/health', (_req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString(), uptime: process.uptime() });
});

// Lightweight same-origin endpoints used by the centralized connection monitor.
// They deliberately avoid external services so monitoring remains reliable and
// does not leak user data to a third party.
app.get('/api/network/ping', (_req, res) => {
  res.set({ 'Cache-Control': 'no-store, no-cache, must-revalidate', 'Content-Type': 'text/plain; charset=utf-8' });
  res.send('ok');
});

app.get('/api/network/download', (req, res) => {
  const requested = Number(req.query.bytes || 196608);
  const bytes = Number.isFinite(requested) ? Math.min(Math.max(Math.floor(requested), 1024), 1048576) : 196608;
  const payload = randomBytes(bytes);
  res.set({ 'Cache-Control': 'no-store, no-cache, must-revalidate', 'Content-Type': 'application/octet-stream', 'Content-Length': String(bytes) });
  res.end(payload);
});

app.post('/api/network/upload', express.raw({ type: 'application/octet-stream', limit: '256kb' }), (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.status(204).end();
});

app.use((req, res, next) => {
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https:",
    "style-src 'self' 'unsafe-inline' https:",
    "img-src 'self' data: https: http: blob:",
    "font-src 'self' data: https:",
    "connect-src 'self' https://*.googleapis.com https://*.firebaseio.com wss://*.firebaseio.com https:",
    "frame-src 'self' https://*.firebaseapp.com https://accounts.google.com https://*.google.com https://fast.com",
    "media-src 'self' https: blob:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
  res.setHeader('Content-Security-Policy', csp);
  next();
});

app.use(express.static(path.join(__dirname, 'dist'), { maxAge: '1d', etag: true }));

app.get('*', (req, res) => {
  if (req.path === '/favicon.ico') return res.status(204).end();
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.use((err, _req, res, _next) => {
  console.error('Server error:', err);
  res.status(500).json({
    error: process.env.NODE_ENV === 'production' ? 'Internal Server Error' : err.message,
  });
});

app.listen(PORT, '0.0.0.0', () => console.log(`ScriptFlow Pro running on port ${PORT}`));
