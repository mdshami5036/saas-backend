const express = require('express');
const router = express.Router();
const { authenticateTenant } = require('../middleware/authMiddleware');
const {
  getDashboardData,
  updatePricing,
  updateRazorpayCredentials,
  regenerateKeys,
  getJobsHistory,
  getQrCode,
  downloadPreconfiguredAgent,
} = require('../controllers/cafeController');

router.use(authenticateTenant);

router.get('/dashboard', getDashboardData);
router.put('/pricing', updatePricing);
router.put('/razorpay', updateRazorpayCredentials);
router.post('/regenerate-keys', regenerateKeys);
router.get('/jobs', getJobsHistory);
router.get('/qr-code', getQrCode);
router.get('/download-agent', downloadPreconfiguredAgent);

module.exports = router;
