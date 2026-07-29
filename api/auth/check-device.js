import { list } from '@vercel/blob';

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
    const { empCode, visitorId } = req.body || {};
    if (!empCode || !visitorId) {
      res.status(400).json({ error: 'Thiếu mã nhân viên hoặc mã thiết bị.' });
      return;
    }

    // Load admin_schedule.json
    const { blobs } = await list({ prefix: BLOB_KEY });
    const blob = blobs.find(b => b.pathname === BLOB_KEY);
    if (!blob) {
      res.status(404).json({ error: 'Không tìm thấy dữ liệu cấu hình hệ thống.' });
      return;
    }

    const sysData = await fetchBlobJson(blob.url);
    let targetEmployee = null;
    let conflictsWithName = null;
    let isMatched = false;

    if (sysData && sysData.locations) {
      sysData.locations.forEach(loc => {
        if (loc.employees) {
          loc.employees.forEach(emp => {
            const devices = emp.registeredDevices || [];
            const hasDevice = devices.some(d => d.visitorId === visitorId);
            
            if (hasDevice) {
              if (emp.code === empCode) {
                isMatched = true;
              } else {
                conflictsWithName = emp.name;
              }
            }

            if (emp.code === empCode) {
              targetEmployee = emp;
            }
          });
        }
      });
    }

    if (!targetEmployee) {
      res.status(404).json({ error: 'Không tìm thấy thông tin nhân viên.' });
      return;
    }

    if (conflictsWithName) {
      res.status(200).json({
        status: 'conflict',
        message: `Thiết bị này đã được liên kết với nhân viên khác (${conflictsWithName}).`
      });
      return;
    }

    if (isMatched) {
      res.status(200).json({ status: 'allowed' });
      return;
    }

    // Yêu cầu mã OTP qua Email nhân viên
    const email = targetEmployee.email || '';
    if (!email) {
      res.status(400).json({
        error: 'Tài khoản chưa được thiết lập email xác nhận. Vui lòng liên hệ Admin để bổ sung.'
      });
      return;
    }

    const parts = email.split('@');
    const maskedEmail = parts[0].slice(0, 2) + '***@' + parts[1];

    res.status(200).json({
      status: 'otp_required',
      maskedEmail: maskedEmail
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
