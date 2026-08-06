import { loadJson, saveJson } from '../../lib/r2.js';

const SCHEDULE_KEY = 'cfhm/admin_schedule.json';
const OTP_KEY      = 'cfhm/otp_codes.json';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method Not Allowed' }); return; }

  try {
    const { empCode, visitorId } = req.body || {};
    if (!empCode || !visitorId) {
      res.status(400).json({ error: 'Thiếu mã nhân viên hoặc mã thiết bị.' });
      return;
    }

    // 1. Tìm email của nhân viên
    const sysData = await loadJson(SCHEDULE_KEY);
    if (!sysData) {
      res.status(404).json({ error: 'Không tìm thấy dữ liệu hệ thống.' });
      return;
    }

    let targetEmployee = null;
    if (sysData.locations) {
      sysData.locations.forEach(loc => {
        (loc.employees || []).forEach(emp => {
          if (emp.code === empCode) targetEmployee = emp;
        });
      });
    }

    if (!targetEmployee || !targetEmployee.email) {
      res.status(404).json({ error: 'Nhân viên chưa thiết lập email, không thể nhận OTP.' });
      return;
    }

    const email = targetEmployee.email.trim();

    // 2. Sinh OTP 6 số
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = Date.now() + 5 * 60 * 1000;

    // 3. Lưu OTP lên R2
    const otpData = (await loadJson(OTP_KEY)) || {};
    otpData[`${empCode}:${visitorId}`] = { otp, expiresAt };
    await saveJson(OTP_KEY, otpData);

    // 4. Gửi email qua Brevo REST API
    try {
      const brevoApiKey = process.env.BREVO_API_KEY;
      const senderEmail = process.env.SENDER_EMAIL;
      const senderName = process.env.SENDER_NAME || 'CF Ha My OTP';

      if (!brevoApiKey || !senderEmail) {
        throw new Error('Chưa cấu hình BREVO_API_KEY hoặc SENDER_EMAIL trong biến môi trường.');
      }

      const response = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'accept': 'application/json',
          'content-type': 'application/json',
          'api-key': brevoApiKey
        },
        body: JSON.stringify({
          sender: {
            name: senderName,
            email: senderEmail
          },
          to: [
            {
              email: email,
              name: targetEmployee.name
            }
          ],
          subject: 'Mã OTP xác minh thiết bị - Cà phê Hà My',
          textContent: `Chào bạn ${targetEmployee.name},\n\nBạn đang yêu cầu liên kết thiết bị đăng ký ca làm mới. Mã OTP của bạn là: ${otp}\n\nMã có hiệu lực trong vòng 5 phút.`,
          htmlContent: `
            <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 12px;">
              <div style="text-align: center; margin-bottom: 20px;">
                <h2 style="color: #0f766e; margin: 0;">☕ Cà phê Hà My</h2>
                <p style="color: #64748b; font-size: 14px; margin: 5px 0 0 0;">Hệ Thống Đăng Ký Lịch Làm Việc</p>
              </div>
              <div style="padding: 24px; background-color: #f8fafc; border-radius: 10px; text-align: center;">
                <p style="margin: 0 0 12px 0; font-size: 15px; color: #334155; font-weight: bold;">MÃ OTP XÁC MINH THIẾT BỊ</p>
                <p style="margin: 0 0 24px 0; font-size: 14px; color: #475569; line-height: 1.5;">Chào bạn <b>${targetEmployee.name}</b>,<br>Vui lòng dùng mã OTP dưới đây để xác thực thiết bị:</p>
                <div style="display: inline-block; font-size: 36px; font-weight: bold; color: #0f766e; letter-spacing: 6px; padding: 10px 20px; background: #e0f2fe; border-radius: 8px; margin-bottom: 20px;">${otp}</div>
                <p style="margin: 0; font-size: 12.5px; color: #94a3b8;">Mã OTP này có giá trị trong vòng <b>5 phút</b>.</p>
              </div>
              <div style="margin-top: 25px; text-align: center; font-size: 12px; color: #94a3b8; border-top: 1px dashed #e2e8f0; padding-top: 15px;">
                Nếu bạn không thực hiện yêu cầu này, vui lòng bỏ qua email hoặc liên hệ Admin.
              </div>
            </div>
          `
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Brevo API Error (${response.status}): ${errorText}`);
      }

      res.status(200).json({ ok: true, message: 'Đã gửi mã OTP qua Email.' });
    } catch (mailErr) {
      console.error('[send-otp] mail error:', mailErr.message);
      res.status(500).json({ error: 'Không thể gửi email OTP, vui lòng thử lại sau.' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
