const express = require('express');
const router = express.Router();
const { resolveAgentToken } = require('../middleware/tenantMiddleware');
const {
  registerDevice,
  pollJobs,
  downloadJobFile,
  updateJobStatusHttp,
  checkVersion,
} = require('../controllers/agentController');

router.get('/version', checkVersion);

router.use(resolveAgentToken);

router.post('/register', registerDevice);
router.get('/poll', pollJobs);
router.get('/jobs/:id/file', downloadJobFile);
router.post('/jobs/:id/status', updateJobStatusHttp);

module.exports = router;
