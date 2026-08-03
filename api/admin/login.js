import { loadJson, saveJson } from '../../../lib/r2.js';
import { randomBytes, pbkdf2Sync } from 'crypto';
import { SignJWT } from 'jose';

const KEY = 'cfhm/admin-users.json';
const JWT_SECRET = process.env.JWT_SECRET || 'cfhm-calendar-super-secret-key-1234567890';

// ── Password helpers ─────────────────────────────────────────────────────────
function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
  if (!storedHash || !storedHash.includes(':')) return false;
  const [salt, originalHash] = storedHash.split(':');
  const hash = pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return hash === originalHash;
}

// ── R2 helpers ───────────────────────────────────────────────────────────────
async function getAdminUsers() {
  try {
    const data = await loadJson(KEY);
    return Array.isArray(data) ? data : [];
  } catch (err) {
    console.error('[login] getAdminUsers error:', err.message);
    return [];
  }
}

async function saveAdminUsers(users) {
  await saveJson(KEY, users);
}

// ── Handler ──────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  // GET: Khởi tạo tài khoản admin mặc định nếu chưa có
  if (req.method === 'GET') {
    try {
      const users = await getAdminUsers();
      if (users.length === 0) {
        const rootAdmin = {
          id: 'root-admin-id',
          username: 'admin',
          passwordHash: hashPassword('admin123'),
          role: 'admin'
        };
        await saveAdminUsers([rootAdmin]);
        res.status(200).json({ ok: true, message: 'Đã khởi tạo tài khoản Root Admin mặc định thành công! (Tài khoản: admin / Mật khẩu: admin123)' });
      } else {
        res.status(200).json({ ok: false, message: 'Hệ thống đã có tài khoản Admin. Không thể khởi tạo lại.' });
      }
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
    return;
  }

  // POST: Đăng nhập
  if (req.method === 'POST') {
    try {
      const { username, password } = req.body || {};
      if (!username || !password) {
        res.status(400).json({ error: 'Vui lòng cung cấp username và password.' });
        return;
      }

      const users = await getAdminUsers();
      const user = users.find(u => u.username === username);

      if (!user || !verifyPassword(password, user.passwordHash)) {
        res.status(401).json({ error: 'Tên đăng nhập hoặc mật khẩu không chính xác.' });
        return;
      }

      const secret = new TextEncoder().encode(JWT_SECRET);
      const token = await new SignJWT({ id: user.id, username: user.username, role: user.role })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime('8h')
        .sign(secret);

      res.setHeader('Set-Cookie', `admin_token=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800`);
      res.status(200).json({ ok: true, username: user.username, role: user.role });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
    return;
  }

  res.status(405).json({ error: 'Method Not Allowed' });
}
