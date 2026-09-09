const { getUserIdFromRequest } = require('../../lib/session');
const db = require('../../lib/db');

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  const userId = getUserIdFromRequest(req);
  if (!userId) {
    res.statusCode = 200;
    res.end(JSON.stringify({ loggedIn: false, user: null }));
    return;
  }
  try {
    const oauth = await db.query(
      'SELECT provider, display_name, avatar_url, email FROM oauth_accounts WHERE user_id = $1 ORDER BY created_at ASC LIMIT 1',
      [userId]
    );
    const wallet = await db.query('SELECT address FROM linked_wallets WHERE user_id = $1 LIMIT 1', [userId]);
    const identity = oauth.rows[0] || null;

    res.statusCode = 200;
    res.end(JSON.stringify({
      loggedIn: true,
      user: {
        id: userId,
        provider: identity ? identity.provider : (wallet.rows.length ? 'wallet' : null),
        name: identity ? identity.display_name : null,
        avatar: identity ? identity.avatar_url : null,
        email: identity ? identity.email : null,
        walletAddress: wallet.rows.length ? wallet.rows[0].address : null,
      },
    }));
  } catch (err) {
    console.error('Session lookup failed:', err);
    res.statusCode = 500;
    res.end(JSON.stringify({ loggedIn: false, user: null, error: 'lookup_failed' }));
  }
};
