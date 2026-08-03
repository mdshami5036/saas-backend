const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../config/db');
const { generateApiKey, generateAgentToken, generateSlug } = require('../utils/tokenGenerator');
const { generateQRCodeDataURL } = require('../utils/qrGenerator');
const { verifyFirebaseToken } = require('../config/firebaseAdmin');

const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-jwt-key-auto-print-saas-2026';
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://saas-nine-ochre.vercel.app';
const BASE_SERVER_URL = process.env.BASE_SERVER_URL || 'https://saas-backend-production-5c3e.up.railway.app';

async function registerCafe(req, res) {
  try {
    const { name, email, password, phone, bwPricePerPage, colorPricePerPage } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ success: false, error: 'Name, email, and password are required' });
    }

    const cleanEmail = email.toLowerCase().trim();

    let tenant = await prisma.tenant.findUnique({
      where: { email: cleanEmail },
    });

    const passwordHash = await bcrypt.hash(password, 10);

    if (tenant) {
      // Update password & details for existing cafe account
      tenant = await prisma.tenant.update({
        where: { id: tenant.id },
        data: {
          passwordHash,
          phone: phone || tenant.phone,
          bwPricePerPage: bwPricePerPage ? parseFloat(bwPricePerPage) : tenant.bwPricePerPage,
          colorPricePerPage: colorPricePerPage ? parseFloat(colorPricePerPage) : tenant.colorPricePerPage,
        },
      });
    } else {
      const slug = generateSlug(name);
      const apiKey = generateApiKey();
      const agentToken = generateAgentToken();
      const websiteUrl = `${FRONTEND_URL}/cafe/${slug}`;
      const qrCodeUrl = await generateQRCodeDataURL(websiteUrl);

      tenant = await prisma.tenant.create({
        data: {
          name,
          email: cleanEmail,
          passwordHash,
          phone: phone || null,
          slug,
          apiKey,
          agentToken,
          bwPricePerPage: bwPricePerPage ? parseFloat(bwPricePerPage) : 2.0,
          colorPricePerPage: colorPricePerPage ? parseFloat(colorPricePerPage) : 10.0,
          customWebsiteUrl: websiteUrl,
          qrCodeUrl,
        },
      });
    }

    const token = jwt.sign(
      { tenantId: tenant.id, slug: tenant.slug, role: 'TENANT' },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    return res.status(200).json({
      success: true,
      message: 'Cyber Cafe account ready',
      token,
      tenant: {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        email: tenant.email,
        websiteUrl: `${FRONTEND_URL}/cafe/${tenant.slug}`,
        backendApiUrl: `${BASE_SERVER_URL}/api/v1`,
        apiKey: tenant.apiKey,
        agentToken: tenant.agentToken,
        qrCodeUrl: tenant.qrCodeUrl,
        bwPricePerPage: tenant.bwPricePerPage,
        colorPricePerPage: tenant.colorPricePerPage,
      },
    });
  } catch (error) {
    console.error('Register error:', error);
    return res.status(500).json({ success: false, error: 'Registration failed', details: error.message });
  }
}

async function loginCafe(req, res) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email and password are required' });
    }

    const cleanEmail = email.toLowerCase().trim();

    let tenant = await prisma.tenant.findUnique({
      where: { email: cleanEmail },
    });

    // Auto-create tenant account if logging in for first time with Email & Password
    if (!tenant) {
      const passwordHash = await bcrypt.hash(password, 10);
      const name = cleanEmail.split('@')[0];
      const slug = generateSlug(name);
      const apiKey = generateApiKey();
      const agentToken = generateAgentToken();
      const websiteUrl = `${FRONTEND_URL}/cafe/${slug}`;
      const qrCodeUrl = await generateQRCodeDataURL(websiteUrl);

      tenant = await prisma.tenant.create({
        data: {
          name,
          email: cleanEmail,
          passwordHash,
          slug,
          apiKey,
          agentToken,
          bwPricePerPage: 2.0,
          colorPricePerPage: 10.0,
          customWebsiteUrl: websiteUrl,
          qrCodeUrl,
        },
      });
    } else {
      const isMatch = await bcrypt.compare(password, tenant.passwordHash);
      if (!isMatch) {
        return res.status(401).json({ success: false, error: 'Invalid email or password' });
      }
    }

    if (tenant.status !== 'ACTIVE') {
      return res.status(403).json({ success: false, error: 'Your Cyber Cafe account has been disabled' });
    }

    const token = jwt.sign(
      { tenantId: tenant.id, slug: tenant.slug, role: 'TENANT' },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    const websiteUrl = `${FRONTEND_URL}/cafe/${tenant.slug}`;

    return res.json({
      success: true,
      token,
      tenant: {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        email: tenant.email,
        phone: tenant.phone,
        websiteUrl,
        backendApiUrl: `${BASE_SERVER_URL}/api/v1`,
        apiKey: tenant.apiKey,
        agentToken: tenant.agentToken,
        qrCodeUrl: tenant.qrCodeUrl,
        bwPricePerPage: tenant.bwPricePerPage,
        colorPricePerPage: tenant.colorPricePerPage,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Login failed', details: error.message });
  }
}

async function firebaseAuthSync(req, res) {
  try {
    const { idToken, email, name } = req.body;

    if (!email) {
      return res.status(400).json({ success: false, error: 'Email is required' });
    }

    const cleanEmail = email.toLowerCase().trim();

    let decodedToken = null;
    if (idToken) {
      decodedToken = await verifyFirebaseToken(idToken);
    }

    const targetEmail = (decodedToken && decodedToken.email) ? decodedToken.email.toLowerCase() : cleanEmail;
    const targetName = name || (decodedToken && decodedToken.name) || targetEmail.split('@')[0];

    let tenant = await prisma.tenant.findUnique({
      where: { email: targetEmail },
    });

    if (!tenant) {
      const slug = generateSlug(targetName);
      const apiKey = generateApiKey();
      const agentToken = generateAgentToken();
      const randomPassword = require('crypto').randomBytes(16).toString('hex');
      const passwordHash = await bcrypt.hash(randomPassword, 10);

      const websiteUrl = `${FRONTEND_URL}/cafe/${slug}`;
      const qrCodeUrl = await generateQRCodeDataURL(websiteUrl);

      tenant = await prisma.tenant.create({
        data: {
          name: targetName,
          email: targetEmail,
          passwordHash,
          slug,
          apiKey,
          agentToken,
          bwPricePerPage: 2.0,
          colorPricePerPage: 10.0,
          customWebsiteUrl: websiteUrl,
          qrCodeUrl,
        },
      });
    }

    if (tenant.status !== 'ACTIVE') {
      return res.status(403).json({ success: false, error: 'Account disabled' });
    }

    const token = jwt.sign(
      { tenantId: tenant.id, slug: tenant.slug, role: 'TENANT' },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    return res.json({
      success: true,
      message: 'Firebase Auth successful',
      token,
      tenant: {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        email: tenant.email,
        websiteUrl: `${FRONTEND_URL}/cafe/${tenant.slug}`,
        backendApiUrl: `${BASE_SERVER_URL}/api/v1`,
        apiKey: tenant.apiKey,
        agentToken: tenant.agentToken,
        qrCodeUrl: tenant.qrCodeUrl,
        bwPricePerPage: tenant.bwPricePerPage,
        colorPricePerPage: tenant.colorPricePerPage,
      },
    });
  } catch (error) {
    console.error('Firebase Auth Sync error:', error);
    return res.status(500).json({ success: false, error: 'Firebase authentication failed', details: error.message });
  }
}

async function getMe(req, res) {
  try {
    const tenant = req.tenant;
    const websiteUrl = `${FRONTEND_URL}/cafe/${tenant.slug}`;

    return res.json({
      success: true,
      tenant: {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        email: tenant.email,
        phone: tenant.phone,
        websiteUrl,
        backendApiUrl: `${BASE_SERVER_URL}/api/v1`,
        apiKey: tenant.apiKey,
        agentToken: tenant.agentToken,
        qrCodeUrl: tenant.qrCodeUrl,
        bwPricePerPage: tenant.bwPricePerPage,
        colorPricePerPage: tenant.colorPricePerPage,
        status: tenant.status,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Failed to fetch user info' });
  }
}

module.exports = {
  registerCafe,
  loginCafe,
  firebaseAuthSync,
  getMe,
};
