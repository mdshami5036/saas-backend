const prisma = require('../config/db');
const { generateApiKey, generateAgentToken } = require('../utils/tokenGenerator');
const { generateQRCodeDataURL, generateQRCodeSVG } = require('../utils/qrGenerator');
const { encryptCredential, decryptCredential } = require('../utils/cryptoUtil');
const path = require('path');
const fs = require('fs');

const FRONTEND_URL = process.env.FRONTEND_URL || 'https://saas-nine-ochre.vercel.app';
const BASE_SERVER_URL = process.env.BASE_SERVER_URL || 'https://saas-backend-production-5c3e.up.railway.app';

async function getDashboardData(req, res) {
  try {
    const tenant = req.tenant;
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const todayPrintCount = await prisma.printJob.count({
      where: {
        tenantId: tenant.id,
        jobStatus: 'COMPLETED',
        createdAt: { gte: todayStart },
      },
    });

    const todayRevenueSum = await prisma.payment.aggregate({
      where: {
        tenantId: tenant.id,
        status: 'SUCCESS',
        createdAt: { gte: todayStart },
      },
      _sum: { amount: true },
    });

    const activeQueueCount = await prisma.printJob.count({
      where: {
        tenantId: tenant.id,
        jobStatus: { in: ['PENDING', 'SENT_TO_AGENT', 'PRINTING'] },
      },
    });

    const devices = await prisma.device.findMany({
      where: { tenantId: tenant.id },
      orderBy: { lastSeenAt: 'desc' },
    });

    const twoMinutesAgo = new Date(Date.now() - 120 * 1000);
    const isAgentOnline = devices.some((d) => d.isOnline && d.lastSeenAt && new Date(d.lastSeenAt) > twoMinutesAgo);

    // Decrypt Key ID for the authenticated cafe user; secret is NEVER returned to client
    const decryptedKeyId = tenant.razorpayKeyId ? (decryptCredential(tenant.razorpayKeyId) || '') : '';
    const hasCustomRazorpay = !!(tenant.razorpayKeyId && tenant.razorpayKeySecret);

    return res.json({
      success: true,
      metrics: {
        todayPrintCount,
        todayRevenue: todayRevenueSum._sum.amount || 0,
        activeQueueCount,
        isAgentOnline,
      },
      cafe: {
        id: tenant.id,
        name: tenant.name,
        email: tenant.email,
        phone: tenant.phone || '',
        slug: tenant.slug,
        websiteUrl: `${FRONTEND_URL}/cafe/${tenant.slug}`,
        backendApiUrl: `${BASE_SERVER_URL}/api/v1`,
        apiKey: tenant.apiKey,
        agentToken: tenant.agentToken,
        bwPricePerPage: tenant.bwPricePerPage,
        colorPricePerPage: tenant.colorPricePerPage,
        qrCodeUrl: tenant.qrCodeUrl,
        razorpayKeyId: decryptedKeyId,
        hasCustomRazorpay,
      },
      devices,
    });
  } catch (error) {
    console.error('Dashboard data error:', error);
    return res.status(500).json({ success: false, error: 'Failed to load dashboard', details: error.message });
  }
}

async function updatePricing(req, res) {
  try {
    const tenant = req.tenant;
    const { bwPricePerPage, colorPricePerPage, name, phone } = req.body;

    const updateData = {};
    if (bwPricePerPage !== undefined) updateData.bwPricePerPage = parseFloat(bwPricePerPage);
    if (colorPricePerPage !== undefined) updateData.colorPricePerPage = parseFloat(colorPricePerPage);
    if (name && name.trim()) updateData.name = name.trim();
    if (phone !== undefined) updateData.phone = phone ? phone.trim() : null;

    const updated = await prisma.tenant.update({
      where: { id: tenant.id },
      data: updateData,
    });

    return res.json({
      success: true,
      message: 'Profile & pricing updated successfully',
      cafe: {
        name: updated.name,
        email: updated.email,
        phone: updated.phone,
        bwPricePerPage: updated.bwPricePerPage,
        colorPricePerPage: updated.colorPricePerPage,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Failed to update settings' });
  }
}

async function updateRazorpayCredentials(req, res) {
  try {
    const tenant = req.tenant;
    const { razorpayKeyId, razorpayKeySecret } = req.body;

    const dataToUpdate = {};

    // 🔒 Strictly encrypt Razorpay Key ID with AES-256-GCM before saving to database
    if (razorpayKeyId !== undefined && razorpayKeyId !== null) {
      const trimmed = razorpayKeyId.trim();
      dataToUpdate.razorpayKeyId = trimmed ? encryptCredential(trimmed) : null;
    }

    // 🔒 Strictly encrypt Razorpay Key Secret with AES-256-GCM before saving to database
    if (razorpayKeySecret !== undefined && razorpayKeySecret !== null && razorpayKeySecret.trim().length > 0) {
      dataToUpdate.razorpayKeySecret = encryptCredential(razorpayKeySecret.trim());
    }

    const updated = await prisma.tenant.update({
      where: { id: tenant.id },
      data: dataToUpdate,
    });

    console.log(`[Security Audit] Razorpay credentials securely encrypted with AES-256-GCM for tenant ${tenant.slug}`);

    return res.json({
      success: true,
      message: 'Razorpay credentials encrypted with 256-bit AES & stored securely in database',
      hasCustomRazorpay: !!(updated.razorpayKeyId && updated.razorpayKeySecret),
    });
  } catch (error) {
    console.error('Update Razorpay error:', error);
    return res.status(500).json({ success: false, error: 'Failed to update Razorpay credentials' });
  }
}

async function regenerateKeys(req, res) {
  try {
    const tenant = req.tenant;
    const apiKey = generateApiKey();
    const agentToken = generateAgentToken();

    const updated = await prisma.tenant.update({
      where: { id: tenant.id },
      data: { apiKey, agentToken },
    });

    return res.json({
      success: true,
      message: 'Credentials rotated successfully',
      apiKey: updated.apiKey,
      agentToken: updated.agentToken,
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Failed to rotate keys' });
  }
}

async function getJobsHistory(req, res) {
  try {
    const tenant = req.tenant;
    const limit = parseInt(req.query.limit) || 20;

    const jobs = await prisma.printJob.findMany({
      where: { tenantId: tenant.id },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        payment: { select: { status: true, amount: true } },
      },
    });

    return res.json({ success: true, jobs });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Failed to fetch jobs' });
  }
}

async function getQrCode(req, res) {
  try {
    const tenant = req.tenant;
    const format = req.query.format || 'png';
    const websiteUrl = `${FRONTEND_URL}/cafe/${tenant.slug}`;

    if (format === 'svg') {
      const svg = await generateQRCodeSVG(websiteUrl);
      res.setHeader('Content-Type', 'image/svg+xml');
      return res.send(svg);
    }

    const dataUrl = await generateQRCodeDataURL(websiteUrl);
    return res.json({ success: true, qrCodeUrl: dataUrl, websiteUrl });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Failed to generate QR code' });
  }
}

async function downloadPreconfiguredAgent(req, res) {
  try {
    const tenant = req.tenant;
    const agentDir = path.join(__dirname, '../../../print-agent');
    const exePath = path.join(agentDir, 'dist', 'AutoPrintAgent.exe');

    if (!fs.existsSync(exePath)) {
      return res.status(404).json({
        success: false,
        error: 'Agent build not ready. Please download the standalone script.',
      });
    }

    res.setHeader('Content-Disposition', `attachment; filename=WevePrint-Agent-${tenant.slug}.exe`);
    res.setHeader('Content-Type', 'application/vnd.microsoft.portable-executable');
    return res.sendFile(exePath);
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Download failed' });
  }
}

async function updateSelectedPrinter(req, res) {
  try {
    const tenant = req.tenant;
    const { selectedPrinter, bwPrinter, colorPrinter, deviceId } = req.body;

    if (!selectedPrinter && !bwPrinter && !colorPrinter) {
      return res.status(400).json({ success: false, error: 'Printer name is required' });
    }

    let targetDevice;
    if (deviceId) {
      targetDevice = await prisma.device.findFirst({
        where: { id: deviceId, tenantId: tenant.id },
      });
    } else {
      targetDevice = await prisma.device.findFirst({
        where: { tenantId: tenant.id },
        orderBy: { lastSeenAt: 'desc' },
      });
    }

    if (!targetDevice) {
      targetDevice = await prisma.device.create({
        data: {
          tenantId: tenant.id,
          name: 'Primary Counter PC',
          isOnline: true,
          selectedPrinter: selectedPrinter || bwPrinter || 'Default System Printer',
          bwPrinter: bwPrinter || selectedPrinter || 'Default System Printer',
          colorPrinter: colorPrinter || selectedPrinter || 'Default System Printer',
          lastSeenAt: new Date(),
        },
      });
    } else {
      const updateData = {};
      if (selectedPrinter) updateData.selectedPrinter = selectedPrinter;
      if (bwPrinter) updateData.bwPrinter = bwPrinter;
      if (colorPrinter) updateData.colorPrinter = colorPrinter;

      targetDevice = await prisma.device.update({
        where: { id: targetDevice.id },
        data: updateData,
      });
    }

    return res.json({
      success: true,
      message: 'Printer routing configuration updated successfully',
      device: targetDevice,
    });
  } catch (error) {
    console.error('Error updating printer:', error);
    return res.status(500).json({ success: false, error: 'Failed to update printer setting' });
  }
}

module.exports = {
  getDashboardData,
  updatePricing,
  updateRazorpayCredentials,
  regenerateKeys,
  getJobsHistory,
  getQrCode,
  downloadPreconfiguredAgent,
  updateSelectedPrinter,
};
