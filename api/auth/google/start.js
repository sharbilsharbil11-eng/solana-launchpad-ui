const crypto = require('crypto');

module.exports = async (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    res.statusCode = 500;
    res.end('Google sign-in is not configured yet (missing GOOGLE_CLIENT_ID). See README for setup steps.');
    return;
  }
  const baseUrl = process.env.APP_BASE_URL || `https://${req.headers.host}`;
  const state = crypto.randomBytes(16).toString('hex');
  res.setHeader('Set-Cookie', `velo_oauth_state=${state}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`);
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${baseUrl}/api/auth/google/callback`,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
  });
  res.statusCode = 302;
  res.setHeader('Location', `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
  res.end();
};
