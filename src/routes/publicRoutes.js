const express = require('express');
const router = express.Router();
const multer = require('multer');
const { resolveTenantBySlug } = require('../middleware/tenantMiddleware');
const { publicApiLimiter, uploadLimiter } = require('../middleware/rateLimiter');
const {
  getCafePublicInfo,
  uploadPdfInMemory,
  createOrder,
  verifyPayment,
  serveMemoryPdfFile,
} = require('../controllers/publicController');

// Multer configured strictly for IN-MEMORY STORAGE (Zero Disk Storage)
const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf' || file.originalname.toLowerCase().endsWith('.pdf')) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed!'), false);
    }
  },
});

router.use(publicApiLimiter);

router.get('/cafe/:slug/info', resolveTenantBySlug, getCafePublicInfo);
router.post('/upload', uploadLimiter, upload.single('pdf'), uploadPdfInMemory);
router.post('/create-order', resolveTenantBySlug, createOrder);
router.post('/verify-payment', verifyPayment);
router.get('/files/:fileId', serveMemoryPdfFile);

module.exports = router;
