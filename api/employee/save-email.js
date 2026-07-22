import { put, list } from '@vercel/blob';

const BLOB_PREFIX = 'cfhm/';
const BLOB_KEY = `${BLOB_PREFIX}admin_schedule.json`;

async function fetchBlobJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Blob fetch failed: ${res.status}`);
  return res.json();
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  try {
    const { empCode, email } = req.body || {};
    if (!empCode || !email) {
      res.status(400).json({ error: 'Thiếu mã nhân viên hoặc email.' });
      return;
    }

    // Load admin_schedule.json từ Vercel Blob
    const { blobs } = await list({ prefix: BLOB_KEY });
    const blob = blobs.find(b => b.pathname === BLOB_KEY);
    if (!blob) {
      res.status(404).json({ error: 'Không tìm thấy dữ liệu hệ thống.' });
      return;
    }

    const sysData = await fetchBlobJson(blob.url);
    let updated = false;

    if (sysData && sysData.locations) {
      sysData.locations.forEach(loc => {
        if (loc.employees) {
          loc.employees.forEach(emp => {
            if (emp.code === empCode) {
              emp.email = email.trim();
              updated = true;
            }
          });
        }
      });
    }

    if (!updated) {
      res.status(404).json({ error: 'Không tìm thấy nhân viên với mã này.' });
      return;
    }

    // Lưu lại vào Vercel Blob
    await put(BLOB_KEY, JSON.stringify(sysData), {
      access: 'public',
      addRandomSuffix: false,
      contentType: 'application/json',
    });

    res.status(200).json({ ok: true, message: 'Đã lưu email nhân viên thành công.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
