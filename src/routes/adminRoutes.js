const express = require('express');
const router = express.Router();
const { authenticateAdmin } = require('../middleware/authMiddleware');
const {
  adminLogin,
  getPlatformStats,
  listCafes,
  updateCafeStatus,
  updateCafeName,
  migrateTokensToSixDigits,
  deleteReview,
} = require('../controllers/adminController');

router.post('/login', adminLogin);
router.get('/stats', authenticateAdmin, getPlatformStats);
router.get('/cafes', authenticateAdmin, listCafes);
router.patch('/cafes/:id/status', authenticateAdmin, updateCafeStatus);
router.patch('/cafes/:id/name', authenticateAdmin, updateCafeName);
router.post('/migrate-tokens', authenticateAdmin, migrateTokensToSixDigits);
router.delete('/reviews/:id', authenticateAdmin, deleteReview);

module.exports = router;
