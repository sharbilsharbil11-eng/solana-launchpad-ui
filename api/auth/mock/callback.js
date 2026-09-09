// Placeholder sign-in for providers that don't have a registered OAuth app yet
// (X, TikTok, Kick, Email — each needs its own developer app + review before
// it can be wired up like GitHub/Google are). This still creates a real
// session backed by Postgres, it just skips actually verifying an external
// account, so the rest of the app (profile gating, logout) works the same way
// for every provider while these remain unimplemented.
const { setSessionCookie } = require('../../../lib/session');
const db = require('../../../lib/db');

const KNOWN_METHODS = new Set(['x', 'tiktok', 'kick', 'email']);

module.exports = async (req, res) => {
  try {
    const url = new URL(req.url, `https://${req.headers.host}`);
    const rawMethod = url.searchParams.get('method') || 'mock';
    const method = KNOWN_METHODS.has(rawMethod) ? rawMethod : 'mock';

    const inserted = await db.query('INSERT INTO users DEFAULT VALUES RETURNING id');
    const userId = inserted.rows[0].id;
    await db.query(
      'INSERT INTO oauth_accounts (user_id, provider, provider_user_id, display_name) VALUES ($1, $2, $3, $4)',
      [userId, method, `placeholder-${userId}`, `${method} user (placeholder)`]
    );

    setSessionCookie(res, userId);
    res.statusCode = 302;
    res.setHeader('Location', '/profile.html');
    res.end();
  } catch (err) {
    console.error('Placeholder sign-in failed:', err);
    res.statusCode = 500;
    res.end('Sign-in failed. Please try again.');
  }
};
