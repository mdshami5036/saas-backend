const crypto = require('crypto');

function generateApiKey() {
  return 'pk_' + crypto.randomBytes(16).toString('hex');
}

// 6-digit unique numeric Print Agent Token (e.g. 748291)
function generateAgentToken() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function generateUniqueAgentToken(prisma) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const candidate = Math.floor(100000 + Math.random() * 900000).toString();
    if (!prisma) return candidate;
    const existing = await prisma.tenant.findUnique({ where: { agentToken: candidate } });
    if (!existing) {
      return candidate;
    }
  }
  return Math.floor(100000 + Math.random() * 900000).toString();
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
  generateUniqueAgentToken,
  generateSlug,
  verifyHardwareHash,
};
