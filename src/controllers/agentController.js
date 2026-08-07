const prisma = require('../config/db');
const path = require('path');
const fs = require('fs');

async function registerDevice(req, res) {
  try {
    const tenant = req.tenant;
    const { deviceId, hardwareHash, deviceName, selectedPrinter, availablePrinters } = req.body;

    if (!hardwareHash) {
      return res.status(400).json({ success: false, error: 'Hardware fingerprint required' });
    }

    // 1. INSTANT TOKEN SWITCH FIX: Immediately set previous tenant accounts on this laptop to OFFLINE
    const pastCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await prisma.device.updateMany({
      where: {
        OR: [
          { hardwareHash: hardwareHash },
          { deviceId: deviceId || 'never_match' },
        ],
        NOT: { tenantId: tenant.id },
      },
      data: {
        isOnline: false,
        lastSeenAt: pastCutoff,
      },
    }).catch(() => {});

    const boundDeviceId = deviceId || `dev_${Date.now()}`;

    const printersJson = Array.isArray(availablePrinters)
      ? JSON.stringify(availablePrinters)
      : typeof availablePrinters === 'string' ? availablePrinters : null;

    const device = await prisma.device.upsert({
      where: { deviceId: boundDeviceId },
      update: {
        tenantId: tenant.id,
        isOnline: true,
        lastSeenAt: new Date(),
        selectedPrinter: selectedPrinter || null,
        availablePrinters: printersJson,
      },
      create: {
        tenantId: tenant.id,
        deviceId: boundDeviceId,
        hardwareHash,
        deviceName: deviceName || 'Windows Agent Laptop',
        selectedPrinter: selectedPrinter || null,
        availablePrinters: printersJson,
        isOnline: true,
      },
    });

    return res.json({
      success: true,
      message: `Connected successfully to ${tenant.name}!`,
      cafeName: tenant.name,
      deviceId: device.deviceId,
      selectedPrinter: device.selectedPrinter,
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Device registration failed', details: error.message });
  }
}

async function pollJobs(req, res) {
  try {
    const tenant = req.tenant;

    // Refresh device lastSeenAt timestamp on active polling heartbeat
    prisma.device.updateMany({
      where: { tenantId: tenant.id },
      data: { isOnline: true, lastSeenAt: new Date() },
    }).catch(() => {});

    // Find pending jobs waiting for dispatch (STRICT: paymentStatus = SUCCESS)
    const pendingJob = await prisma.printJob.findFirst({
      where: {
        tenantId: tenant.id,
        paymentStatus: 'SUCCESS',
        jobStatus: 'SENT_TO_AGENT',
      },
      orderBy: { createdAt: 'asc' },
    });

    if (!pendingJob) {
      return res.json({ success: true, hasJob: false, job: null });
    }

    const host = req.get('host');
    const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
    let baseUrl = `${protocol}://${host}`;
    if (process.env.BASE_SERVER_URL && !process.env.BASE_SERVER_URL.includes('localhost')) {
      baseUrl = process.env.BASE_SERVER_URL;
    }

    const activeDevice = await prisma.device.findFirst({
      where: { tenantId: tenant.id, isOnline: true },
      select: { selectedPrinter: true },
    }).catch(() => null);

    const targetPrinter = pendingJob.printerName || (activeDevice ? activeDevice.selectedPrinter : null);

    return res.json({
      success: true,
      hasJob: true,
      job: {
        jobId: pendingJob.id,
        customerName: pendingJob.customerName,
        originalName: pendingJob.originalName,
        downloadUrl: `${baseUrl}/api/v1/agent/jobs/${pendingJob.id}/file`,
        pagesToPrint: pendingJob.pagesToPrint,
        copies: pendingJob.copies,
        colorMode: pendingJob.colorMode,
        totalPages: pendingJob.totalPages,
        printerName: targetPrinter,
        paymentStatus: pendingJob.paymentStatus,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Polling failed' });
  }
}

async function downloadJobFile(req, res) {
  try {
    const tenant = req.tenant;
    const { id } = req.params;

    const job = await prisma.printJob.findFirst({
      where: { id, tenantId: tenant.id, paymentStatus: 'SUCCESS' },
    });

    if (!job) {
      return res.status(404).json({ success: false, error: 'Paid print job not found' });
    }

    // Check zero-storage RAM memory buffer first
    const publicCtrl = require('./publicController');
    const memoryRecord = publicCtrl.getMemoryPdfBuffer(job.pdfFileName);

    if (memoryRecord && memoryRecord.buffer) {
      res.contentType('application/pdf');
      return res.send(memoryRecord.buffer);
    }

    // Disk fallback if pdfPath exists
    if (job.pdfPath && fs.existsSync(job.pdfPath)) {
      res.contentType('application/pdf');
      return res.sendFile(path.resolve(job.pdfPath));
    }

    // If PDF file is missing (stale job from old server build), mark job COMPLETED to clear queue cleanly
    await prisma.printJob.update({
      where: { id: job.id },
      data: { jobStatus: 'COMPLETED', printedAt: new Date(), errorMessage: 'Cleared stale pre-deploy test job' }
    }).catch(() => {});

    return res.status(404).json({ success: false, error: 'PDF file expired or unavailable' });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'File download error' });
  }
}

async function updateJobStatusHttp(req, res) {
  try {
    const tenant = req.tenant;
    const { id } = req.params;
    const { status, errorMessage, printerName } = req.body;

    const job = await prisma.printJob.findFirst({
      where: { id, tenantId: tenant.id },
    });

    if (!job) {
      return res.status(404).json({ success: false, error: 'Job not found' });
    }

    const updated = await prisma.printJob.update({
      where: { id },
      data: {
        jobStatus: status,
        errorMessage: errorMessage || null,
        printerName: printerName || undefined,
        printedAt: status === 'COMPLETED' ? new Date() : undefined,
      },
    });

    // Delete PDF file and clear RAM memory buffer post-print completion
    if (status === 'COMPLETED') {
      const publicCtrl = require('./publicController');
      if (job.pdfFileName) {
        publicCtrl.clearMemoryPdfBuffer(job.pdfFileName);
      }
      if (job.pdfPath && fs.existsSync(job.pdfPath)) {
        fs.unlink(job.pdfPath, (err) => {
          if (err) console.warn('[Cleanup] Delete file post-print failed:', err.message);
        });
      }
    }

    return res.json({ success: true, job: updated });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Status update failed' });
  }
}

async function checkVersion(req, res) {
  const host = req.get('host');
  const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
  let baseUrl = `${protocol}://${host}`;
  if (process.env.BASE_SERVER_URL && !process.env.BASE_SERVER_URL.includes('localhost')) {
    baseUrl = process.env.BASE_SERVER_URL;
  }

  return res.json({
    success: true,
    version: '1.0.0',
    minVersion: '1.0.0',
    downloadUrl: `${baseUrl}/downloads/PrintAgent.exe`,
    mandatory: false,
  });
}

async function disconnectDevice(req, res) {
  try {
    const tenant = req.tenant;
    const pastCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

    await prisma.device.updateMany({
      where: { tenantId: tenant.id },
      data: { isOnline: false, lastSeenAt: pastCutoff },
    });

    return res.json({ success: true, message: 'Agent disconnected instantly' });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Disconnect failed' });
  }
}

module.exports = {
  registerDevice,
  pollJobs,
  downloadJobFile,
  updateJobStatusHttp,
  checkVersion,
  disconnectDevice,
};
