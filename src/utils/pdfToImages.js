// Patch require before loading pdfjs so it finds @napi-rs/canvas when it looks for 'canvas'
const Module = require('module');
const _origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'canvas') return require('@napi-rs/canvas');
  return _origLoad.apply(this, arguments);
};

const { createCanvas, DOMMatrix, DOMPoint, DOMRect, Path2D, ImageData } = require('@napi-rs/canvas');
globalThis.DOMMatrix = DOMMatrix;
globalThis.DOMPoint  = DOMPoint;
globalThis.DOMRect   = DOMRect;
globalThis.Path2D    = Path2D;
globalThis.ImageData = ImageData;

const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
pdfjsLib.GlobalWorkerOptions.workerSrc = false;

const fs = require('fs').promises;

/**
 * Converts PDF pages to base64 PNG strings for embedding in email.
 * @param {string} pdfPath   - Absolute path to the PDF file
 * @param {object} [opts]
 * @param {number} [opts.scale=1.4]    - Render scale (higher = sharper but larger)
 * @param {number} [opts.maxPages=10]  - Max pages to convert
 * @returns {Promise<string[]>}        - Array of base64 PNG strings (no data: prefix)
 */
async function pdfToImages(pdfPath, { scale = 1.4, maxPages = 10 } = {}) {
  const data  = new Uint8Array(await fs.readFile(pdfPath));
  const doc   = await pdfjsLib.getDocument({ data }).promise;
  const total = Math.min(doc.numPages, maxPages);
  const images = [];

  for (let i = 1; i <= total; i++) {
    const page     = await doc.getPage(i);
    const viewport = page.getViewport({ scale });
    const canvas   = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const ctx      = canvas.getContext('2d');

    await page.render({ canvasContext: ctx, viewport }).promise;
    images.push(canvas.toBuffer('image/png').toString('base64'));
  }

  return images;
}

module.exports = { pdfToImages };
