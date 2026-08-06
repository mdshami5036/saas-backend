const prisma = require('../config/db');
const { generateApiKey, generateAgentToken } = require('../utils/tokenGenerator');
const { generateQRCodeDataURL, generateQRCodeSVG } = require('../utils/qrGenerator');
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

    const sixtySecondsAgo = new Date(Date.now() - 60 * 1000);
    const isAgentOnline = devices.some((d) => d.isOnline && d.lastSeenAt && new Date(d.lastSeenAt) > sixtySecondsAgo);

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
        slug: tenant.slug,
        websiteUrl: `${FRONTEND_URL}/cafe/${tenant.slug}`,
        backendApiUrl: `${BASE_SERVER_URL}/api/v1`,
        apiKey: tenant.apiKey,
        agentToken: tenant.agentToken,
        bwPricePerPage: tenant.bwPricePerPage,
        colorPricePerPage: tenant.colorPricePerPage,
        qrCodeUrl: tenant.qrCodeUrl,
        razorpayKeyId: tenant.razorpayKeyId || '',
        hasCustomRazorpay: !!(tenant.razorpayKeyId && tenant.razorpayKeySecret),
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
    const { bwPricePerPage, colorPricePerPage } = req.body;

    const updated = await prisma.tenant.update({
      where: { id: tenant.id },
      data: {
        bwPricePerPage: bwPricePerPage ? parseFloat(bwPricePerPage) : tenant.bwPricePerPage,
        colorPricePerPage: colorPricePerPage ? parseFloat(colorPricePerPage) : tenant.colorPricePerPage,
      },
    });

    return res.json({
      success: true,
      message: 'Pricing updated successfully',
      pricing: {
        bwPricePerPage: updated.bwPricePerPage,
        colorPricePerPage: updated.colorPricePerPage,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Failed to update pricing' });
  }
}

async function updateRazorpayCredentials(req, res) {
  try {
    const tenant = req.tenant;
    const { razorpayKeyId, razorpayKeySecret } = req.body;

    const dataToUpdate = {};

    if (razorpayKeyId !== undefined && razorpayKeyId !== null) {
      dataToUpdate.razorpayKeyId = razorpayKeyId.trim() || null;
    }

    if (razorpayKeySecret !== undefined && razorpayKeySecret !== null && razorpayKeySecret.trim().length > 0) {
      dataToUpdate.razorpayKeySecret = razorpayKeySecret.trim();
    }

    const updated = await prisma.tenant.update({
      where: { id: tenant.id },
      data: dataToUpdate,
    });

    console.log(`[Razorpay Credentials] Successfully saved for Tenant ${updated.name} (${updated.id}): KeyID=${updated.razorpayKeyId}`);

    return res.json({
      success: true,
      message: 'Custom Razorpay Merchant Account connected successfully!',
      razorpay: {
        razorpayKeyId: updated.razorpayKeyId || '',
        hasCustomRazorpay: !!(updated.razorpayKeyId && updated.razorpayKeySecret),
      },
    });
  } catch (error) {
    console.error('Update Razorpay Error:', error);
    return res.status(500).json({ success: false, error: 'Failed to update Razorpay credentials', details: error.message });
  }
}

async function regenerateKeys(req, res) {
  try {
    const tenant = req.tenant;
    const { target } = req.body;

    let dataToUpdate = {};
    if (target === 'API_KEY') {
      dataToUpdate.apiKey = generateApiKey();
    } else if (target === 'AGENT_TOKEN') {
      dataToUpdate.agentToken = generateAgentToken();
    } else {
      dataToUpdate.apiKey = generateApiKey();
      dataToUpdate.agentToken = generateAgentToken();
    }

    const updated = await prisma.tenant.update({
      where: { id: tenant.id },
      data: dataToUpdate,
    });

    return res.json({
      success: true,
      message: 'Credentials regenerated successfully',
      credentials: {
        apiKey: updated.apiKey,
        agentToken: updated.agentToken,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Failed to regenerate credentials' });
  }
}

async function getJobsHistory(req, res) {
  try {
    const tenant = req.tenant;
    const { page = 1, limit = 20, status } = req.query;

    const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    const where = { tenantId: tenant.id };

    if (status) {
      where.jobStatus = status;
    }

    const [jobs, total] = await Promise.all([
      prisma.printJob.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: parseInt(limit, 10),
        include: { payment: true },
      }),
      prisma.printJob.count({ where }),
    ]);

    return res.json({
      success: true,
      jobs,
      pagination: {
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        total,
        totalPages: Math.ceil(total / parseInt(limit, 10)),
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Failed to fetch print jobs history' });
  }
}

async function getQrCode(req, res) {
  try {
    const tenant = req.tenant;
    const websiteUrl = `${FRONTEND_URL}/cafe/${tenant.slug}`;
    const format = req.query.format || 'png';

    if (format === 'svg') {
      const svgString = await generateQRCodeSVG(websiteUrl);
      res.setHeader('Content-Type', 'image/svg+xml');
      return res.send(svgString);
    }

    const dataUrl = await generateQRCodeDataURL(websiteUrl);
    return res.json({ success: true, qrCodeUrl: dataUrl, websiteUrl });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Failed to generate QR Code' });
  }
}

async function downloadPreconfiguredAgent(req, res) {
  try {
    const agentExePath = path.join(__dirname, '../../../print-agent/dist/PrintAgent.exe');

    if (fs.existsSync(agentExePath)) {
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', 'attachment; filename="PrintAgent.exe"');
      return res.sendFile(path.resolve(agentExePath));
    }

    // Direct download URL link response
    return res.json({
      success: true,
      downloadUrl: `https://github.com/mdshami5036/saas/releases/download/v1.0.0/PrintAgent.exe`,
      filename: 'PrintAgent.exe',
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Agent download failed' });
  }
}

async function updateSelectedPrinter(req, res) {
  try {
    const tenant = req.tenant;
    const { selectedPrinter, deviceId } = req.body;

    if (!selectedPrinter) {
      return res.status(400).json({ success: false, error: 'Printer name required' });
    }

    const device = await prisma.device.findFirst({
      where: deviceId ? { id: deviceId, tenantId: tenant.id } : { tenantId: tenant.id },
      orderBy: { lastSeenAt: 'desc' },
    });

    if (!device) {
      return res.status(404).json({ success: false, error: 'No connected printer device found' });
    }

    const updatedDevice = await prisma.device.update({
      where: { id: device.id },
      data: { selectedPrinter },
    });

    return res.json({
      success: true,
      message: `Default printer updated to ${selectedPrinter}`,
      selectedPrinter: updatedDevice.selectedPrinter,
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Failed to update printer settings' });
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
