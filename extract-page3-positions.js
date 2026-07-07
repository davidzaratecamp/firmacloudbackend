require('dotenv').config();
const path = require('path');
const fs   = require('fs').promises;

const TEMPLATES_DIR = path.resolve(process.env.DOCUMENT_TEMPLATES_DIR || 'document-templates');

// Etiquetas que buscamos en la página 3 del template
const TARGET_LABELS = [
  'Nombres:',
  'Apellidos:',
  'Social:',
  'Número Social:',
  'Estatus migratorio:',
  'Estado:',
  'Dirección:',
  'Tipo de vivienda:',
  'Código postal:',
  'Número teléfono principal:',
  'Número adicional:',
  'Tipo de ingresos:',
  'Ingresos Totales:',
  'Nombre aseguradora:',
  'Categoría y tipo de plan:',
  'Nombre de plan:',
  'Prima:',
  'Valor cotización:',
  'Deducible:',
  'Gasto máximo bolsillo:',
  'Fecha activación:',
  'Palabra de seguridad:',
  'IP:',
  'Hola',
  'Datos del titular:',
];

async function extractPositions() {
  const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');

  const filePath = path.join(TEMPLATES_DIR, 'combinado 2.pdf');
  const data     = new Uint8Array(await fs.readFile(filePath));
  const loadingTask = pdfjsLib.getDocument({ data });
  const pdfDocument = await loadingTask.promise;

  console.log(`PDF cargado. Total páginas: ${pdfDocument.numPages}\n`);

  // Página 3 = index 3 en pdfjs (1-based)
  const page     = await pdfDocument.getPage(3);
  const viewport = page.getViewport({ scale: 1 });
  console.log(`Página 3 — viewport: ${viewport.width.toFixed(1)} x ${viewport.height.toFixed(1)}\n`);

  const textContent = await page.getTextContent();

  // pdfjs devuelve coordenadas en sistema "top-left origin" dentro del viewport.
  // pdf-lib usa "bottom-left origin". Conversión: y_pdflib = height - y_pdfjs
  const pageHeight = viewport.height;

  console.log('=== TODOS LOS TEXTOS DE PÁGINA 3 (para referencia) ===');
  const allItems = textContent.items.filter(i => i.str && i.str.trim());
  for (const item of allItems) {
    const tx    = item.transform;
    const xPDF  = tx[4];
    const yPDF  = pageHeight - tx[5];
    const str   = item.str.trim();
    if (str) {
      console.log(`  "${str}"  →  x=${xPDF.toFixed(1)}  y_pdflib=${yPDF.toFixed(1)}`);
    }
  }

  console.log('\n=== ETIQUETAS ENCONTRADAS ===');
  const found = {};
  for (const item of allItems) {
    const str  = item.str.trim();
    const tx   = item.transform;
    const xPDF = tx[4];
    const yPDF = pageHeight - tx[5];

    for (const label of TARGET_LABELS) {
      // Busca coincidencia parcial (el label puede estar fragmentado en varios items)
      if (str.includes(label) || label.includes(str)) {
        if (!found[label] || found[label].x > xPDF) {
          found[label] = { x: xPDF, y: yPDF, text: str };
        }
      }
    }
  }

  for (const [label, pos] of Object.entries(found)) {
    console.log(`  "${label}"  →  x=${pos.x.toFixed(1)}  y=${pos.y.toFixed(1)}`);
  }

  // Reconstruir texto completo por línea (agrupar items con y similar ±3)
  console.log('\n=== LÍNEAS RECONSTRUIDAS (agrupadas por Y) ===');
  const lines = {};
  for (const item of allItems) {
    const tx  = item.transform;
    const y   = Math.round(pageHeight - tx[5]);
    const x   = tx[4];
    const key = `${y}`;
    if (!lines[key]) lines[key] = { y, items: [] };
    lines[key].items.push({ x, text: item.str });
  }

  const sortedLines = Object.values(lines).sort((a, b) => b.y - a.y);
  for (const line of sortedLines) {
    const sorted = line.items.sort((a, b) => a.x - b.x);
    const text   = sorted.map(i => i.text).join('');
    if (text.trim()) {
      console.log(`  y=${line.y}  |  "${text.trim()}"`);
    }
  }
}

extractPositions().catch(err => {
  console.error('Error:', err.message);
  console.error(err.stack);
});
