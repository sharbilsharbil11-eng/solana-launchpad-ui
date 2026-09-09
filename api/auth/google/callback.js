const { setSessionCookie, parseCookies } = require('../../../lib/session');
const db = require('../../../lib/db');

module.exports = async (req, res) => {
  try {
    const url = new URL(req.url, `https://${req.headers.host}`);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const cookies = parseCookies(req.headers.cookie);

    if (!code || !state || state !== cookies.velo_oauth_state) {
      res.statusCode = 400;
      res.end('Invalid or expired sign-in attempt. Go back and try again.');
      return;
    }

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const baseUrl = process.env.APP_BASE_URL || `https://${req.headers.host}`;

    const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: `${baseUrl}/api/auth/google/callback`,
        grant_type: 'authorization_code',
      }),
    });
    const tokenData = await tokenResp.json();
    if (!tokenData.access_token) {
      throw new Error('Google did not return an access token: ' + JSON.stringify(tokenData));
    }

    const userResp = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const gUser = await userResp.json();
    if (!gUser.sub) {
      throw new Error('Google did not return a user id: ' + JSON.stringify(gUser));
    }

    const existing = await db.query(
      'SELECT user_id FROM oauth_accounts WHERE provider = $1 AND provider_user_id = $2',
      ['google', gUser.sub]
    );

    let userId;
    if (existing.rows.length) {
      userId = existing.rows[0].user_id;
      await db.query(
        'UPDATE oauth_accounts SET email = $1, display_name = $2, avatar_url = $3 WHERE provider = $4 AND provider_user_id = $5',
        [gUser.email, gUser.name, gUser.picture, 'google', gUser.sub]
      );
    } else {
      const inserted = await db.query('INSERT INTO users DEFAULT VALUES RETURNING id');
      userId = inserted.rows[0].id;
      await db.query(
        'INSERT INTO oauth_accounts (user_id, provider, provider_user_id, email, display_name, avatar_url) VALUES ($1, $2, $3, $4, $5, $6)',
        [userId, 'google', gUser.sub, gUser.email, gUser.name, gUser.picture]
      );
    }

    setSessionCookie(res, userId);
    res.statusCode = 302;
    res.setHeader('Location', '/profile.html');
    res.end();
  } catch (err) {
    console.error('Google OAuth callback failed:', err);
    res.statusCode = 500;
    res.end('Google sign-in failed. Please try again.');
  }
};
