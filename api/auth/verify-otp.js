import { list, put } from '@vercel/blob';

const BLOB_PREFIX = 'cfhm/';
const SCHEDULE_KEY = `${BLOB_PREFIX}admin_schedule.json`;
const OTP_KEY = `${BLOB_PREFIX}otp_codes.json`;

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
    const { empCode, visitorId, otp, deviceName } = req.body || {};
    if (!empCode || !visitorId || !otp || !deviceName) {
      res.status(400).json({ error: 'Thiếu thông tin xác thực OTP.' });
      return;
    }

    const key = `${empCode}:${visitorId}`;

    // 1. Đọc file otp_codes.json trên Blob để xác minh
    const { blobs: otpBlobs } = await list({ prefix: OTP_KEY });
    const otpBlob = otpBlobs.find(b => b.pathname === OTP_KEY);
    if (!otpBlob) {
      res.status(400).json({ error: 'Mã xác thực không tồn tại hoặc đã hết hạn.' });
      return;
    }

    const otpData = await fetchBlobJson(otpBlob.url);
    const item = otpData[key];

    if (!item) {
      res.status(400).json({ error: 'Mã OTP không tồn tại hoặc đã hết hạn.' });
      return;
    }

    if (item.otp !== otp.trim()) {
      res.status(400).json({ error: 'Mã OTP không chính xác.' });
      return;
    }

    if (Date.now() > item.expiresAt) {
      res.status(400).json({ error: 'Mã OTP đã hết hạn sử dụng (5 phút).' });
      return;
    }

    // OTP Hợp lệ: Xóa OTP đã dùng
    delete otpData[key];
    await put(OTP_KEY, JSON.stringify(otpData), {
      access: 'public',
      addRandomSuffix: false,
      contentType: 'application/json',
    });

    // 2. Thêm thiết bị vào admin_schedule.json
    const { blobs: scheduleBlobs } = await list({ prefix: SCHEDULE_KEY });
    const scheduleBlob = scheduleBlobs.find(b => b.pathname === SCHEDULE_KEY);
    if (!scheduleBlob) {
      res.status(404).json({ error: 'Không tìm thấy dữ liệu hệ thống.' });
      return;
    }

    const sysData = await fetchBlobJson(scheduleBlob.url);
    let updated = false;

    if (sysData && sysData.locations) {
      sysData.locations.forEach(loc => {
        if (loc.employees) {
          loc.employees.forEach(emp => {
            if (emp.code === empCode) {
              if (!emp.registeredDevices) {
                emp.registeredDevices = [];
              }
              // Tránh trùng lặp visitorId
              if (!emp.registeredDevices.some(d => d.visitorId === visitorId)) {
                emp.registeredDevices.push({
                  visitorId,
                  addedAt: new Date().toISOString(),
                  deviceName: deviceName.trim()
                });
                updated = true;
              }
            }
          });
        }
      });
    }

    if (!updated) {
      res.status(404).json({ error: 'Không thể thêm thiết bị. Không tìm thấy nhân viên.' });
      return;
    }

    // Ghi đè lại dữ liệu admin_schedule.json lên Vercel Blob
    await put(SCHEDULE_KEY, JSON.stringify(sysData), {
      access: 'public',
      addRandomSuffix: false,
      contentType: 'application/json',
    });

    res.status(200).json({ ok: true, message: 'Xác thực thiết bị thành công!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
