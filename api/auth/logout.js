const { clearSessionCookie } = require('../../lib/session');

module.exports = async (req, res) => {
  clearSessionCookie(res);
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ ok: true }));
};
