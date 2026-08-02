const pdfParse = require('pdf-parse');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const prisma = require('../config/db');
const { dispatchJobToAgent } = require('../services/socketService');

// Ephemeral RAM Storage for zero-disk PDF streaming
// Map(fileId -> { buffer, originalName, totalPages, expiresAt })
const pdfMemoryMap = new Map();

function getMemoryPdfBuffer(fileId) {
  return pdfMemoryMap.get(fileId);
}

function clearMemoryPdfBuffer(fileId) {
  if (pdfMemoryMap.has(fileId)) {
    pdfMemoryMap.delete(fileId);
    console.log(`[Zero-Storage Privacy] PDF buffer #${fileId} wiped permanently from RAM memory.`);
  }
}

// Calculate actual pages count from range expression like "1-3,5,8-10"
function parsePageRange(rangeStr, maxPages) {
  if (!rangeStr || rangeStr.toUpperCase() === 'ALL') {
    return maxPages;
  }

  const pages = new Set();
  const parts = rangeStr.split(',');

  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.includes('-')) {
      const [startStr, endStr] = trimmed.split('-');
      const start = parseInt(startStr, 10);
      const end = parseInt(endStr, 10);
      if (!isNaN(start) && !isNaN(end)) {
        for (let i = Math.max(1, start); i <= Math.min(maxPages, end); i++) {
          pages.add(i);
        }
      }
    } else {
      const pageNum = parseInt(trimmed, 10);
      if (!isNaN(pageNum) && pageNum >= 1 && pageNum <= maxPages) {
        pages.add(pageNum);
      }
    }
  }

  return pages.size > 0 ? pages.size : maxPages;
}

async function getCafePublicInfo(req, res) {
  try {
    const tenant = req.tenant;
    if (!tenant) {
      return res.status(404).json({ success: false, error: 'Cyber Cafe not found' });
    }

    return res.json({
      success: true,
      cafe: {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        bwPricePerPage: tenant.bwPricePerPage,
        colorPricePerPage: tenant.colorPricePerPage,
        razorpayKeyId: tenant.razorpayKeyId || '',
        hasPaymentConfigured: !!(tenant.razorpayKeyId && tenant.razorpayKeySecret),
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Failed to fetch cafe info' });
  }
}

async function uploadPdfInMemory(req, res) {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ success: false, error: 'No PDF file uploaded' });
    }

    const fileBuffer = req.file.buffer;

    let totalPages = 1;
    try {
      const pdfData = await pdfParse(fileBuffer);
      totalPages = pdfData.numpages || 1;
    } catch (parseErr) {
      console.warn('PDF page count parse warning, fallback to 1 page:', parseErr.message);
    }

    const fileId = 'ram_' + Date.now() + '_' + crypto.randomBytes(6).toString('hex');

    // Store strictly in RAM memory with 10-minute auto-purge timer
    pdfMemoryMap.set(fileId, {
      buffer: fileBuffer,
      originalName: req.file.originalname,
      totalPages,
      expiresAt: Date.now() + 10 * 60 * 1000,
    });

    setTimeout(() => clearMemoryPdfBuffer(fileId), 10 * 60 * 1000);

    console.log(`[Zero-Storage Privacy] Uploaded PDF #${fileId} held in RAM memory. Zero files written to disk.`);

    return res.json({
      success: true,
      file: {
        originalName: req.file.originalname,
        fileName: fileId,
        size: req.file.size,
        totalPages,
      },
    });
  } catch (error) {
    console.error('In-memory upload error:', error);
    return res.status(500).json({ success: false, error: 'PDF upload failed', details: error.message });
  }
}

async function createOrder(req, res) {
  try {
    const tenant = req.tenant;
    if (!tenant) {
      return res.status(404).json({ success: false, error: 'Cyber Cafe not found' });
    }

    const {
      customerName,
      customerPhone,
      fileName,
      originalName,
      totalPages,
      pagesToPrint,
      copies,
      colorMode,
    } = req.body;

    if (!fileName || !totalPages) {
      return res.status(400).json({ success: false, error: 'File details missing' });
    }

    // Require per-tenant Razorpay Credentials
    if (!tenant.razorpayKeyId || !tenant.razorpayKeySecret) {
      return res.status(400).json({
        success: false,
        error: 'This Cyber Cafe has not configured their Razorpay payment gateway yet. Please contact the cafe owner.',
      });
    }

    const maxPages = parseInt(totalPages, 10);
    const selectedPagesCount = parsePageRange(pagesToPrint, maxPages);
    const numCopies = parseInt(copies || 1, 10);
    const isColor = colorMode === 'COLOR';

    // Calculate strictly using THIS CAFE's pricing
    const pricePerPage = isColor ? tenant.colorPricePerPage : tenant.bwPricePerPage;
    const totalPrice = selectedPagesCount * numCopies * pricePerPage;

    if (isNaN(totalPrice) || totalPrice <= 0) {
      return res.status(400).json({ success: false, error: 'Invalid print price calculation' });
    }

    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    // Create PrintJob in DB with PENDING status (NO PRINTING BEFORE PAYMENT)
    const printJob = await prisma.printJob.create({
      data: {
        tenantId: tenant.id,
        customerName: customerName || 'Guest Customer',
        customerPhone: customerPhone || null,
        originalName: originalName || 'Document.pdf',
        pdfFileName: fileName,
        pdfPath: `ram://${fileName}`,
        totalPages: maxPages,
        pagesToPrint: pagesToPrint || 'ALL',
        copies: numCopies,
        colorMode: isColor ? 'COLOR' : 'BW',
        totalPrice,
        paymentStatus: 'PENDING',
        jobStatus: 'PENDING',
        expiresAt,
      },
    });

    // Instantiate Razorpay strictly using THIS CAFE's key & secret
    const cafeRazorpay = new Razorpay({
      key_id: tenant.razorpayKeyId,
      key_secret: tenant.razorpayKeySecret,
    });

    const options = {
      amount: Math.round(totalPrice * 100), // Amount in paise
      currency: 'INR',
      receipt: `job_${printJob.id.substring(0, 10)}`,
      notes: {
        cafeId: tenant.id,
        cafeSlug: tenant.slug,
        jobId: printJob.id,
      },
    };

    const razorpayOrder = await cafeRazorpay.orders.create(options);

    await prisma.payment.create({
      data: {
        tenantId: tenant.id,
        printJobId: printJob.id,
        amount: totalPrice,
        currency: 'INR',
        status: 'PENDING',
        razorpayOrderId: razorpayOrder.id,
      },
    });

    return res.json({
      success: true,
      order: {
        jobId: printJob.id,
        razorpayOrderId: razorpayOrder.id,
        amount: totalPrice,
        currency: 'INR',
        keyId: tenant.razorpayKeyId,
        cafeName: tenant.name,
        calculatedPages: selectedPagesCount,
        copies: numCopies,
        colorMode: isColor ? 'COLOR' : 'BW',
      },
    });
  } catch (error) {
    console.error('Create order error:', error);
    return res.status(500).json({ success: false, error: 'Failed to create payment order', details: error.message });
  }
}

async function verifyPayment(req, res) {
  try {
    const { jobId, razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body;

    if (!jobId || !razorpayPaymentId || !razorpaySignature) {
      return res.status(400).json({ success: false, error: 'Missing required payment verification parameters' });
    }

    const job = await prisma.printJob.findUnique({
      where: { id: jobId },
      include: { tenant: true },
    });

    if (!job) {
      return res.status(404).json({ success: false, error: 'Print job not found' });
    }

    const tenant = job.tenant;
    if (!tenant || !tenant.razorpayKeySecret) {
      return res.status(400).json({ success: false, error: 'Cafe payment credentials unavailable for verification' });
    }

    const paymentRecord = await prisma.payment.findUnique({
      where: { printJobId: jobId },
    });

    const orderIdToVerify = razorpayOrderId || (paymentRecord ? paymentRecord.razorpayOrderId : null);

    if (!orderIdToVerify) {
      return res.status(400).json({ success: false, error: 'Razorpay Order ID missing for verification' });
    }

    // Strictly verify Razorpay HMAC SHA256 Signature
    const bodyToSign = `${orderIdToVerify}|${razorpayPaymentId}`;
    const expectedSignature = crypto
      .createHmac('sha256', tenant.razorpayKeySecret)
      .update(bodyToSign)
      .digest('hex');

    if (expectedSignature !== razorpaySignature) {
      console.warn(`[Security Alert] Payment signature mismatch for Job #${jobId}! Expected: ${expectedSignature}, Received: ${razorpaySignature}`);

      // Mark payment & job as FAILED
      await prisma.printJob.update({
        where: { id: jobId },
        data: { paymentStatus: 'FAILED', jobStatus: 'CANCELLED', errorMessage: 'Payment signature verification failed' },
      });
      await prisma.payment.updateMany({
        where: { printJobId: jobId },
        data: { status: 'FAILED', razorpayPaymentId, razorpaySignature },
      });

      return res.status(400).json({ success: false, error: 'Payment signature verification failed' });
    }

    // Signature matches -> Update job status to SUCCESS and SENT_TO_AGENT
    const updatedJob = await prisma.printJob.update({
      where: { id: jobId },
      data: {
        paymentStatus: 'SUCCESS',
        jobStatus: 'SENT_TO_AGENT',
      },
    });

    await prisma.payment.updateMany({
      where: { printJobId: jobId },
      data: {
        status: 'SUCCESS',
        razorpayPaymentId,
        razorpaySignature,
      },
    });

    // Retrieve PDF buffer from RAM
    const memoryRecord = getMemoryPdfBuffer(updatedJob.pdfFileName);
    const pdfBuffer = memoryRecord ? memoryRecord.buffer : null;

    // Dispatch ONLY after successful payment verification!
    const dispatched = dispatchJobToAgent(updatedJob.tenantId, updatedJob, pdfBuffer);

    console.log(`[Payment Verified] Signature valid! Job #${jobId} confirmed & dispatched to PrintAgent.exe`);

    return res.json({
      success: true,
      message: 'Payment verified successfully! Print job dispatched.',
      job: {
        id: updatedJob.id,
        status: updatedJob.jobStatus,
        dispatched,
      },
    });
  } catch (error) {
    console.error('Payment verify error:', error);
    return res.status(500).json({ success: false, error: 'Payment verification error', details: error.message });
  }
}

async function serveMemoryPdfFile(req, res) {
  try {
    const { fileId } = req.params;
    const memoryRecord = getMemoryPdfBuffer(fileId);

    if (!memoryRecord || !memoryRecord.buffer) {
      return res.status(404).json({ success: false, error: 'PDF file not found or expired from memory' });
    }

    res.contentType('application/pdf');
    res.send(memoryRecord.buffer);

    clearMemoryPdfBuffer(fileId);
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Memory PDF stream error' });
  }
}

module.exports = {
  getCafePublicInfo,
  uploadPdfInMemory,
  createOrder,
  verifyPayment,
  serveMemoryPdfFile,
  getMemoryPdfBuffer,
  clearMemoryPdfBuffer,
};
