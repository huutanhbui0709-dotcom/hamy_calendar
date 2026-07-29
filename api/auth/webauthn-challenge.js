import { list, put } from '@vercel/blob';
import { randomBytes } from 'crypto';

const BLOB_PREFIX = 'cfhm/';
const CHALLENGES_KEY = `${BLOB_PREFIX}webauthn_challenges.json`;
const SCHEDULE_KEY = `${BLOB_PREFIX}admin_schedule.json`;

async function fetchBlobJson(url) {
  const res = await fetch(url);
  if (!res.ok) return null;
  return res.json();
}

async function loadChallenges() {
  try {
    const { blobs } = await list({ prefix: CHALLENGES_KEY });
    const blob = blobs.find(b => b.pathname === CHALLENGES_KEY);
    if (!blob) return {};
    return (await fetchBlobJson(blob.url)) || {};
  } catch { return {}; }
}

async function saveChallenges(data) {
  await put(CHALLENGES_KEY, JSON.stringify(data), {
    access: 'public', addRandomSuffix: false, contentType: 'application/json'
  });
}

// Encode/decode helpers (base64url)
function toBase64Url(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method Not Allowed' }); return; }

  try {
    const { empCode, visitorId, action } = req.body || {};
    if (!empCode) { res.status(400).json({ error: 'Thiếu mã nhân viên.' }); return; }

    // action = 'begin-registration' | 'begin-authentication'
    if (action === 'begin-registration') {
      // Tạo challenge ngẫu nhiên 32 bytes
      const challengeBuf = randomBytes(32);
      const challenge = toBase64Url(challengeBuf);

      // Lưu challenge với thời hạn 5 phút
      const challenges = await loadChallenges();
      challenges[`reg:${empCode}`] = {
        challenge,
        empCode,
        visitorId: visitorId || null,
        expiresAt: Date.now() + 5 * 60 * 1000
      };
      await saveChallenges(challenges);

      // Lấy thông tin nhân viên
      const { blobs } = await list({ prefix: SCHEDULE_KEY });
      const blob = blobs.find(b => b.pathname === SCHEDULE_KEY);
      const sysData = blob ? await fetchBlobJson(blob.url) : null;
      let empName = empCode;
      if (sysData && sysData.locations) {
        sysData.locations.forEach(loc => {
          (loc.employees || []).forEach(emp => {
            if (emp.code === empCode) empName = emp.name;
          });
        });
      }

      // Trả về PublicKeyCredentialCreationOptions
      const options = {
        challenge,
        rp: {
          name: 'CFHM Lịch Làm Việc',
          // id sẽ được browser tự fill theo origin
        },
        user: {
          id: toBase64Url(Buffer.from(empCode, 'utf8')),
          name: empCode,
          displayName: empName
        },
        pubKeyCredParams: [
          { alg: -7, type: 'public-key' },   // ES256
          { alg: -257, type: 'public-key' }  // RS256
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform', // chỉ dùng built-in (Face ID, Touch ID, Windows Hello)
          userVerification: 'preferred',
          residentKey: 'preferred'
        },
        timeout: 60000,
        attestation: 'none' // không cần attestation phức tạp
      };

      res.status(200).json({ ok: true, options });
      return;
    }

    if (action === 'begin-authentication') {
      // Tạo challenge để xác thực thiết bị đã đăng ký
      const challengeBuf = randomBytes(32);
      const challenge = toBase64Url(challengeBuf);

      const challenges = await loadChallenges();
      const key = empCode ? `auth:${empCode}` : `auth:${visitorId}`;
      challenges[key] = {
        challenge,
        empCode: empCode || null,
        expiresAt: Date.now() + 5 * 60 * 1000
      };
      await saveChallenges(challenges);

      // Lấy danh sách credentialIds đã đăng ký của nhân viên
      const allowCredentials = [];
      const { blobs } = await list({ prefix: SCHEDULE_KEY });
      const blob = blobs.find(b => b.pathname === SCHEDULE_KEY);
      const sysData = blob ? await fetchBlobJson(blob.url) : null;
      if (sysData && sysData.locations) {
        sysData.locations.forEach(loc => {
          (loc.employees || []).forEach(emp => {
            if (!empCode || emp.code === empCode) {
              (emp.passkeyCredentials || []).forEach(cred => {
                allowCredentials.push({
                  id: cred.credentialId,
                  type: 'public-key',
                  transports: cred.transports || ['internal']
                });
              });
            }
          });
        });
      }

      // Lấy rpId từ host header
      const host = req.headers.host || 'hamy-calendar.vercel.app';
      const cleanHost = host.split(':')[0]; // Loại bỏ port nếu chạy local

      const options = {
        challenge,
        rpId: cleanHost,
        userVerification: 'preferred',
        timeout: 60000
      };

      // Chỉ gửi allowCredentials nếu danh sách không trống
      if (allowCredentials.length > 0) {
        options.allowCredentials = allowCredentials;
      }

      res.status(200).json({ ok: true, options });
      return;
    }

    res.status(400).json({ error: `Action không hợp lệ: ${action}` });
  } catch (err) {
    console.error('[webauthn-challenge]', err);
    res.status(500).json({ error: err.message });
  }
}
