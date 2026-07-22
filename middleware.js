import { jwtVerify } from 'jose';

const JWT_SECRET = process.env.JWT_SECRET || 'cfhm-calendar-super-secret-key-1234567890';

export async function middleware(request) {
  const url = new URL(request.url);
  const { pathname } = url;

  // Bảo vệ trang chủ admin (index.html) và các trang trong thư mục /admin/ (trừ trang login)
  const isProtectedPath = 
    pathname === '/' || 
    pathname === '/index.html' || 
    (pathname.startsWith('/admin') && pathname !== '/admin/login' && pathname !== '/admin/login.html');

  if (isProtectedPath) {
    const cookieHeader = request.headers.get('cookie') || '';
    const tokenCookie = cookieHeader.split(';').find(c => c.trim().startsWith('admin_token='));
    const token = tokenCookie ? tokenCookie.split('=')[1] : null;

    if (!token) {
      url.pathname = '/admin/login';
      return Response.redirect(url);
    }

    try {
      const secret = new TextEncoder().encode(JWT_SECRET);
      await jwtVerify(token, secret);
      // Tiếp tục request bình thường
      return;
    } catch (err) {
      console.error('Middleware JWT verification failed:', err);
      url.pathname = '/admin/login';
      const res = Response.redirect(url);
      // Xoá cookie hết hạn
      res.headers.set('Set-Cookie', 'admin_token=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax');
      return res;
    }
  }
}

export const config = {
  matcher: ['/', '/index.html', '/admin/:path*'],
};
