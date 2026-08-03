/**
 * POST /api/auth/webauthn-register
 * Hoàn tất đăng ký Passkey sau khi browser tạo credential thành công.
 * Lưu {credentialId, publicKey, counter, transports} vào emp.passkeyCredentials[]
 */
import { loadJson, saveJson } from '../../lib/r2.js';

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
      attestationObject,
      transports,
      deviceName,
      visitorId
    } = req.body || {};

    if (!empCode || !credentialId || !clientDataJSON) {
      return res.status(400).json({ error: 'Thiếu thông tin đăng ký Passkey.' });
    }

    // 1. Xác minh challenge
    const challenges = (await loadJson(CHALLENGES_KEY)) || {};
    const stored = challenges[`reg:${empCode}`];
    if (!stored) return res.status(400).json({ error: 'Challenge không tồn tại hoặc đã hết hạn.' });
    if (Date.now() > stored.expiresAt) return res.status(400).json({ error: 'Challenge đã hết hạn.' });

    // 2. Parse clientDataJSON
    let clientData;
    try {
      clientData = JSON.parse(Buffer.from(clientDataJSON, 'base64').toString('utf8'));
    } catch {
      return res.status(400).json({ error: 'clientDataJSON không hợp lệ.' });
    }

    if (clientData.type !== 'webauthn.create') return res.status(400).json({ error: 'Loại thao tác WebAuthn không hợp lệ.' });
    if (clientData.challenge !== stored.challenge) return res.status(400).json({ error: 'Challenge không khớp.' });

    // 3. Xóa challenge đã dùng
    delete challenges[`reg:${empCode}`];
    await saveJson(CHALLENGES_KEY, challenges);

    // 4. Lưu credential
    const sysData = await loadJson(SCHEDULE_KEY);
    if (!sysData || !sysData.locations) return res.status(404).json({ error: 'Không tìm thấy dữ liệu hệ thống.' });

    let updated = false;
    let empName = empCode;

    sysData.locations.forEach(loc => {
      (loc.employees || []).forEach(emp => {
        if (emp.code === empCode) {
          empName = emp.name;
          if (!emp.passkeyCredentials) emp.passkeyCredentials = [];

          const alreadyExists = emp.passkeyCredentials.some(c => c.credentialId === credentialId);
          if (!alreadyExists) {
            emp.passkeyCredentials.push({
              credentialId,
              attestationObject: attestationObject || null,
              transports: transports || ['internal'],
              signCount: 0,
              addedAt: new Date().toISOString(),
              deviceName: (deviceName || 'Thiết bị của ' + emp.name).trim()
            });
            updated = true;
          } else {
            updated = true;
          }

          // Đăng ký visitorId của trình duyệt vào registeredDevices
          if (visitorId) {
            if (!emp.registeredDevices) emp.registeredDevices = [];
            if (!emp.registeredDevices.some(d => d.visitorId === visitorId)) {
              emp.registeredDevices.push({
                visitorId,
                addedAt: new Date().toISOString(),
                deviceName: (deviceName || 'Thiết bị của ' + emp.name).trim()
              });
            }
          }
        }
      });
    });

    if (!updated) return res.status(404).json({ error: 'Không tìm thấy nhân viên.' });

    await saveJson(SCHEDULE_KEY, sysData);

    res.status(200).json({
      ok: true,
      message: `✅ Đã đăng ký Passkey thành công cho ${empName}! Lần sau thiết bị này sẽ được nhận diện tự động.`
    });
  } catch (err) {
    console.error('[webauthn-register]', err.message);
    res.status(500).json({ error: err.message });
  }
}
