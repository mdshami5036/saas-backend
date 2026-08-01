const express = require('express');
const router = express.Router();
const { authenticateAdmin } = require('../middleware/authMiddleware');
const {
  adminLogin,
  getPlatformStats,
  listCafes,
  updateCafeStatus,
} = require('../controllers/adminController');

router.post('/login', adminLogin);
router.get('/stats', authenticateAdmin, getPlatformStats);
router.get('/cafes', authenticateAdmin, listCafes);
router.patch('/cafes/:id/status', authenticateAdmin, updateCafeStatus);

module.exports = router;
