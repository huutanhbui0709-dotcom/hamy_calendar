import { put, list } from '@vercel/blob';
import crypto from 'crypto';
import { jwtVerify } from 'jose';

const BLOB_PREFIX = 'cfhm/';
const BLOB_KEY = `${BLOB_PREFIX}admin-users.json`;
const JWT_SECRET = process.env.JWT_SECRET || 'cfhm-calendar-super-secret-key-1234567890';

// Hàm băm mật khẩu bằng PBKDF2 của Node crypto
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

async function fetchBlobJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Blob fetch failed: ${res.status}`);
  return res.json();
}

async function getAdminUsers() {
  try {
    const { blobs } = await list({ prefix: BLOB_KEY });
    const blob = blobs.find(b => b.pathname === BLOB_KEY);
    if (!blob) return [];
    return await fetchBlobJson(blob.url);
  } catch (err) {
    console.error('getAdminUsers error:', err);
    return [];
  }
}

async function saveAdminUsers(users) {
  await put(BLOB_KEY, JSON.stringify(users), {
    access: 'public',
    addRandomSuffix: false,
    contentType: 'application/json',
  });
}

// Helper to authenticate request
async function getAuthenticatedUser(req) {
  try {
    const cookies = req.headers.cookie || '';
    const tokenCookie = cookies.split(';').find(c => c.trim().startsWith('admin_token='));
    if (!tokenCookie) return null;
    const token = tokenCookie.split('=')[1];
    const secret = new TextEncoder().encode(JWT_SECRET);
    const { payload } = await jwtVerify(token, secret);
    return payload;
  } catch (err) {
    return null;
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  // Xác thực token của admin
  const currentUser = await getAuthenticatedUser(req);
  if (!currentUser) {
    res.status(401).json({ error: 'Unauthorized: Bạn cần đăng nhập quyền Admin.' });
    return;
  }

  const users = await getAdminUsers();

  // GET: Xem danh sách Admin
  if (req.method === 'GET') {
    // Không trả về passwordHash để bảo mật
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
      
      const exists = users.some(u => u.username === username);
      if (exists) {
        res.status(400).json({ error: 'Tên đăng nhập đã tồn tại.' });
        return;
      }

      const passwordHash = hashPassword(password);
      const newAdmin = {
        id: 'admin-' + Math.random().toString(36).substring(2, 9) + Date.now().toString(36),
        username,
        passwordHash,
        role: 'admin'
      };

      users.push(newAdmin);
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

      const userIndex = users.findIndex(u => u.id === userId);
      if (userIndex === -1) {
        res.status(404).json({ error: 'Không tìm thấy Admin.' });
        return;
      }

      const passwordHash = hashPassword(newPassword);
      users[userIndex].passwordHash = passwordHash;

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
      if (!userId) {
        res.status(400).json({ error: 'Vui lòng cung cấp userId.' });
        return;
      }

      if (userId === currentUser.id) {
        res.status(400).json({ error: 'Bạn không thể tự xóa tài khoản của chính mình đang đăng nhập.' });
        return;
      }

      const userIndex = users.findIndex(u => u.id === userId);
      if (userIndex === -1) {
        res.status(404).json({ error: 'Không tìm thấy tài khoản cần xóa.' });
        return;
      }

      users.splice(userIndex, 1);
      await saveAdminUsers(users);
      res.status(200).json({ ok: true, message: 'Đã xóa tài khoản Admin thành công.' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
    return;
  }

  res.status(405).json({ error: 'Method Not Allowed' });
}
