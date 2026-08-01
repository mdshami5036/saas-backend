const crypto = require('crypto');

function generateApiKey() {
  return 'pk_' + crypto.randomBytes(16).toString('hex');
}

function generateAgentToken() {
  return 'ag_' + crypto.randomBytes(16).toString('hex');
}

function generateSlug(name) {
  const baseSlug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/[\s-]+/g, '-');
  const randomSuffix = crypto.randomBytes(3).toString('hex');
  return `${baseSlug}-${randomSuffix}`;
}

function verifyHardwareHash(fingerprintString, expectedHash) {
  const hash = crypto.createHash('sha256').update(fingerprintString).digest('hex');
  return hash === expectedHash;
}

module.exports = {
  generateApiKey,
  generateAgentToken,
  generateSlug,
  verifyHardwareHash,
};
