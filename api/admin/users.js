import { loadJson, saveJson } from '../../lib/r2.js';
import { randomBytes, pbkdf2Sync } from 'crypto';
import { jwtVerify } from 'jose';

const KEY = 'cfhm/admin-users.json';
const JWT_SECRET = process.env.JWT_SECRET || 'cfhm-calendar-super-secret-key-1234567890';

function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

async function getAdminUsers() {
  try {
    const data = await loadJson(KEY);
    return Array.isArray(data) ? data : [];
  } catch (err) {
    console.error('[users] getAdminUsers error:', err.message);
    return [];
  }
}

async function saveAdminUsers(users) {
  await saveJson(KEY, users);
}

async function getAuthenticatedUser(req) {
  try {
    const cookies = req.headers.cookie || '';
    const tokenCookie = cookies.split(';').find(c => c.trim().startsWith('admin_token='));
    if (!tokenCookie) return null;
    const token = tokenCookie.split('=')[1];
    const secret = new TextEncoder().encode(JWT_SECRET);
    const { payload } = await jwtVerify(token, secret);
    return payload;
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  const currentUser = await getAuthenticatedUser(req);
  if (!currentUser) {
    res.status(401).json({ error: 'Unauthorized: Bạn cần đăng nhập quyền Admin.' });
    return;
  }

  const users = await getAdminUsers();

  // GET: Xem danh sách Admin
  if (req.method === 'GET') {
    const safeUsers = users.map(u => ({ id: u.id, username: u.username, role: u.role }));
    res.status(200).json({
      currentUser: { id: currentUser.id, username: currentUser.username },
      users: safeUsers
    });
    return;
  }

  // POST: Thêm tài khoản Admin mới
  if (req.method === 'POST') {
    try {
      const { username, password } = req.body || {};
      if (!username || !password) {
        res.status(400).json({ error: 'Username và Password không được để trống.' });
        return;
      }
      if (users.some(u => u.username === username)) {
        res.status(400).json({ error: 'Tên đăng nhập đã tồn tại.' });
        return;
      }
      users.push({
        id: 'admin-' + randomBytes(4).toString('hex') + Date.now().toString(36),
        username,
        passwordHash: hashPassword(password),
        role: 'admin'
      });
      await saveAdminUsers(users);
      res.status(200).json({ ok: true, message: 'Đã thêm tài khoản Admin mới thành công.' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
    return;
  }

  // PUT: Đổi mật khẩu
  if (req.method === 'PUT') {
    try {
      const { userId, newPassword } = req.body || {};
      if (!userId || !newPassword) {
        res.status(400).json({ error: 'Vui lòng cung cấp userId và newPassword.' });
        return;
      }
      const idx = users.findIndex(u => u.id === userId);
      if (idx === -1) { res.status(404).json({ error: 'Không tìm thấy Admin.' }); return; }
      users[idx].passwordHash = hashPassword(newPassword);
      await saveAdminUsers(users);
      res.status(200).json({ ok: true, message: 'Đã đổi mật khẩu thành công.' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
    return;
  }

  // DELETE: Xóa tài khoản
  if (req.method === 'DELETE') {
    try {
      const { userId } = req.body || {};
      if (!userId) { res.status(400).json({ error: 'Vui lòng cung cấp userId.' }); return; }
      if (userId === currentUser.id) {
        res.status(400).json({ error: 'Bạn không thể tự xóa tài khoản của chính mình.' });
        return;
      }
      const idx = users.findIndex(u => u.id === userId);
      if (idx === -1) { res.status(404).json({ error: 'Không tìm thấy tài khoản cần xóa.' }); return; }
      users.splice(idx, 1);
      await saveAdminUsers(users);
      res.status(200).json({ ok: true, message: 'Đã xóa tài khoản Admin thành công.' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
    return;
  }

  res.status(405).json({ error: 'Method Not Allowed' });
}
