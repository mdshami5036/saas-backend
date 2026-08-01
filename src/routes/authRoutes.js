const express = require('express');
const router = express.Router();
const { registerCafe, loginCafe, firebaseAuthSync, getMe } = require('../controllers/authController');
const { authenticateTenant } = require('../middleware/authMiddleware');

router.post('/register', registerCafe);
router.post('/login', loginCafe);
router.post('/firebase-login', firebaseAuthSync);
router.get('/me', authenticateTenant, getMe);

module.exports = router;
