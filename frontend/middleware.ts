import { NextResponse } from "next/server";

// CSP without a script nonce. A nonce policy blocks Next.js's un-nonced inline
// bootstrap <script>, which stops hydration and leaves the app stuck on its
// loading spinner. 'unsafe-inline' for script-src keeps the app working; every
// other directive (default-src self, frame-ancestors, restricted connect-src,
// base-uri, form-action) still applies. ponytail: working CSP > broken nonce CSP.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "connect-src 'self' ws: wss: http://localhost:4000 http://localhost:5050",
  "font-src 'self'",
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "form-action 'self' https://rc-epay.esewa.com.np https://epay.esewa.com.np",
].join("; ");

export function middleware() {
  const res = NextResponse.next();
  res.headers.set("Content-Security-Policy", CSP);
  return res;
}

export const config = {
  matcher: "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
};
