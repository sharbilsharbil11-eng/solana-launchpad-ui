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

    const clientId = process.env.GITHUB_CLIENT_ID;
    const clientSecret = process.env.GITHUB_CLIENT_SECRET;
    const baseUrl = process.env.APP_BASE_URL || `https://${req.headers.host}`;

    const tokenResp = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: `${baseUrl}/api/auth/github/callback`,
      }),
    });
    const tokenData = await tokenResp.json();
    if (!tokenData.access_token) {
      throw new Error('GitHub did not return an access token: ' + JSON.stringify(tokenData));
    }

    const userResp = await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${tokenData.access_token}`, 'User-Agent': 'velo-app' },
    });
    const ghUser = await userResp.json();

    let email = ghUser.email;
    if (!email) {
      const emailsResp = await fetch('https://api.github.com/user/emails', {
        headers: { Authorization: `Bearer ${tokenData.access_token}`, 'User-Agent': 'velo-app' },
      });
      const emails = await emailsResp.json();
      const primary = Array.isArray(emails) ? emails.find((e) => e.primary) : null;
      email = primary ? primary.email : null;
    }

    const existing = await db.query(
      'SELECT user_id FROM oauth_accounts WHERE provider = $1 AND provider_user_id = $2',
      ['github', String(ghUser.id)]
    );

    let userId;
    if (existing.rows.length) {
      userId = existing.rows[0].user_id;
      await db.query(
        'UPDATE oauth_accounts SET email = $1, display_name = $2, avatar_url = $3 WHERE provider = $4 AND provider_user_id = $5',
        [email, ghUser.login, ghUser.avatar_url, 'github', String(ghUser.id)]
      );
    } else {
      const inserted = await db.query('INSERT INTO users DEFAULT VALUES RETURNING id');
      userId = inserted.rows[0].id;
      await db.query(
        'INSERT INTO oauth_accounts (user_id, provider, provider_user_id, email, display_name, avatar_url) VALUES ($1, $2, $3, $4, $5, $6)',
        [userId, 'github', String(ghUser.id), email, ghUser.login, ghUser.avatar_url]
      );
    }

    setSessionCookie(res, userId);
    res.statusCode = 302;
    res.setHeader('Location', '/profile.html');
    res.end();
  } catch (err) {
    console.error('GitHub OAuth callback failed:', err);
    res.statusCode = 500;
    res.end('GitHub sign-in failed. Please try again.');
  }
};
