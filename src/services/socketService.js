const { Server } = require('socket.io');
const prisma = require('../config/db');

let ioInstance = null;
const connectedAgents = new Map(); // tenantId -> Map(deviceId -> socketId)

function initSocketServer(server) {
  ioInstance = new Server(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
    maxHttpBufferSize: 50 * 1024 * 1024, // 50MB for in-memory PDF buffers
    pingInterval: 10000,
    pingTimeout: 5000,
  });

  ioInstance.use(async (socket, next) => {
    try {
      const { agentToken, deviceId, hardwareHash } = socket.handshake.query;

      if (!agentToken) {
        return next(new Error('Authentication error: agentToken required'));
      }

      const tenant = await prisma.tenant.findUnique({
        where: { agentToken },
      });

      if (!tenant || tenant.status !== 'ACTIVE') {
        return next(new Error('Authentication error: Invalid or inactive tenant'));
      }

      socket.tenant = tenant;
      socket.deviceId = deviceId || `device_${Date.now()}`;
      socket.hardwareHash = hardwareHash || 'legacy_device';

      next();
    } catch (err) {
      next(new Error('Socket authentication failed: ' + err.message));
    }
  });

  ioInstance.on('connection', async (socket) => {
    const tenantId = socket.tenant.id;
    const deviceId = socket.deviceId;

    console.log(`[Socket] Print Agent connected: Tenant ${tenantId} (${socket.tenant.name}), Device ${deviceId}`);

    socket.join(`tenant:${tenantId}`);
    socket.join(`device:${deviceId}`);

    if (!connectedAgents.has(tenantId)) {
      connectedAgents.set(tenantId, new Map());
    }
    connectedAgents.get(tenantId).set(deviceId, socket.id);

    try {
      await prisma.device.upsert({
        where: { deviceId },
        update: {
          isOnline: true,
          lastSeenAt: new Date(),
          hardwareHash: socket.hardwareHash,
        },
        create: {
          tenantId,
          deviceId,
          hardwareHash: socket.hardwareHash,
          deviceName: `Windows Laptop (${deviceId.substring(0, 8)})`,
          isOnline: true,
          lastSeenAt: new Date(),
        },
      });
    } catch (err) {
      console.warn('[Socket] Device upsert warning:', err.message);
    }

    socket.on('agent:printers', async (data) => {
      try {
        const { printers, selectedPrinter } = data;
        await prisma.device.update({
          where: { deviceId },
          data: {
            availablePrinters: printers || [],
            selectedPrinter: selectedPrinter || null,
            lastSeenAt: new Date(),
          },
        });
        ioInstance.to(`tenant:${tenantId}`).emit('cafe:device_updated', {
          deviceId,
          printers,
          selectedPrinter,
          isOnline: true,
        });
      } catch (err) {
        console.error('[Socket] Failed to save printer list:', err.message);
      }
    });

    socket.on('agent:heartbeat', async () => {
      try {
        await prisma.device.update({
          where: { deviceId },
          data: { isOnline: true, lastSeenAt: new Date() },
        });
      } catch (err) {
        // silent
      }
    });

    socket.on('job:status_update', async (data) => {
      try {
        const { jobId, status, errorMessage, printerName } = data;
        const job = await prisma.printJob.update({
          where: { id: jobId },
          data: {
            jobStatus: status,
            errorMessage: errorMessage || null,
            printerName: printerName || undefined,
            printedAt: status === 'COMPLETED' ? new Date() : undefined,
          },
        });

        // Notify customer web page & cafe dashboard
        ioInstance.to(`job:${jobId}`).emit('job:status_changed', { jobId, status, errorMessage });
        ioInstance.to(`tenant:${tenantId}`).emit('cafe:job_updated', job);

        // Wipe RAM memory immediately after print completion
        if (status === 'COMPLETED' && job.pdfFileName) {
          const publicCtrl = require('../controllers/publicController');
          publicCtrl.clearMemoryPdfBuffer(job.pdfFileName);
        }
      } catch (err) {
        console.error('[Socket] Error updating job status:', err.message);
      }
    });

    socket.on('disconnect', async () => {
      console.log(`[Socket] Print Agent disconnected: Tenant ${tenantId}, Device ${deviceId}`);
      if (connectedAgents.has(tenantId)) {
        connectedAgents.get(tenantId).delete(deviceId);
      }
      try {
        await prisma.device.update({
          where: { deviceId },
          data: { isOnline: false, lastSeenAt: new Date() },
        });
        ioInstance.to(`tenant:${tenantId}`).emit('cafe:device_updated', {
          deviceId,
          isOnline: false,
        });
      } catch (err) {
        // silent
      }
    });
  });

  return ioInstance;
}

function getIO() {
  return ioInstance;
}

function dispatchJobToAgent(tenantId, job, pdfBuffer = null) {
  if (!ioInstance) return false;

  console.log(`[Zero-Storage Socket] Dispatching in-memory print job ${job.id} to Tenant ${tenantId}`);

  const baseUrl = process.env.BASE_SERVER_URL || 'http://localhost:5000';

  ioInstance.to(`tenant:${tenantId}`).emit('job:new_print', {
    jobId: job.id,
    customerName: job.customerName,
    downloadUrl: `${baseUrl}/api/v1/public/files/${job.pdfFileName}`,
    pdfBase64: pdfBuffer ? pdfBuffer.toString('base64') : null,
    pagesToPrint: job.pagesToPrint,
    copies: job.copies,
    colorMode: job.colorMode,
    totalPages: job.totalPages,
    printerName: job.printerName,
  });
  return true;
}

module.exports = {
  initSocketServer,
  getIO,
  dispatchJobToAgent,
};
