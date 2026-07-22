import { put, list } from '@vercel/blob';
import bcrypt from 'bcryptjs';
import { SignJWT } from 'jose';

const BLOB_PREFIX = 'cfhm/';
const BLOB_KEY = `${BLOB_PREFIX}admin-users.json`;
const JWT_SECRET = process.env.JWT_SECRET || 'cfhm-calendar-super-secret-key-1234567890';

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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  // GET: Dùng để khởi tạo tài khoản admin đầu tiên nếu chưa có
  if (req.method === 'GET') {
    try {
      const users = await getAdminUsers();
      if (users.length === 0) {
        // Tạo tài khoản admin mặc định: admin / admin123
        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash('admin123', salt);
        const rootAdmin = {
          id: 'root-admin-id',
          username: 'admin',
          passwordHash: passwordHash,
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

      if (!user) {
        res.status(401).json({ error: 'Tên đăng nhập hoặc mật khẩu không chính xác.' });
        return;
      }

      const isMatch = await bcrypt.compare(password, user.passwordHash);
      if (!isMatch) {
        res.status(401).json({ error: 'Tên đăng nhập hoặc mật khẩu không chính xác.' });
        return;
      }

      // Tạo JWT token bằng jose
      const secret = new TextEncoder().encode(JWT_SECRET);
      const token = await new SignJWT({ id: user.id, username: user.username, role: user.role })
        .setProtectedHeader({ alg: 'HS256' })
        .setExpirationTime('2h')
        .sign(secret);

      // Đặt cookie HTTP-Only
      res.setHeader('Set-Cookie', `admin_token=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=7200`);
      res.status(200).json({ ok: true, message: 'Đăng nhập thành công!' });
    } catch (err) {
      console.error('[LOGIN POST ERROR]', err);
      res.status(500).json({ error: err.message });
    }
    return;
  }

  res.status(405).json({ error: 'Method Not Allowed' });
}
