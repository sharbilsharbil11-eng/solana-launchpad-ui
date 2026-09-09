const crypto = require('crypto');

const COOKIE_NAME = 'velo_session';
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function sign(userId) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET is not set');
  const payload = base64url(JSON.stringify({ uid: userId, iat: Date.now() }));
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function verify(cookieValue) {
  if (!cookieValue) return null;
  const secret = process.env.SESSION_SECRET;
  if (!secret) return null;
  const parts = cookieValue.split('.');
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  const expectedSig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;
  let data;
  try {
    data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch (err) {
    return null;
  }
  if (!data || typeof data.uid !== 'number' || typeof data.iat !== 'number') return null;
  if (Date.now() - data.iat > MAX_AGE_MS) return null;
  return data.uid;
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  header.split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx === -1) return;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    out[key] = decodeURIComponent(val);
  });
  return out;
}

function getUserIdFromRequest(req) {
  const cookies = parseCookies(req.headers.cookie);
  return verify(cookies[COOKIE_NAME]);
}

function setSessionCookie(res, userId) {
  const value = sign(userId);
  const maxAgeSec = Math.floor(MAX_AGE_MS / 1000);
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAgeSec}`);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`);
}

module.exports = { getUserIdFromRequest, setSessionCookie, clearSessionCookie, parseCookies, COOKIE_NAME };
