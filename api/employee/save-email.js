import { loadJson, saveJson } from '../../lib/r2.js';

const SCHEDULE_KEY = 'cfhm/admin_schedule.json';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method Not Allowed' }); return; }

  try {
    const { empCode, email } = req.body || {};
    if (!empCode || !email) {
      res.status(400).json({ error: 'Thiếu mã nhân viên hoặc email.' });
      return;
    }

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
            emp.email = email.trim();
            updated = true;
          }
        });
      });
    }

    if (!updated) {
      res.status(404).json({ error: 'Không tìm thấy nhân viên với mã này.' });
      return;
    }

    await saveJson(SCHEDULE_KEY, sysData);
    res.status(200).json({ ok: true, message: 'Đã lưu email nhân viên thành công.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
