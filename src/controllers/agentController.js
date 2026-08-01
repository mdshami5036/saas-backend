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

    const boundDeviceId = deviceId || `dev_${Date.now()}`;

    const device = await prisma.device.upsert({
      where: { deviceId: boundDeviceId },
      update: {
        isOnline: true,
        lastSeenAt: new Date(),
        selectedPrinter: selectedPrinter || undefined,
        availablePrinters: availablePrinters || undefined,
      },
      create: {
        tenantId: tenant.id,
        deviceId: boundDeviceId,
        hardwareHash,
        deviceName: deviceName || 'Windows Agent Laptop',
        selectedPrinter: selectedPrinter || null,
        availablePrinters: availablePrinters || [],
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

    // Find pending jobs waiting for dispatch
    const pendingJob = await prisma.printJob.findFirst({
      where: {
        tenantId: tenant.id,
        jobStatus: 'SENT_TO_AGENT',
      },
      orderBy: { createdAt: 'asc' },
    });

    if (!pendingJob) {
      return res.json({ success: true, hasJob: false, job: null });
    }

    const baseUrl = process.env.BASE_SERVER_URL || 'http://localhost:5000';

    return res.json({
      success: true,
      hasJob: true,
      job: {
        jobId: pendingJob.id,
        customerName: pendingJob.customerName,
        downloadUrl: `${baseUrl}/api/v1/agent/jobs/${pendingJob.id}/file`,
        pagesToPrint: pendingJob.pagesToPrint,
        copies: pendingJob.copies,
        colorMode: pendingJob.colorMode,
        totalPages: pendingJob.totalPages,
        printerName: pendingJob.printerName,
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
      where: { id, tenantId: tenant.id },
    });

    if (!job || !job.pdfPath) {
      return res.status(404).json({ success: false, error: 'Print job PDF not found' });
    }

    if (!fs.existsSync(job.pdfPath)) {
      return res.status(410).json({ success: false, error: 'PDF file has expired or was already deleted' });
    }

    res.contentType('application/pdf');
    return res.sendFile(path.resolve(job.pdfPath));
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

    // Delete PDF file post-print completion
    if (status === 'COMPLETED' && job.pdfPath && fs.existsSync(job.pdfPath)) {
      fs.unlink(job.pdfPath, (err) => {
        if (err) console.warn('[Cleanup] Delete file post-print failed:', err.message);
      });
    }

    return res.json({ success: true, job: updated });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Status update failed' });
  }
}

async function checkVersion(req, res) {
  return res.json({
    success: true,
    version: '1.0.0',
    minVersion: '1.0.0',
    downloadUrl: `${process.env.BASE_SERVER_URL || 'http://localhost:5000'}/downloads/PrintAgent.exe`,
    mandatory: false,
  });
}

module.exports = {
  registerDevice,
  pollJobs,
  downloadJobFile,
  updateJobStatusHttp,
  checkVersion,
};
