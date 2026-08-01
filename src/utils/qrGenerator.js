const QRCode = require('qrcode');

async function generateQRCodeDataURL(url) {
  try {
    return await QRCode.toDataURL(url, {
      errorCorrectionLevel: 'H',
      type: 'image/png',
      margin: 2,
      color: {
        dark: '#1e293b',
        light: '#ffffff',
      },
      width: 400,
    });
  } catch (err) {
    console.error('Failed to generate QR Code:', err);
    throw err;
  }
}

async function generateQRCodeSVG(url) {
  try {
    return await QRCode.toString(url, {
      type: 'svg',
      margin: 2,
      color: {
        dark: '#0f172a',
        light: '#ffffff',
      },
    });
  } catch (err) {
    console.error('Failed to generate SVG QR Code:', err);
    throw err;
  }
}

module.exports = {
  generateQRCodeDataURL,
  generateQRCodeSVG,
};
