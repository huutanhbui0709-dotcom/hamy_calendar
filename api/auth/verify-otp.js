import { loadJson, saveJson } from '../../lib/r2.js';

const SCHEDULE_KEY = 'cfhm/admin_schedule.json';
const OTP_KEY      = 'cfhm/otp_codes.json';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method Not Allowed' }); return; }

  try {
    const { empCode, visitorId, otp, deviceName } = req.body || {};
    if (!empCode || !visitorId || !otp || !deviceName) {
      res.status(400).json({ error: 'Thiếu thông tin xác thực OTP.' });
      return;
    }

    const key = `${empCode}:${visitorId}`;

    // 1. Kiểm tra OTP
    const otpData = await loadJson(OTP_KEY);
    if (!otpData) {
      res.status(400).json({ error: 'Mã xác thực không tồn tại hoặc đã hết hạn.' });
      return;
    }

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

    // Xóa OTP đã dùng
    delete otpData[key];
    await saveJson(OTP_KEY, otpData);

    // 2. Thêm thiết bị vào admin_schedule.json
    const sysData = await loadJson(SCHEDULE_KEY);
    if (!sysData) {
      res.status(404).json({ error: 'Không tìm thấy dữ liệu hệ thống.' });
      return;
    }

    let updated = false;
    if (sysData.locations) {
      sysData.locations.forEach(loc => {
        (loc.employees || []).forEach(emp => {
          if (emp.code === empCode) {
            if (!emp.registeredDevices) emp.registeredDevices = [];
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
      });
    }

    if (!updated) {
      res.status(404).json({ error: 'Không thể thêm thiết bị. Không tìm thấy nhân viên.' });
      return;
    }

    await saveJson(SCHEDULE_KEY, sysData);
    res.status(200).json({ ok: true, message: 'Xác thực thiết bị thành công!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
