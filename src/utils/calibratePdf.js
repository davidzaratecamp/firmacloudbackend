/**
 * Herramienta de calibración de coordenadas para contrato_activacion.pdf
 *
 * Uso:
 *   node src/utils/calibratePdf.js
 *
 * Genera un PDF con una grilla de puntos numerados superpuesta sobre el template,
 * permitiendo identificar las coordenadas exactas de cada campo.
 * El resultado se guarda en document-templates/calibration-grid.pdf
 */

require('dotenv').config();
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const fs = require('fs').promises;
const path = require('path');

const TEMPLATES_DIR = path.resolve(process.env.DOCUMENT_TEMPLATES_DIR || 'document-templates');

async function generateGrid(templateFile, outputFile, gridSpacing = 50) {
  const templatePath = path.join(TEMPLATES_DIR, templateFile);
  const templateBytes = await fs.readFile(templatePath);
  const pdfDoc = await PDFDocument.load(templateBytes);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const pages = pdfDoc.getPages();

  for (let pi = 0; pi < pages.length; pi++) {
    const page = pages[pi];
    const { width, height } = page.getSize();

    // Número de página
    page.drawText(`Pág ${pi + 1} — ${width}x${height}pt`, {
      x: 5, y: height - 10, size: 7,
      font, color: rgb(0.8, 0, 0),
    });

    // Líneas horizontales con etiquetas Y
    for (let y = 0; y <= height; y += gridSpacing) {
      page.drawLine({
        start: { x: 0, y }, end: { x: width, y },
        thickness: 0.3,
        color: y % 100 === 0 ? rgb(0, 0, 0.6) : rgb(0.6, 0.6, 0.8),
        opacity: 0.4,
      });
      if (y % 100 === 0 || y % gridSpacing === 0) {
        page.drawText(`${y}`, {
          x: 2, y: y + 2, size: 6,
          font, color: rgb(0, 0, 0.7), opacity: 0.8,
        });
      }
    }

    // Líneas verticales con etiquetas X
    for (let x = 0; x <= width; x += gridSpacing) {
      page.drawLine({
        start: { x, y: 0 }, end: { x, y: height },
        thickness: 0.3,
        color: x % 100 === 0 ? rgb(0, 0.5, 0) : rgb(0.5, 0.8, 0.5),
        opacity: 0.4,
      });
      if (x % 100 === 0) {
        page.drawText(`${x}`, {
          x: x + 2, y: 4, size: 6,
          font, color: rgb(0, 0.5, 0), opacity: 0.8,
        });
      }
    }

    // Ejemplo de texto de prueba en posiciones clave
    const testPoints = [
      { x: 62, y: 640, label: 'clientName p2' },
      { x: 40, y: 722, label: 'greeting p3' },
      { x: 155, y: 690, label: 'firstName p3' },
      { x: 150, y: 130, label: 'signField p4' },
    ];

    for (const pt of testPoints) {
      if (pi === 1 && pt.label.includes('p2')) {
        page.drawRectangle({ x: pt.x - 1, y: pt.y - 2, width: 80, height: 10, color: rgb(1, 1, 0), opacity: 0.5 });
        page.drawText(`>> ${pt.label}`, { x: pt.x, y: pt.y, size: 7, font, color: rgb(0.7, 0, 0) });
      }
      if (pi === 2 && (pt.label.includes('p3') || pt.label.includes('greeting'))) {
        page.drawRectangle({ x: pt.x - 1, y: pt.y - 2, width: 80, height: 10, color: rgb(1, 1, 0), opacity: 0.5 });
        page.drawText(`>> ${pt.label}`, { x: pt.x, y: pt.y, size: 7, font, color: rgb(0.7, 0, 0) });
      }
      if (pi === 3 && pt.label.includes('sign')) {
        page.drawRectangle({ x: pt.x, y: pt.y, width: 200, height: 50, borderColor: rgb(1, 0, 0), borderWidth: 1, opacity: 0.6 });
        page.drawText('>> signField', { x: pt.x + 2, y: pt.y + 2, size: 7, font, color: rgb(1, 0, 0) });
      }
    }
  }

  const outputPath = path.join(TEMPLATES_DIR, outputFile);
  await fs.writeFile(outputPath, await pdfDoc.save());
  console.log(`Grilla generada: ${outputPath}`);
  console.log('Abre el PDF y usa las coordenadas para ajustar src/config/templates/contrato_activacion.json');
}

generateGrid('combinado 2.pdf', 'calibration-grid.pdf')
  .catch(err => {
    console.error('Error:', err.message);
    console.error('Asegúrate de que contrato_activacion.pdf está en', TEMPLATES_DIR);
  });
