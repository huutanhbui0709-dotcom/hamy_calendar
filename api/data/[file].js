/**
 * /api/data/[file]
 * Đọc/ghi dữ liệu JSON lên Cloudflare R2.
 *
 * GET  /data/admin_schedule.json         → đọc từ R2 (hoặc trả default data)
 * POST /data/admin_schedule.json + body  → ghi đè lên R2
 */

import { loadJson, saveJson, getPublicUrl } from '../../lib/r2.js';
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
  } catch {
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

const PREFIX = 'cfhm/';

/* ─── Default data cho từng file khi chưa có trên R2 ─────────────────── */
const DEFAULT_DATA = {
  'admin_schedule.json': null,
  'published_schedule.json': {},
  'employee_registrations.json': [],
  'lock_config.json': { enabled: false, openTime: '06:00', closeTime: '20:00' },
};

/* ─── Handler chính ─────────────────────────────────────────────────────── */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  const fileName = (req.query.file || '').replace(/^\/+/, '');

  if (!ALLOWED_FILES.has(fileName)) {
    res.status(403).json({ error: 'File không được phép truy cập.' });
    return;
  }

  const r2Key = `${PREFIX}${fileName}`;

  /* ── GET ───────────────────────────────────────────────────────────── */
  if (req.method === 'GET') {
    try {
      const data = await loadJson(r2Key);

      if (data === null) {
        const defaultVal = DEFAULT_DATA[fileName];
        res.setHeader('Cache-Control', 'no-store');
        res.status(defaultVal === null ? 404 : 200).json(
          defaultVal === null ? { error: 'Chưa có dữ liệu' } : defaultVal
        );
        return;
      }

      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json(data);
    } catch (err) {
      console.error('[GET]', fileName, err.message);
      res.status(500).json({ error: err.message });
    }
    return;
  }

  /* ── POST ──────────────────────────────────────────────────────────── */
  if (req.method === 'POST') {
    try {
      if (fileName !== 'employee_registrations.json') {
        const isAuthorized = await checkAdminAuth(req);
        if (!isAuthorized) {
          res.status(401).json({ error: 'Unauthorized: Bạn cần đăng nhập quyền Admin.' });
          return;
        }
      }

      let body = req.body;
      if (body === undefined || body === null) {
        res.status(400).json({ error: 'Body rỗng.' });
        return;
      }

      // Merge & bảo lưu danh sách thiết bị liên kết để Admin ghi đè không làm mất
      if (fileName === 'admin_schedule.json') {
        try {
          const existingData = await loadJson(r2Key);
          if (existingData && existingData.locations && body.locations) {
            const deviceMap = {};
            const passkeyMap = {};
            existingData.locations.forEach(loc => {
              (loc.employees || []).forEach(emp => {
                if (emp.code) {
                  deviceMap[emp.code] = emp.registeredDevices || [];
                  passkeyMap[emp.code] = emp.passkeyCredentials || [];
                }
              });
            });
            body.locations.forEach(loc => {
              (loc.employees || []).forEach(emp => {
                if (emp.code) {
                  emp.registeredDevices = deviceMap[emp.code] || [];
                  emp.passkeyCredentials = passkeyMap[emp.code] || [];
                }
              });
            });
          }
        } catch (mergeErr) {
          console.warn('[Merge Devices Warn]', mergeErr.message);
        }
      }

      const url = await saveJson(r2Key, body);
      console.log(`💾 R2 saved: ${fileName} → ${url}`);
      res.status(200).json({ ok: true, url });
    } catch (err) {
      console.error('[POST]', fileName, err.message);
      res.status(500).json({ error: err.message });
    }
    return;
  }

  res.status(405).json({ error: 'Method Not Allowed' });
}
