import { loadJson, saveJson } from '../../lib/r2.js';

const SCHEDULE_KEY = 'cfhm/admin_schedule.json';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method Not Allowed' }); return; }

  try {
    const { empCode, visitorId } = req.body || {};
    if (!empCode || !visitorId) {
      res.status(400).json({ error: 'Thiếu mã nhân viên hoặc mã thiết bị.' });
      return;
    }

    const sysData = await loadJson(SCHEDULE_KEY);
    if (!sysData) {
      res.status(404).json({ error: 'Không tìm thấy dữ liệu cấu hình hệ thống.' });
      return;
    }

    let targetEmployee = null;
    let conflictsWithName = null;
    let isMatched = false;

    if (sysData.locations) {
      sysData.locations.forEach(loc => {
        (loc.employees || []).forEach(emp => {
          const hasDevice = (emp.registeredDevices || []).some(d => d.visitorId === visitorId);

          if (hasDevice) {
            if (emp.code === empCode) isMatched = true;
            else conflictsWithName = emp.name;
          }

          if (emp.code === empCode) targetEmployee = emp;
        });
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

    const email = targetEmployee.email || '';
    if (!email) {
      res.status(400).json({
        error: 'Tài khoản chưa được thiết lập email xác nhận. Vui lòng liên hệ Admin để bổ sung.'
      });
      return;
    }

    const parts = email.split('@');
    const maskedEmail = parts[0].slice(0, 2) + '***@' + parts[1];

    res.status(200).json({ status: 'otp_required', maskedEmail });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
