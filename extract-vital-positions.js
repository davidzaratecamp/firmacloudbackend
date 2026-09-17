// Extrae posiciones de texto de todas las páginas de "Carta CMS Vital.pdf"
// para calibrar src/config/templates/vital_firma_tratamiento_datos.json.
// Uso único de calibración — no forma parte del flujo de producción.
require('dotenv').config();
const path = require('path');
const fs   = require('fs').promises;

const TEMPLATES_DIR = path.resolve(process.env.DOCUMENT_TEMPLATES_DIR || 'document-templates');

async function extractPositions() {
  const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');

  const filePath = path.join(TEMPLATES_DIR, 'Carta CMS Vital.pdf');
  const data     = new Uint8Array(await fs.readFile(filePath));
  const loadingTask = pdfjsLib.getDocument({ data });
  const pdfDocument = await loadingTask.promise;

  console.log(`PDF cargado. Total páginas: ${pdfDocument.numPages}\n`);

  for (let pageNum = 1; pageNum <= pdfDocument.numPages; pageNum++) {
    const page     = await pdfDocument.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1 });
    const pageHeight = viewport.height;
    console.log(`\n========== PÁGINA ${pageNum} (index ${pageNum - 1}) — ${viewport.width.toFixed(1)} x ${viewport.height.toFixed(1)} ==========`);

    const textContent = await page.getTextContent();
    const allItems = textContent.items.filter(i => i.str && i.str.trim());

    // y = item.transform[5] directamente (bottom-origin = pdf-lib y directo).
    // Confirmado contra fix-page3-coords.js, que es el método que sí produjo
    // coordenadas correctas para contrato_activacion.json.
    const lines = {};
    for (const item of allItems) {
      const tx  = item.transform;
      const y   = Math.round(tx[5]);
      const x   = tx[4];
      const w   = item.width;
      const key = `${y}`;
      if (!lines[key]) lines[key] = { y, items: [] };
      lines[key].items.push({ x, w, text: item.str });
    }

    const sortedLines = Object.values(lines).sort((a, b) => b.y - a.y);
    for (const line of sortedLines) {
      const sorted = line.items.sort((a, b) => a.x - b.x);
      const text   = sorted.map(i => i.text).join('');
      if (text.trim()) {
        const firstX = sorted[0].x.toFixed(1);
        const lastItem = sorted[sorted.length - 1];
        const endX = (lastItem.x + lastItem.w).toFixed(1);
        console.log(`  y=${line.y}  x=${firstX}  endX=${endX}  |  "${text.trim()}"`);
      }
    }
  }
}

extractPositions().catch(err => {
  console.error('Error:', err.message);
  console.error(err.stack);
});
