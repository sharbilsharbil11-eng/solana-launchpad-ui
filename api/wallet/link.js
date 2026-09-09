const nacl = require('tweetnacl');
const bs58 = require('bs58');
const { getUserIdFromRequest, setSessionCookie } = require('../../lib/session');
const db = require('../../lib/db');

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch (err) { reject(err); }
    });
    req.on('error', reject);
  });
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.end(JSON.stringify({ error: 'method_not_allowed' }));
    return;
  }
  try {
    const body = await readJsonBody(req);
    const { address, message, signature } = body;
    if (!address || !message || !Array.isArray(signature)) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: 'address, message, and signature are required' }));
      return;
    }
    // The signed message must actually mention this address, so a signature
    // for one wallet can't be replayed to link a different one.
    if (!message.includes(address)) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: 'message does not match address' }));
      return;
    }

    const pubKeyBytes = bs58.decode(address);
    const sigBytes = Uint8Array.from(signature);
    const messageBytes = new TextEncoder().encode(message);
    const validSignature = nacl.sign.detached.verify(messageBytes, sigBytes, pubKeyBytes);
    if (!validSignature) {
      res.statusCode = 401;
      res.end(JSON.stringify({ error: 'signature_invalid' }));
      return;
    }

    const existingWallet = await db.query('SELECT user_id FROM linked_wallets WHERE address = $1', [address]);

    let userId = getUserIdFromRequest(req);
    if (existingWallet.rows.length) {
      userId = existingWallet.rows[0].user_id;
    } else {
      if (!userId) {
        const inserted = await db.query('INSERT INTO users DEFAULT VALUES RETURNING id');
        userId = inserted.rows[0].id;
      }
      await db.query('INSERT INTO linked_wallets (user_id, address) VALUES ($1, $2)', [userId, address]);
    }

    setSessionCookie(res, userId);
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true }));
  } catch (err) {
    console.error('Wallet link failed:', err);
    res.statusCode = 500;
    res.end(JSON.stringify({ error: 'internal_error' }));
  }
};
