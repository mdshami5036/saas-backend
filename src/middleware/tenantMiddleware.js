const prisma = require('../config/db');

async function resolveTenantBySlug(req, res, next) {
  try {
    const slug = req.params.slug || req.query.slug;
    if (!slug) {
      return res.status(400).json({ success: false, error: 'Cyber Cafe slug is required' });
    }

    const tenant = await prisma.tenant.findUnique({
      where: { slug: slug.toLowerCase() },
    });

    if (!tenant) {
      return res.status(404).json({ success: false, error: 'Cyber Cafe not found' });
    }

    if (tenant.status !== 'ACTIVE') {
      return res.status(403).json({ success: false, error: 'This Cyber Cafe is currently inactive' });
    }

    req.tenant = tenant;
    next();
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Error resolving tenant', details: error.message });
  }
}

async function resolveAgentToken(req, res, next) {
  try {
    const agentToken = req.headers['x-agent-token'] || req.query.agentToken;
    if (!agentToken) {
      return res.status(401).json({ success: false, error: 'Agent Token missing (X-Agent-Token)' });
    }

    const tenant = await prisma.tenant.findUnique({
      where: { agentToken },
    });

    if (!tenant) {
      return res.status(401).json({ success: false, error: 'Invalid Agent Token' });
    }

    if (tenant.status !== 'ACTIVE') {
      return res.status(403).json({ success: false, error: 'Cyber Cafe account disabled' });
    }

    req.tenant = tenant;
    next();
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Error authenticating Agent Token', details: error.message });
  }
}

async function resolveApiKey(req, res, next) {
  try {
    const apiKey = req.headers['x-api-key'] || req.query.apiKey;
    if (!apiKey) {
      return res.status(401).json({ success: false, error: 'API Key missing (X-API-Key)' });
    }

    const tenant = await prisma.tenant.findUnique({
      where: { apiKey },
    });

    if (!tenant) {
      return res.status(401).json({ success: false, error: 'Invalid API Key' });
    }

    if (tenant.status !== 'ACTIVE') {
      return res.status(403).json({ success: false, error: 'Cyber Cafe account disabled' });
    }

    req.tenant = tenant;
    next();
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Error authenticating API Key', details: error.message });
  }
}

module.exports = {
  resolveTenantBySlug,
  resolveAgentToken,
  resolveApiKey,
};
