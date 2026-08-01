const jwt = require('jsonwebtoken');
const prisma = require('../config/db');

const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-jwt-key-auto-print-saas-2026';

async function authenticateTenant(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, error: 'Unauthorized: No token provided' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);

    if (decoded.role !== 'TENANT') {
      return res.status(403).json({ success: false, error: 'Forbidden: Tenant access required' });
    }

    const tenant = await prisma.tenant.findUnique({
      where: { id: decoded.tenantId },
    });

    if (!tenant) {
      return res.status(401).json({ success: false, error: 'Tenant account not found' });
    }

    if (tenant.status !== 'ACTIVE') {
      return res.status(403).json({ success: false, error: 'Tenant account is disabled or suspended' });
    }

    req.tenant = tenant;
    next();
  } catch (error) {
    return res.status(401).json({ success: false, error: 'Invalid or expired token', details: error.message });
  }
}

async function authenticateAdmin(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, error: 'Unauthorized: Admin token required' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);

    if (decoded.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ success: false, error: 'Forbidden: Super Admin access required' });
    }

    req.admin = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ success: false, error: 'Invalid or expired admin token' });
  }
}

module.exports = {
  authenticateTenant,
  authenticateAdmin,
};
