const { PDFDocument } = require('pdf-lib');

/**
 * Extracts only the requested pages from a PDF Buffer.
 * Supports single page ('1'), ranges ('1-3'), lists ('1,3,5'), or combos ('1-2,4').
 * If pagesToPrint is 'ALL' or invalid, returns original buffer unchanged.
 */
async function extractPagesFromPdf(inputBuffer, pagesToPrint, maxPages = 1000) {
  if (!inputBuffer || !pagesToPrint || pagesToPrint.toString().toUpperCase() === 'ALL') {
    return inputBuffer;
  }

  const rangeStr = pagesToPrint.toString().trim();
  const targetPages = new Set();
  const parts = rangeStr.split(',');

  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.includes('-')) {
      const [startStr, endStr] = trimmed.split('-');
      const start = parseInt(startStr, 10);
      const end = parseInt(endStr, 10);
      if (!isNaN(start) && !isNaN(end)) {
        for (let i = Math.max(1, start); i <= Math.min(maxPages, end); i++) {
          targetPages.add(i);
        }
      }
    } else {
      const pageNum = parseInt(trimmed, 10);
      if (!isNaN(pageNum) && pageNum >= 1 && pageNum <= maxPages) {
        targetPages.add(pageNum);
      }
    }
  }

  if (targetPages.size === 0) {
    return inputBuffer;
  }

  try {
    const srcDoc = await PDFDocument.load(inputBuffer, { ignoreEncryption: true });
    const totalActualPages = srcDoc.getPageCount();
    const dstDoc = await PDFDocument.create();

    // Convert 1-indexed to 0-indexed and ensure within actual page range
    const pageIndices = Array.from(targetPages)
      .filter(p => p >= 1 && p <= totalActualPages)
      .sort((a, b) => a - b)
      .map(p => p - 1);

    if (pageIndices.length === 0) {
      return inputBuffer;
    }

    // If user selected all actual pages, no need to slice
    if (pageIndices.length === totalActualPages) {
      return inputBuffer;
    }

    const copiedPages = await dstDoc.copyPages(srcDoc, pageIndices);
    copiedPages.forEach(page => dstDoc.addPage(page));

    const pdfBytes = await dstDoc.save();
    return Buffer.from(pdfBytes);
  } catch (err) {
    console.error('[PDF Slicer Error]:', err.message);
    return inputBuffer;
  }
}

module.exports = {
  extractPagesFromPdf,
};
