/**
 * POST /api/auth/webauthn-register
 * Hoàn tất đăng ký Passkey sau khi browser tạo credential thành công.
 * Lưu {credentialId, publicKey, counter, transports} vào emp.passkeyCredentials[]
 */
import { list, put } from '@vercel/blob';

const BLOB_PREFIX = 'cfhm/';
const CHALLENGES_KEY = `${BLOB_PREFIX}webauthn_challenges.json`;
const SCHEDULE_KEY = `${BLOB_PREFIX}admin_schedule.json`;

async function fetchBlobJson(url) {
  const res = await fetch(url);
  if (!res.ok) return null;
  return res.json();
}

async function loadBlob(key) {
  const { blobs } = await list({ prefix: key });
  const b = blobs.find(x => x.pathname === key);
  return b ? await fetchBlobJson(b.url) : null;
}

async function saveBlob(key, data) {
  await put(key, JSON.stringify(data), {
    access: 'public', addRandomSuffix: false, contentType: 'application/json'
  });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method Not Allowed' }); return; }

  try {
    const {
      empCode,
      credentialId,      // base64url từ browser (credential.id)
      clientDataJSON,    // base64url
      attestationObject, // base64url
      transports,        // ['internal', 'hybrid', ...]
      deviceName
    } = req.body || {};

    if (!empCode || !credentialId || !clientDataJSON) {
      return res.status(400).json({ error: 'Thiếu thông tin đăng ký Passkey.' });
    }

    // 1. Xác minh challenge chưa hết hạn
    const challenges = await loadBlob(CHALLENGES_KEY) || {};
    const stored = challenges[`reg:${empCode}`];
    if (!stored) {
      return res.status(400).json({ error: 'Challenge không tồn tại hoặc đã hết hạn.' });
    }
    if (Date.now() > stored.expiresAt) {
      return res.status(400).json({ error: 'Challenge đã hết hạn. Vui lòng thử lại.' });
    }

    // 2. Parse và xác minh clientDataJSON
    let clientData;
    try {
      const decoded = Buffer.from(clientDataJSON, 'base64').toString('utf8');
      clientData = JSON.parse(decoded);
    } catch {
      return res.status(400).json({ error: 'clientDataJSON không hợp lệ.' });
    }

    if (clientData.type !== 'webauthn.create') {
      return res.status(400).json({ error: 'Loại thao tác WebAuthn không hợp lệ.' });
    }
    if (clientData.challenge !== stored.challenge) {
      return res.status(400).json({ error: 'Challenge không khớp. Tấn công replay bị chặn.' });
    }

    // 3. Xoá challenge đã dùng (one-time use)
    delete challenges[`reg:${empCode}`];
    await saveBlob(CHALLENGES_KEY, challenges);

    // 4. Lưu credential vào emp.passkeyCredentials[]
    const sysData = await loadBlob(SCHEDULE_KEY);
    if (!sysData || !sysData.locations) {
      return res.status(404).json({ error: 'Không tìm thấy dữ liệu hệ thống.' });
    }

    let updated = false;
    let empName = empCode;

    sysData.locations.forEach(loc => {
      (loc.employees || []).forEach(emp => {
        if (emp.code === empCode) {
          empName = emp.name;
          if (!emp.passkeyCredentials) emp.passkeyCredentials = [];

          // Tránh đăng ký trùng credentialId
          const alreadyExists = emp.passkeyCredentials.some(c => c.credentialId === credentialId);
          if (!alreadyExists) {
            emp.passkeyCredentials.push({
              credentialId,
              // publicKey & counter: trong production cần parse attestationObject
              // Tạm lưu attestationObject raw để verify sau
              attestationObject: attestationObject || null,
              transports: transports || ['internal'],
              signCount: 0,
              addedAt: new Date().toISOString(),
              deviceName: (deviceName || 'Thiết bị của ' + emp.name).trim()
            });
            updated = true;
          } else {
            // Đã tồn tại → update transports nếu cần
            updated = true;
          }
        }
      });
    });

    if (!updated) {
      return res.status(404).json({ error: 'Không tìm thấy nhân viên.' });
    }

    await saveBlob(SCHEDULE_KEY, sysData);

    res.status(200).json({
      ok: true,
      message: `✅ Đã đăng ký Passkey thành công cho ${empName}! Lần sau thiết bị này sẽ được nhận diện tự động trên mọi trình duyệt.`
    });

  } catch (err) {
    console.error('[webauthn-register]', err);
    res.status(500).json({ error: err.message });
  }
}
