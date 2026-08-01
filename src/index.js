require('dotenv').config();
const http = require('http');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');

const { initSocketServer } = require('./services/socketService');
const { startCleanupWorker } = require('./services/cleanupService');

const authRoutes = require('./routes/authRoutes');
const publicRoutes = require('./routes/publicRoutes');
const cafeRoutes = require('./routes/cafeRoutes');
const adminRoutes = require('./routes/adminRoutes');
const agentRoutes = require('./routes/agentRoutes');

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 5000;

// Security & Middleware
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cors({ origin: '*', credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve uploads & static files
const uploadsDir = process.env.UPLOAD_DIR || './uploads';
app.use('/uploads', express.static(path.resolve(uploadsDir)));

// Root Health Check
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    service: 'Auto-Print Multi-Tenant Backend API',
    time: new Date().toISOString(),
  });
});

// API Routing
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/public', publicRoutes);
app.use('/api/v1/cafe', cafeRoutes);
app.use('/api/v1/admin', adminRoutes);
app.use('/api/v1/agent', agentRoutes);

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('[Global Server Error]:', err);
  res.status(err.status || 500).json({
    success: false,
    error: err.message || 'Internal Server Error',
  });
});

// Initialize Socket.IO Server & Cleanup Workers
initSocketServer(server);
startCleanupWorker();

server.listen(PORT, () => {
  console.log(`========================================================`);
  console.log(`🚀 Auto Print Backend API running on port ${PORT}`);
  console.log(`📡 Base API URL: http://localhost:${PORT}/api/v1`);
  console.log(`⚡ WebSocket Server Active (Socket.IO + Polling Fallback)`);
  console.log(`========================================================`);
});
