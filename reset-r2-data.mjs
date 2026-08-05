/**
 * reset-r2-data.mjs
 * Script one-shot: ghi đè admin_schedule.json lên Cloudflare R2
 * Chạy: node reset-r2-data.mjs
 */

import { readFileSync } from 'fs';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { createRequire } from 'module';

// Đọc .env thủ công nếu không dùng dotenv
import { config } from 'dotenv';
config();

const R2_ACCOUNT_ID     = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID  = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_KEY     = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET         = process.env.R2_BUCKET_NAME;

if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_KEY || !R2_BUCKET) {
  console.error('❌ Thiếu biến môi trường R2! Kiểm tra file .env');
  console.error('  Cần: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME');
  process.exit(1);
}

const client = new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_KEY,
  },
});

async function uploadFile(localPath, r2Key) {
  const content = readFileSync(localPath, 'utf8');
  // Validate JSON
  const parsed = JSON.parse(content);
  const body = JSON.stringify(parsed, null, 2);

  const cmd = new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: r2Key,
    Body: body,
    ContentType: 'application/json',
  });

  await client.send(cmd);
  console.log(`✅ Đã upload: ${r2Key} (${body.length} bytes)`);
}

console.log('🚀 Bắt đầu reset dữ liệu R2...');
console.log(`   Bucket: ${R2_BUCKET}`);
console.log('');

try {
  await uploadFile('./admin_schedule.json', 'cfhm/admin_schedule.json');
  console.log('');
  console.log('✅ Hoàn tất! Dữ liệu R2 đã được cập nhật.');
  console.log('   Mở lại trang Admin để xem kết quả.');
} catch (err) {
  console.error('❌ Lỗi khi upload:', err.message);
  process.exit(1);
}
