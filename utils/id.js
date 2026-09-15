const crypto = require('crypto');

function nanoid(size = 21) {
  return crypto.randomBytes(size).toString('base64url').slice(0, size);
}

module.exports = { nanoid };
