/* =========================================================================
   CFHM Calendar — File-based Server (with Authentication & CRUD)
   Cho phép đọc/ghi JSON files từ browser, có bảo mật và quản lý Admin.
   Chạy: node server.js
   ========================================================================= */

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const os = require('os');
const crypto = require('crypto');
const jose = require('jose');
const nodemailer = require('nodemailer');

// Tải biến môi trường từ .env.local (hỗ trợ local testing)
try {
  const envPath = path.join(__dirname, '.env.local');
  if (fs.existsSync(envPath)) {
    const envFile = fs.readFileSync(envPath, 'utf8');
    envFile.split('\n').forEach(line => {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        let key = match[1];
        let value = match[2] || '';
        value = value.trim().replace(/^['"]|['"]$/g, '');
        process.env[key] = process.env[key] || value;
      }
    });
  }
} catch (e) {
  console.log('Không thể tải .env.local:', e.message);
}

// Hàm băm mật khẩu bằng PBKDF2 của Node crypto
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

// Hàm kiểm tra mật khẩu
function verifyPassword(password, storedHash) {
  if (!storedHash || !storedHash.includes(':')) return false;
  const [salt, originalHash] = storedHash.split(':');
  const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return hash === originalHash;
}

const PORT = 3000;
const ROOT = __dirname;

const JWT_SECRET = process.env.JWT_SECRET || 'cfhm-calendar-super-secret-key-1234567890';
const SECRET_KEY = new TextEncoder().encode(JWT_SECRET);

// Chỉ cho phép đọc/ghi các file này
const DATA_FILES = new Set([
  'admin_schedule.json',
  'published_schedule.json',
  'employee_registrations.json',
  'lock_config.json'
]);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function getLocalIP() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return 'localhost';
}

// Đọc danh sách Admin local
function getLocalAdminUsers() {
  const filePath = path.join(ROOT, 'admin_users.json');
  try {
    if (!fs.existsSync(filePath)) {
      // Tự khởi tạo admin/admin123 nếu file chưa tồn tại
      const hash = hashPassword('admin123');
      const defaultUsers = [{
        id: 'root-admin-id',
        username: 'admin',
        passwordHash: hash,
        role: 'admin'
      }];
      fs.writeFileSync(filePath, JSON.stringify(defaultUsers, null, 2), 'utf8');
      return defaultUsers;
    }
    const content = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(content);
  } catch (e) {
    console.error('Lỗi đọc local admin users:', e);
    return [];
  }
}

// Ghi danh sách Admin local
function saveLocalAdminUsers(users) {
  const filePath = path.join(ROOT, 'admin_users.json');
  fs.writeFileSync(filePath, JSON.stringify(users, null, 2), 'utf8');
}

// Đọc body của request
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        resolve({});
      }
    });
  });
}

// Xác thực cookie token local
async function checkAdminAuthLocal(req) {
  try {
    const cookieHeader = req.headers.cookie || '';
    const tokenCookie = cookieHeader.split(';').find(c => c.trim().startsWith('admin_token='));
    if (!tokenCookie) return null;
    const token = tokenCookie.split('=')[1];
    const { payload } = await jose.jwtVerify(token, SECRET_KEY);
    return payload;
  } catch (err) {
    return null;
  }
}

const server = http.createServer(async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const parsed = url.parse(req.url);
  let pathname = decodeURIComponent(parsed.pathname);

  // ─── API: Đăng nhập Admin ────────────────────────────────────────────────
  if (pathname === '/api/admin/login') {
    if (req.method === 'GET') {
      // Hỗ trợ khởi tạo
      const users = getLocalAdminUsers();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, message: 'Hệ thống đã khởi tạo mặc định tài khoản admin/admin123' }));
      return;
    }
    if (req.method === 'POST') {
      const { username, password } = await readBody(req);
      if (!username || !password) {
        res.writeHead(400, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ error: 'Thiếu username hoặc password' }));
        return;
      }
      const users = getLocalAdminUsers();
      const user = users.find(u => u.username === username);
      if (!user || !verifyPassword(password, user.passwordHash)) {
        res.writeHead(401, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ error: 'Username hoặc Password không đúng.' }));
        return;
      }
      // Tạo token JWT
      const token = await new jose.SignJWT({ id: user.id, username: user.username, role: user.role })
        .setProtectedHeader({ alg: 'HS256' })
        .setExpirationTime('2h')
        .sign(SECRET_KEY);

      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        'Set-Cookie': `admin_token=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=7200`
      });
      res.end(JSON.stringify({ ok: true, message: 'Đăng nhập thành công' }));
      return;
    }
    res.writeHead(405); res.end('Method Not Allowed');
    return;
  }

  // ─── API: Đăng xuất Admin ────────────────────────────────────────────────
  if (pathname === '/api/admin/logout') {
    if (req.method === 'POST') {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        'Set-Cookie': 'admin_token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT'
      });
      res.end(JSON.stringify({ ok: true, message: 'Đã đăng xuất thành công.' }));
      return;
    }
    res.writeHead(405); res.end('Method Not Allowed');
    return;
  }

  // ─── API: Quản lý tài khoản Admin (CRUD) ──────────────────────────────
  if (pathname === '/api/admin/users') {
    const currentUser = await checkAdminAuthLocal(req);
    if (!currentUser) {
      res.writeHead(401, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ error: 'Unauthorized: Vui lòng đăng nhập Admin.' }));
      return;
    }

    const users = getLocalAdminUsers();

    if (req.method === 'GET') {
      const safeUsers = users.map(u => ({ id: u.id, username: u.username, role: u.role }));
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate'
      });
      res.end(JSON.stringify({
        currentUser: { id: currentUser.id, username: currentUser.username },
        users: safeUsers
      }));
      return;
    }

    if (req.method === 'POST') {
      const { username, password } = await readBody(req);
      if (!username || !password) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Thiếu thông tin' }));
        return;
      }
      if (users.some(u => u.username === username)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Tên đăng nhập đã tồn tại' }));
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
      saveLocalAdminUsers(users);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (req.method === 'PUT') {
      const { userId, newPassword } = await readBody(req);
      if (!userId || !newPassword) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Thiếu thông tin' }));
        return;
      }
      const userIndex = users.findIndex(u => u.id === userId);
      if (userIndex === -1) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Không tìm thấy user' }));
        return;
      }
      users[userIndex].passwordHash = hashPassword(newPassword);
      saveLocalAdminUsers(users);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (req.method === 'DELETE') {
      const { userId } = await readBody(req);
      if (!userId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Thiếu userId' }));
        return;
      }
      if (userId === currentUser.id) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Không thể tự xóa chính mình.' }));
        return;
      }
      const userIndex = users.findIndex(u => u.id === userId);
      if (userIndex === -1) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Không tìm thấy user' }));
        return;
      }
      users.splice(userIndex, 1);
      saveLocalAdminUsers(users);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

  }

  // ─── API: Lưu email nhân viên từ trang đăng ký ─────────────────────────
  if (pathname === '/api/employee/save-email') {
    if (req.method === 'POST') {
      const { empCode, email } = await readBody(req);
      if (!empCode || !email) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Thiếu thông tin' }));
        return;
      }
      const dataPath = path.join(__dirname, 'admin_schedule.json');
      let sysData = { locations: [] };
      if (fs.existsSync(dataPath)) {
        sysData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
      }
      let updated = false;
      if (sysData && sysData.locations) {
        sysData.locations.forEach(loc => {
          if (loc.employees) {
            loc.employees.forEach(emp => {
              if (emp.code === empCode) {
                emp.email = email.trim();
                updated = true;
              }
            });
          }
        });
      }
      if (!updated) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Không tìm thấy nhân viên' }));
        return;
      }
      fs.writeFileSync(dataPath, JSON.stringify(sysData, null, 2), 'utf8');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
  }

    // ─── API: Xác thực thiết bị (visitorId) ──────────────────────────────────
    // Biến lưu OTP local phục vụ test offline
    if (typeof global.localOtpData === 'undefined') {
      global.localOtpData = {};
    }

    if (pathname === '/api/auth/check-device') {
      if (req.method === 'POST') {
        const { empCode, visitorId } = await readBody(req);
        if (!empCode || !visitorId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Thiếu mã nhân viên hoặc mã thiết bị.' }));
          return;
        }
        const dataPath = path.join(__dirname, 'admin_schedule.json');
        let sysData = { locations: [] };
        if (fs.existsSync(dataPath)) {
          sysData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
        }
        let targetEmployee = null;
        let conflictsWithName = null;
        let isMatched = false;

        if (sysData && sysData.locations) {
          sysData.locations.forEach(loc => {
            if (loc.employees) {
              loc.employees.forEach(emp => {
                const devices = emp.registeredDevices || [];
                const hasDevice = devices.some(d => d.visitorId === visitorId);
                if (hasDevice) {
                  if (emp.code === empCode) {
                    isMatched = true;
                  } else {
                    conflictsWithName = emp.name;
                  }
                }
                if (emp.code === empCode) {
                  targetEmployee = emp;
                }
              });
            }
          });
        }

        if (!targetEmployee) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Không tìm thấy nhân viên.' }));
          return;
        }

        if (conflictsWithName) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            status: 'conflict',
            message: `Thiết bị này đã được liên kết với nhân viên khác (${conflictsWithName}).`
          }));
          return;
        }

        if (isMatched) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'allowed' }));
          return;
        }

        const email = targetEmployee.email || '';
        if (!email) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Nhân viên này chưa được cấu hình email trên hệ thống.' }));
          return;
        }
        const parts = email.split('@');
        const maskedEmail = parts[0].slice(0, 2) + '***@' + parts[1];

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'otp_required', maskedEmail }));
        return;
      }
    }

    if (pathname === '/api/auth/send-otp') {
      if (req.method === 'POST') {
        const { empCode, visitorId } = await readBody(req);
        if (!empCode || !visitorId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Thiếu mã nhân viên hoặc mã thiết bị.' }));
          return;
        }
        const dataPath = path.join(__dirname, 'admin_schedule.json');
        let sysData = { locations: [] };
        if (fs.existsSync(dataPath)) {
          sysData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
        }
        let targetEmployee = null;
        if (sysData && sysData.locations) {
          sysData.locations.forEach(loc => {
            if (loc.employees) {
              loc.employees.forEach(emp => {
                if (emp.code === empCode) targetEmployee = emp;
              });
            }
          });
        }
        if (!targetEmployee || !targetEmployee.email) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Nhân viên chưa cấu hình email.' }));
          return;
        }

        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const expiresAt = Date.now() + 5 * 60 * 1000;

        global.localOtpData[`${empCode}:${visitorId}`] = { otp, expiresAt };

        console.log(`\n==========================================`);
        console.log(`🔑 [LOCAL OTP] Nhân viên: ${targetEmployee.name} (${empCode})`);
        console.log(`🔑 [LOCAL OTP] Gửi tới: ${targetEmployee.email}`);
        console.log(`🔑 [LOCAL OTP] MÃ OTP CỦA BẠN LÀ: ${otp}`);
        console.log(`==========================================\n`);

        res.writeHead(200, { 'Content-Type': 'application/json' });

        if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
          try {
            const transporter = nodemailer.createTransport({
              service: 'gmail',
              auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS,
              },
            });

            await transporter.sendMail({
              from: `"Cà phê Hà My" <${process.env.EMAIL_USER}>`,
              to: targetEmployee.email,
              subject: 'Mã OTP xác minh thiết bị - Cà phê Hà My',
              text: `Chào bạn ${targetEmployee.name},\n\nBạn đang yêu cầu liên kết thiết bị đăng ký ca làm mới. Vui lòng sử dụng mã OTP dưới đây để xác thực:\n\n${otp}\n\nLưu ý: Mã OTP này có giá trị trong vòng 5 phút.\n\nNếu bạn không thực hiện yêu cầu này, vui lòng bỏ qua email hoặc liên hệ Admin.`,
              html: `
                <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff;">
                  <div style="text-align: center; margin-bottom: 20px;">
                    <h2 style="color: #0f766e; margin: 0; font-size: 22px;">☕ Cà phê Hà My</h2>
                    <p style="color: #64748b; font-size: 14px; margin: 5px 0 0 0;">Hệ Thống Đăng Ký Lịch Làm Việc</p>
                  </div>
                  <div style="padding: 24px; background-color: #f8fafc; border-radius: 10px; text-align: center;">
                    <p style="margin: 0 0 12px 0; font-size: 15px; color: #334155; font-weight: bold;">MÃ OTP XÁC MINH THIẾT BỊ</p>
                    <p style="margin: 0 0 24px 0; font-size: 14px; color: #475569; line-height: 1.5;">Chào bạn <b>${targetEmployee.name}</b>,<br>Bạn đang yêu cầu liên kết thiết bị đăng ký ca làm mới. Vui lòng sử dụng mã OTP dưới đây để xác thực:</p>
                    <div style="display: inline-block; font-size: 36px; font-weight: bold; color: #0f766e; letter-spacing: 6px; padding: 10px 20px; background: #e0f2fe; border-radius: 8px; margin-bottom: 20px;">${otp}</div>
                    <p style="margin: 0; font-size: 12.5px; color: #94a3b8;">Lưu ý: Mã OTP này có giá trị trong vòng <b>5 phút</b>.</p>
                  </div>
                  <div style="margin-top: 25px; text-align: center; font-size: 12px; color: #94a3b8; border-top: 1px dashed #e2e8f0; padding-top: 15px;">
                    Nếu bạn không thực hiện yêu cầu này, vui lòng bỏ qua email hoặc liên hệ Admin.
                  </div>
                </div>
              `
            });
            res.end(JSON.stringify({ ok: true, message: 'Đã gửi mã OTP qua Email.' }));
          } catch (mailErr) {
            console.error("Lỗi gửi mail local:", mailErr);
            res.end(JSON.stringify({ ok: true, message: '[LOCAL] Không thể gửi mail, đã giả lập OTP ở console.' }));
          }
        } else {
          res.end(JSON.stringify({ ok: true, message: '[LOCAL] Đã gửi OTP (Xem ở terminal console)' }));
        }
        return;
      }
    }

    if (pathname === '/api/auth/verify-otp') {
      if (req.method === 'POST') {
        const { empCode, visitorId, otp, deviceName } = await readBody(req);
        if (!empCode || !visitorId || !otp || !deviceName) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Thiếu thông tin xác thực OTP.' }));
          return;
        }

        const key = `${empCode}:${visitorId}`;
        const item = global.localOtpData[key];

        if (!item || item.otp !== otp.trim() || Date.now() > item.expiresAt) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Mã OTP không đúng hoặc đã hết hạn.' }));
          return;
        }

        delete global.localOtpData[key];

        const dataPath = path.join(__dirname, 'admin_schedule.json');
        let sysData = { locations: [] };
        if (fs.existsSync(dataPath)) {
          sysData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
        }
        let updated = false;

        if (sysData && sysData.locations) {
          sysData.locations.forEach(loc => {
            if (loc.employees) {
              loc.employees.forEach(emp => {
                if (emp.code === empCode) {
                  if (!emp.registeredDevices) emp.registeredDevices = [];
                  if (!emp.registeredDevices.some(d => d.visitorId === visitorId)) {
                    emp.registeredDevices.push({
                      visitorId,
                      addedAt: new Date().toISOString(),
                      deviceName: deviceName.trim()
                    });
                    updated = true;
                  }
                }
              });
            }
          });
        }

        if (!updated) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Không tìm thấy nhân viên.' }));
          return;
        }

        fs.writeFileSync(dataPath, JSON.stringify(sysData, null, 2), 'utf8');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, message: 'Xác thực thiết bị thành công!' }));
        return;
      }
    }

    // ─── API: đọc/ghi data files ────────────────────────────────────────────
    if (pathname.startsWith('/data/')) {
      const fileName = pathname.slice(6); // bỏ '/data/'

      if (!DATA_FILES.has(fileName)) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Forbidden: file không được phép' }));
        return;
      }

      const filePath = path.join(ROOT, fileName);

      // GET /data/:file — đọc file (công khai)
      if (req.method === 'GET') {
        try {
          const content = fs.readFileSync(filePath, 'utf8');
          res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
          res.end(content);
        } catch (e) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'File chưa có dữ liệu' }));
        }
        return;
      }

      // POST /data/:file — ghi file (Bảo vệ trừ employee_registrations)
      if (req.method === 'POST') {
        if (fileName !== 'employee_registrations.json') {
          const currentUser = await checkAdminAuthLocal(req);
          if (!currentUser) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Unauthorized: Cần đăng nhập Admin để ghi dữ liệu.' }));
            return;
          }
        }

        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
          try {
            const data = JSON.parse(body);
            fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
            console.log(`  💾 Saved: ${fileName}`);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, file: fileName }));
          } catch (e) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: e.message }));
          }
        });
        return;
      }

      res.writeHead(405); res.end('Method Not Allowed');
      return;
    }

    // ─── Routing & Route Protection ──────────────────────────────────────────
    // Hỗ trợ Clean URLs
    if (pathname === '/' || pathname === '/index') pathname = '/index.html';
    if (pathname === '/schedule') pathname = '/schedule.html';
    if (pathname === '/admin/login') pathname = '/admin/login.html';
    if (pathname === '/admin/users') pathname = '/admin/users.html';

    // Bảo vệ route phía Server (Mô phỏng Edge Middleware)
    const isProtectedPath =
      pathname === '/index.html' ||
      (pathname.startsWith('/admin/') && pathname !== '/admin/login.html');

    if (isProtectedPath) {
      const currentUser = await checkAdminAuthLocal(req);
      if (!currentUser) {
        // Chuyển hướng sang trang đăng nhập
        res.writeHead(302, { 'Location': '/admin/login' });
        res.end();
        return;
      }
    }

    const filePath = path.join(ROOT, pathname);

    // Bảo mật: chặn path traversal
    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403); res.end('Forbidden');
      return;
    }

    try {
      const stat = fs.statSync(filePath);
      if (stat.isDirectory()) {
        res.writeHead(302, { 'Location': pathname + '/index.html' });
        res.end();
        return;
      }

      const ext = path.extname(filePath).toLowerCase();
      const mime = MIME_TYPES[ext] || 'application/octet-stream';
      const content = fs.readFileSync(filePath);
      res.writeHead(200, { 'Content-Type': mime });
      res.end(content);
    } catch (e) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found: ' + pathname);
    }
  });

  server.listen(PORT, '0.0.0.0', () => {
    const ip = getLocalIP();
    // Khởi tạo sẵn tài khoản Admin local
    getLocalAdminUsers();
    console.log('\n  ╔══════════════════════════════════════════════╗');
    console.log('  ║   🌿  CFHM — Lịch Làm Việc Server           ║');
    console.log('  ╠══════════════════════════════════════════════╣');
    console.log(`  ║   Local:    http://localhost:${PORT}             ║`);
    console.log(`  ║   Network:  http://${ip}:${PORT}         ║`);
    console.log('  ╠══════════════════════════════════════════════╣');
    console.log('  ║   Tài khoản Admin test local mặc định:       ║');
    console.log('  ║   User: admin  /  Pass: admin123             ║');
    console.log('  ╚══════════════════════════════════════════════╝\n');
  });
