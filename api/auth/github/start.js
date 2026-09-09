const crypto = require('crypto');

module.exports = async (req, res) => {
  const clientId = process.env.GITHUB_CLIENT_ID;
  if (!clientId) {
    res.statusCode = 500;
    res.end('GitHub sign-in is not configured yet (missing GITHUB_CLIENT_ID). See README for setup steps.');
    return;
  }
  const baseUrl = process.env.APP_BASE_URL || `https://${req.headers.host}`;
  const state = crypto.randomBytes(16).toString('hex');
  res.setHeader('Set-Cookie', `velo_oauth_state=${state}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`);
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${baseUrl}/api/auth/github/callback`,
    scope: 'read:user user:email',
    state,
  });
  res.statusCode = 302;
  res.setHeader('Location', `https://github.com/login/oauth/authorize?${params.toString()}`);
  res.end();
};
