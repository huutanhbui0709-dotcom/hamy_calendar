/**
 * Vercel Serverless Function: /api/data/[file]
 * Đọc/ghi dữ liệu JSON lên Vercel Blob — thay thế cho server.js khi deploy production.
 *
 * GET  /data/admin_schedule.json          → đọc từ Blob (hoặc trả default data)
 * POST /data/admin_schedule.json  + body  → ghi đè lên Blob
 */

import { put, list } from '@vercel/blob';
import { jwtVerify } from 'jose';

const JWT_SECRET = process.env.JWT_SECRET || 'cfhm-calendar-super-secret-key-1234567890';

async function checkAdminAuth(req) {
  try {
    const cookies = req.headers.cookie || '';
    const tokenCookie = cookies.split(';').find(c => c.trim().startsWith('admin_token='));
    if (!tokenCookie) return false;
    const token = tokenCookie.split('=')[1];
    const secret = new TextEncoder().encode(JWT_SECRET);
    await jwtVerify(token, secret);
    return true;
  } catch (err) {
    return false;
  }
}

/* ─── Danh sách file được phép đọc/ghi ─────────────────────────────────── */
const ALLOWED_FILES = new Set([
  'admin_schedule.json',
  'published_schedule.json',
  'employee_registrations.json',
  'lock_config.json',
]);

/* ─── Prefix trên Blob Store ────────────────────────────────────────────── */
const BLOB_PREFIX = 'cfhm/';

/* ─── Default data cho từng file khi chưa có trên Blob ─────────────────── */
const DEFAULT_DATA = {
  'admin_schedule.json': null,           // null → app.js tự dùng createDefaultData()
  'published_schedule.json': {},         // chưa publish
  'employee_registrations.json': [],     // chưa có đăng ký
  'lock_config.json': { enabled: false, openTime: '06:00', closeTime: '20:00' },
};

/* ─── Helper: đọc JSON từ một URL công khai ────────────────────────────── */
async function fetchBlobJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Blob fetch failed: ${res.status}`);
  return res.json();
}

/* ─── Handler chính ─────────────────────────────────────────────────────── */
export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  // Lấy tên file từ URL: /data/admin_schedule.json → admin_schedule.json
  const fileName = (req.query.file || '').replace(/^\/+/, '');

  if (!ALLOWED_FILES.has(fileName)) {
    res.status(403).json({ error: 'File không được phép truy cập.' });
    return;
  }

  const blobKey = `${BLOB_PREFIX}${fileName}`;

  /* ── GET: Đọc từ Blob ───────────────────────────────────────────────── */
  if (req.method === 'GET') {
    try {
      // list() để tìm blob theo prefix chính xác
      const { blobs } = await list({ prefix: blobKey });
      const blob = blobs.find(b => b.pathname === blobKey);

      if (!blob) {
        // Chưa có file → trả về default data
        const defaultVal = DEFAULT_DATA[fileName];
        res.setHeader('Cache-Control', 'no-store');
        res.status(defaultVal === null ? 404 : 200).json(
          defaultVal === null ? { error: 'Chưa có dữ liệu' } : defaultVal
        );
        return;
      }

      const data = await fetchBlobJson(blob.url);
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json(data);
    } catch (err) {
      console.error('[GET]', fileName, err);
      res.status(500).json({ error: err.message });
    }
    return;
  }

  /* ── POST: Ghi đè lên Blob ──────────────────────────────────────────── */
  if (req.method === 'POST') {
    try {
      // Bảo vệ các file cấu hình admin và lịch đã xuất bản
      if (fileName !== 'employee_registrations.json') {
        const isAuthorized = await checkAdminAuth(req);
        if (!isAuthorized) {
          res.status(401).json({ error: 'Unauthorized: Bạn cần đăng nhập quyền Admin.' });
          return;
        }
      }

      // Đọc body — Vercel tự parse JSON nếu Content-Type: application/json
      const body = req.body;
      if (body === undefined || body === null) {
        res.status(400).json({ error: 'Body rỗng.' });
        return;
      }

      const { url } = await put(blobKey, JSON.stringify(body), {
        access: 'public',
        addRandomSuffix: false,       // Ghi đè cùng key mỗi lần
        contentType: 'application/json',
      });

      console.log(`💾 Blob saved: ${fileName} → ${url}`);
      res.status(200).json({ ok: true, url });
    } catch (err) {
      console.error('[POST]', fileName, err);
      res.status(500).json({ error: err.message });
    }
    return;
  }

  res.status(405).json({ error: 'Method Not Allowed' });
}
