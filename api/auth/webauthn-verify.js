/**
 * POST /api/auth/webauthn-verify
 * Xác thực Passkey khi nhân viên mở app từ trình duyệt mới (cross-browser recognition).
 */
import { loadJson, saveJson } from '../../../lib/r2.js';

const CHALLENGES_KEY = 'cfhm/webauthn_challenges.json';
const SCHEDULE_KEY   = 'cfhm/admin_schedule.json';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method Not Allowed' }); return; }

  try {
    const {
      empCode,
      credentialId,
      clientDataJSON,
      authenticatorData,
      signature,
      visitorId,
      deviceName
    } = req.body || {};

    if (!credentialId || !clientDataJSON) {
      return res.status(400).json({ error: 'Thiếu thông tin xác thực Passkey.' });
    }

    // 1. Parse clientDataJSON
    let clientData;
    try {
      clientData = JSON.parse(Buffer.from(clientDataJSON, 'base64').toString('utf8'));
    } catch {
      return res.status(400).json({ error: 'clientDataJSON không hợp lệ.' });
    }

    if (clientData.type !== 'webauthn.get') return res.status(400).json({ error: 'Loại thao tác WebAuthn không hợp lệ.' });

    // 2. Xác minh challenge
    const challenges = (await loadJson(CHALLENGES_KEY)) || {};
    const challengeKey = empCode ? `auth:${empCode}` : Object.keys(challenges).find(k => k.startsWith('auth:'));
    const stored = challenges[challengeKey];

    if (!stored) return res.status(400).json({ error: 'Challenge không tồn tại hoặc đã hết hạn.' });
    if (Date.now() > stored.expiresAt) return res.status(400).json({ error: 'Challenge đã hết hạn.' });
    if (clientData.challenge !== stored.challenge) return res.status(400).json({ error: 'Challenge không khớp.' });

    // 3. Xóa challenge đã dùng
    delete challenges[challengeKey];
    await saveJson(CHALLENGES_KEY, challenges);

    // 4. Tìm credentialId trong danh sách nhân viên
    const sysData = await loadJson(SCHEDULE_KEY);
    if (!sysData || !sysData.locations) return res.status(404).json({ error: 'Không tìm thấy dữ liệu hệ thống.' });

    let matchedEmp = null;
    let matchedCredential = null;

    sysData.locations.forEach(loc => {
      (loc.employees || []).forEach(emp => {
        (emp.passkeyCredentials || []).forEach(cred => {
          if (cred.credentialId === credentialId) {
            if (!empCode || emp.code === empCode) {
              matchedEmp = emp;
              matchedCredential = cred;
            }
          }
        });
      });
    });

    if (!matchedEmp || !matchedCredential) {
      return res.status(401).json({
        status: 'unrecognized',
        error: 'Thiết bị này chưa đăng ký Passkey hoặc không khớp với tài khoản.'
      });
    }

    // 5. Cập nhật signCount
    matchedCredential.signCount = (matchedCredential.signCount || 0) + 1;
    matchedCredential.lastUsedAt = new Date().toISOString();

    // Đăng ký visitorId trình duyệt mới vào registeredDevices
    if (visitorId) {
      if (!matchedEmp.registeredDevices) matchedEmp.registeredDevices = [];
      if (!matchedEmp.registeredDevices.some(d => d.visitorId === visitorId)) {
        matchedEmp.registeredDevices.push({
          visitorId,
          addedAt: new Date().toISOString(),
          deviceName: (deviceName || 'Trình duyệt từ Passkey').trim()
        });
      }
    }

    await saveJson(SCHEDULE_KEY, sysData);

    res.status(200).json({
      ok: true,
      status: 'verified',
      empCode: matchedEmp.code,
      empName: matchedEmp.name,
      message: `✅ Nhận diện thành công! Xin chào ${matchedEmp.name}.`
    });
  } catch (err) {
    console.error('[webauthn-verify]', err.message);
    res.status(500).json({ error: err.message });
  }
}
