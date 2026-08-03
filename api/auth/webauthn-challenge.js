import { loadJson, saveJson } from '../../../lib/r2.js';
import { randomBytes } from 'crypto';

const CHALLENGES_KEY = 'cfhm/webauthn_challenges.json';
const SCHEDULE_KEY   = 'cfhm/admin_schedule.json';

function toBase64Url(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function loadChallenges() {
  try {
    return (await loadJson(CHALLENGES_KEY)) || {};
  } catch { return {}; }
}

async function saveChallenges(data) {
  await saveJson(CHALLENGES_KEY, data);
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

    if (action === 'begin-registration') {
      const challenge = toBase64Url(randomBytes(32));
      const challenges = await loadChallenges();
      challenges[`reg:${empCode}`] = {
        challenge, empCode,
        visitorId: visitorId || null,
        expiresAt: Date.now() + 5 * 60 * 1000
      };
      await saveChallenges(challenges);

      // Lấy thông tin nhân viên
      const sysData = await loadJson(SCHEDULE_KEY);
      let empName = empCode;
      if (sysData && sysData.locations) {
        sysData.locations.forEach(loc => {
          (loc.employees || []).forEach(emp => {
            if (emp.code === empCode) empName = emp.name;
          });
        });
      }

      const options = {
        challenge,
        rp: { name: 'CFHM Lịch Làm Việc' },
        user: {
          id: toBase64Url(Buffer.from(empCode, 'utf8')),
          name: empCode,
          displayName: empName
        },
        pubKeyCredParams: [
          { alg: -7, type: 'public-key' },
          { alg: -257, type: 'public-key' }
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          userVerification: 'preferred',
          residentKey: 'preferred'
        },
        timeout: 60000,
        attestation: 'none'
      };

      res.status(200).json({ ok: true, options });
      return;
    }

    if (action === 'begin-authentication') {
      const challenge = toBase64Url(randomBytes(32));
      const challenges = await loadChallenges();
      const key = empCode ? `auth:${empCode}` : `auth:${visitorId}`;
      challenges[key] = {
        challenge, empCode: empCode || null,
        expiresAt: Date.now() + 5 * 60 * 1000
      };
      await saveChallenges(challenges);

      const allowCredentials = [];
      const sysData = await loadJson(SCHEDULE_KEY);
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

      const host = req.headers.host || 'hamy-calendar.vercel.app';
      const cleanHost = host.split(':')[0];

      const options = { challenge, rpId: cleanHost, userVerification: 'preferred', timeout: 60000 };
      if (allowCredentials.length > 0) options.allowCredentials = allowCredentials;

      res.status(200).json({ ok: true, options });
      return;
    }

    res.status(400).json({ error: `Action không hợp lệ: ${action}` });
  } catch (err) {
    console.error('[webauthn-challenge]', err.message);
    res.status(500).json({ error: err.message });
  }
}
