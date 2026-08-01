const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const prisma = require('../config/db');

const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-jwt-key-auto-print-saas-2026';

async function adminLogin(req, res) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email and password required' });
    }

    let admin = await prisma.admin.findUnique({
      where: { email: email.toLowerCase() },
    });

    // Default admin creation if none exists
    if (!admin && email === 'admin@autoprint.com' && password === 'admin123') {
      const hash = await bcrypt.hash('admin123', 10);
      admin = await prisma.admin.create({
        data: {
          email: 'admin@autoprint.com',
          name: 'Platform Super Admin',
          passwordHash: hash,
          role: 'SUPER_ADMIN',
        },
      });
    }

    if (!admin) {
      return res.status(401).json({ success: false, error: 'Invalid admin credentials' });
    }

    const isMatch = await bcrypt.compare(password, admin.passwordHash);
    if (!isMatch) {
      return res.status(401).json({ success: false, error: 'Invalid admin credentials' });
    }

    const token = jwt.sign(
      { adminId: admin.id, email: admin.email, role: 'SUPER_ADMIN' },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    return res.json({
      success: true,
      token,
      admin: {
        id: admin.id,
        name: admin.name,
        email: admin.email,
        role: admin.role,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Admin login error', details: error.message });
  }
}

async function getPlatformStats(req, res) {
  try {
    const totalCafes = await prisma.tenant.count();
    const activeCafes = await prisma.tenant.count({ where: { status: 'ACTIVE' } });
    const totalJobs = await prisma.printJob.count({ where: { jobStatus: 'COMPLETED' } });
    const activeOnlineDevices = await prisma.device.count({ where: { isOnline: true } });

    const totalRevenueAgg = await prisma.payment.aggregate({
      where: { status: 'SUCCESS' },
      _sum: { amount: true },
    });

    return res.json({
      success: true,
      stats: {
        totalCafes,
        activeCafes,
        totalPrintJobsCompleted: totalJobs,
        activeOnlineDevices,
        totalPlatformRevenue: totalRevenueAgg._sum.amount || 0,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Failed to fetch platform stats' });
  }
}

async function listCafes(req, res) {
  try {
    const cafes = await prisma.tenant.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        devices: { select: { isOnline: true, selectedPrinter: true, lastSeenAt: true } },
        _count: { select: { printJobs: true } },
      },
    });

    return res.json({ success: true, cafes });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Failed to list Cyber Cafes' });
  }
}

async function updateCafeStatus(req, res) {
  try {
    const { id } = req.params;
    const { status } = req.body; // 'ACTIVE' | 'DISABLED' | 'SUSPENDED'

    if (!['ACTIVE', 'DISABLED', 'SUSPENDED'].includes(status)) {
      return res.status(400).json({ success: false, error: 'Invalid status value' });
    }

    const updated = await prisma.tenant.update({
      where: { id },
      data: { status },
    });

    return res.json({
      success: true,
      message: `Cyber Cafe status updated to ${status}`,
      cafe: { id: updated.id, name: updated.name, status: updated.status },
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Failed to update cafe status' });
  }
}

module.exports = {
  adminLogin,
  getPlatformStats,
  listCafes,
  updateCafeStatus,
};
