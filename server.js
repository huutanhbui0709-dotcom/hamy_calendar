/* =========================================================================
   CFHM Calendar — File-based Server
   Cho phép đọc/ghi JSON files từ browser, đảm bảo mọi thiết bị thấy data giống nhau
   Chạy: node server.js
   ========================================================================= */

const http = require('http');
const fs   = require('fs');
const path = require('path');
const url  = require('url');
const os   = require('os');

const PORT = 3000;
const ROOT = __dirname;

// Chỉ cho phép đọc/ghi các file này
const DATA_FILES = new Set([
  'admin_schedule.json',
  'published_schedule.json',
  'employee_registrations.json',
  'lock_config.json'
]);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
};

function getLocalIP() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return 'localhost';
}

const server = http.createServer((req, res) => {
  // CORS headers (cho phép truy cập từ mạng nội bộ)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const parsed   = url.parse(req.url);
  let   pathname = decodeURIComponent(parsed.pathname);

  // ─── API: đọc/ghi data files ────────────────────────────────────────────
  if (pathname.startsWith('/data/')) {
    const fileName = pathname.slice(6); // bỏ '/data/'

    if (!DATA_FILES.has(fileName)) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Forbidden: file không được phép' }));
      return;
    }

    const filePath = path.join(ROOT, fileName);

    // GET /data/:file — đọc file
    if (req.method === 'GET') {
      try {
        const content = fs.readFileSync(filePath, 'utf8');
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
        res.end(content);
      } catch (e) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'File chưa có dữ liệu' }));
      }
      return;
    }

    // POST /data/:file — ghi file
    if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk.toString(); });
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
          console.log(`  💾 Saved: ${fileName}`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, file: fileName }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    res.writeHead(405); res.end('Method Not Allowed');
    return;
  }

  // ─── Static files ────────────────────────────────────────────────────────
  // URL rewriting cho clean URLs
  if (pathname === '/' || pathname === '/index') pathname = '/index.html';
  if (pathname === '/schedule') pathname = '/schedule.html';

  const filePath = path.join(ROOT, pathname);

  // Bảo mật: chặn path traversal
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403); res.end('Forbidden');
    return;
  }

  try {
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      const indexFile = path.join(filePath, 'index.html');
      const content = fs.readFileSync(indexFile);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(content);
      return;
    }

    const ext     = path.extname(filePath).toLowerCase();
    const mime    = MIME_TYPES[ext] || 'application/octet-stream';
    const content = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': mime });
    res.end(content);
  } catch (e) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found: ' + pathname);
  }
});

server.listen(PORT, '0.0.0.0', () => {
  const ip = getLocalIP();
  console.log('\n  ╔══════════════════════════════════════════════╗');
  console.log('  ║   🌿  CFHM — Lịch Làm Việc Server           ║');
  console.log('  ╠══════════════════════════════════════════════╣');
  console.log(`  ║   Local:    http://localhost:${PORT}             ║`);
  console.log(`  ║   Network:  http://${ip}:${PORT}         ║`);
  console.log('  ╠══════════════════════════════════════════════╣');
  console.log('  ║   Tất cả thiết bị cùng WiFi đều truy cập được ║');
  console.log('  ║   Data lưu vào file JSON, không mất khi đổi   ║');
  console.log('  ║   trình duyệt hay thiết bị.                    ║');
  console.log('  ╚══════════════════════════════════════════════╝\n');
});
