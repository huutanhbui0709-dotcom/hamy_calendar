/**
 * lib/r2.js
 * Module chung quản lý đọc/ghi JSON lên Cloudflare R2 (qua AWS S3 SDK).
 * Thay thế toàn bộ @vercel/blob trong dự án.
 *
 * Sử dụng:
 *   import { loadJson, saveJson } from '../../lib/r2.js';
 *   const data = await loadJson('cfhm/admin_schedule.json');
 *   await saveJson('cfhm/admin_schedule.json', data);
 */

import { S3Client, GetObjectCommand, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';

// ── Khởi tạo S3 Client kết nối R2 ──────────────────────────────────────────
const R2_ACCOUNT_ID      = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID   = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_KEY      = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET          = process.env.R2_BUCKET_NAME;
const R2_PUBLIC_URL      = (process.env.R2_PUBLIC_URL || '').replace(/\/$/, '');

let _client = null;
function getClient() {
  if (!_client) {
    _client = new S3Client({
      region: 'auto',
      endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: R2_ACCESS_KEY_ID,
        secretAccessKey: R2_SECRET_KEY,
      },
    });
  }
  return _client;
}

/**
 * Đọc file JSON từ R2.
 * @param {string} key  - Đường dẫn đầy đủ trên bucket, vd: 'cfhm/admin_schedule.json'
 * @returns {any|null}  - Object/Array parse được, hoặc null nếu không tồn tại
 */
export async function loadJson(key) {
  try {
    const client = getClient();
    const cmd = new GetObjectCommand({ Bucket: R2_BUCKET, Key: key });
    const res = await client.send(cmd);

    // Đọc stream body thành string
    const chunks = [];
    for await (const chunk of res.Body) {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    }
    const text = Buffer.concat(chunks).toString('utf8');
    return JSON.parse(text);
  } catch (err) {
    // NoSuchKey = file chưa tồn tại → trả về null
    if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) {
      return null;
    }
    throw err;
  }
}

/**
 * Ghi file JSON lên R2 (overwrite hoàn toàn).
 * @param {string} key   - Đường dẫn đầy đủ trên bucket
 * @param {any}    data  - Dữ liệu sẽ được JSON.stringify
 * @returns {string}     - Public URL của file sau khi ghi
 */
export async function saveJson(key, data) {
  try {
    const client = getClient();
    const body = JSON.stringify(data);
    const cmd = new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      Body: body,
      ContentType: 'application/json',
      CacheControl: 'no-store',
    });
    await client.send(cmd);
    const url = `${R2_PUBLIC_URL}/${key}`;
    return url;
  } catch (err) {
    console.error(`[R2] saveJson error for key "${key}":`, err.message);
    throw err;
  }
}

/**
 * Kiểm tra file có tồn tại trên R2 không.
 * @param {string} key
 * @returns {boolean}
 */
export async function exists(key) {
  try {
    const client = getClient();
    await client.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key }));
    return true;
  } catch {
    return false;
  }
}

/**
 * Lấy URL public của một key trên R2.
 * @param {string} key
 * @returns {string}
 */
export function getPublicUrl(key) {
  return `${R2_PUBLIC_URL}/${key}`;
}
