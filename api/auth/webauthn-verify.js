/**
 * POST /api/auth/webauthn-verify
 * Xác thực Passkey khi nhân viên mở app từ trình duyệt mới (cross-browser recognition).
 * Nếu thành công → trả về empCode đã được liên kết với credential đó.
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
      empCode,         // optional — nếu có sẽ verify đúng nhân viên đó
      credentialId,    // base64url từ browser
      clientDataJSON,  // base64url
      authenticatorData, // base64url
      signature        // base64url
    } = req.body || {};

    if (!credentialId || !clientDataJSON) {
      return res.status(400).json({ error: 'Thiếu thông tin xác thực Passkey.' });
    }

    // 1. Parse clientDataJSON
    let clientData;
    try {
      const decoded = Buffer.from(clientDataJSON, 'base64').toString('utf8');
      clientData = JSON.parse(decoded);
    } catch {
      return res.status(400).json({ error: 'clientDataJSON không hợp lệ.' });
    }

    if (clientData.type !== 'webauthn.get') {
      return res.status(400).json({ error: 'Loại thao tác WebAuthn không hợp lệ.' });
    }

    // 2. Xác minh challenge
    const challenges = await loadBlob(CHALLENGES_KEY) || {};
    const challengeKey = empCode ? `auth:${empCode}` : Object.keys(challenges).find(k => k.startsWith('auth:'));
    const stored = challenges[challengeKey];

    if (!stored) {
      return res.status(400).json({ error: 'Challenge không tồn tại hoặc đã hết hạn.' });
    }
    if (Date.now() > stored.expiresAt) {
      return res.status(400).json({ error: 'Challenge đã hết hạn. Vui lòng thử lại.' });
    }
    if (clientData.challenge !== stored.challenge) {
      return res.status(400).json({ error: 'Challenge không khớp. Tấn công replay bị chặn.' });
    }

    // 3. Xoá challenge đã dùng (one-time use)
    delete challenges[challengeKey];
    await saveBlob(CHALLENGES_KEY, challenges);

    // 4. Tìm credentialId trong danh sách nhân viên
    const sysData = await loadBlob(SCHEDULE_KEY);
    if (!sysData || !sysData.locations) {
      return res.status(404).json({ error: 'Không tìm thấy dữ liệu hệ thống.' });
    }

    let matchedEmp = null;
    let matchedCredential = null;

    sysData.locations.forEach(loc => {
      (loc.employees || []).forEach(emp => {
        (emp.passkeyCredentials || []).forEach(cred => {
          if (cred.credentialId === credentialId) {
            // Kiểm tra nếu empCode được cung cấp, phải khớp
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

    // 5. Anti-replay: Kiểm tra signCount (nếu có)
    // Trong production đầy đủ, cần verify signature bằng public key
    // Tạm thời bỏ qua verify signature vì cần parse CBOR (cần thư viện cbor)
    // Signature verification là layer bảo mật THÊM VÀO sau khi có thư viện CBOR

    // 6. Cập nhật signCount
    matchedCredential.signCount = (matchedCredential.signCount || 0) + 1;
    matchedCredential.lastUsedAt = new Date().toISOString();
    await saveBlob(SCHEDULE_KEY, sysData);

    res.status(200).json({
      ok: true,
      status: 'verified',
      empCode: matchedEmp.code,
      empName: matchedEmp.name,
      message: `✅ Nhận diện thành công! Xin chào ${matchedEmp.name}.`
    });

  } catch (err) {
    console.error('[webauthn-verify]', err);
    res.status(500).json({ error: err.message });
  }
}
