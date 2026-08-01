const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const prisma = require('../config/db');

function startCleanupWorker() {
  console.log('[Cleanup] Initializing 10-minute PDF TTL auto-purge worker...');

  // Run every 2 minutes
  cron.schedule('*/2 * * * *', async () => {
    try {
      const now = new Date();
      
      // Find jobs expired (older than 10 minutes from creation) and not completed
      const expiredJobs = await prisma.printJob.findMany({
        where: {
          expiresAt: { lt: now },
          jobStatus: { notIn: ['COMPLETED', 'EXPIRED'] },
        },
      });

      if (expiredJobs.length > 0) {
        console.log(`[Cleanup] Found ${expiredJobs.length} expired PDF jobs (>10 min TTL). Purging...`);

        for (const job of expiredJobs) {
          // Delete physical file
          if (job.pdfPath && fs.existsSync(job.pdfPath)) {
            fs.unlink(job.pdfPath, (err) => {
              if (err) console.error(`[Cleanup] Failed to delete file ${job.pdfPath}:`, err.message);
              else console.log(`[Cleanup] Deleted expired file: ${job.pdfPath}`);
            });
          }

          // Update job status to EXPIRED
          await prisma.printJob.update({
            where: { id: job.id },
            data: { jobStatus: 'EXPIRED', errorMessage: 'Purged automatically after 10 minutes TTL expiration' },
          });
        }
      }

      // Check offline devices (lastSeenAt older than 2 minutes)
      const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
      await prisma.device.updateMany({
        where: {
          isOnline: true,
          lastSeenAt: { lt: twoMinutesAgo },
        },
        data: { isOnline: false },
      });

    } catch (error) {
      console.error('[Cleanup Worker Error]:', error.message);
    }
  });
}

module.exports = {
  startCleanupWorker,
};
