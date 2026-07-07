require('dotenv').config();
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const fs = require('fs').promises;
const path = require('path');

const TEMPLATES_DIR = path.resolve(process.env.DOCUMENT_TEMPLATES_DIR || 'document-templates');

async function calibratePage3() {
  const templatePath = path.join(TEMPLATES_DIR, 'combinado 2.pdf');
  const templateBytes = await fs.readFile(templatePath);
  const pdfDoc = await PDFDocument.load(templateBytes);
  const font     = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const pages = pdfDoc.getPages();
  const page  = pages[2]; // page 3 (index 2)
  const { width, height } = page.getSize();

  console.log(`Page 3 size: ${width} x ${height}`);

  // Líneas horizontales cada 25px con etiquetas y
  for (let y = 25; y < height; y += 25) {
    const isHundred = y % 100 === 0;
    page.drawLine({
      start: { x: 0, y }, end: { x: width, y },
      thickness: isHundred ? 0.8 : 0.3,
      color: isHundred ? rgb(0, 0, 0.8) : rgb(0.5, 0.5, 0.9),
      opacity: 0.5,
    });
    page.drawText(`${y}`, {
      x: 2, y: y + 1, size: 5,
      font, color: rgb(0, 0, 0.8), opacity: 0.9,
    });
  }

  // Líneas verticales cada 50px
  for (let x = 50; x < width; x += 50) {
    page.drawLine({
      start: { x, y: 0 }, end: { x, y: height },
      thickness: 0.3,
      color: rgb(0, 0.5, 0),
      opacity: 0.3,
    });
    page.drawText(`${x}`, {
      x: x + 1, y: 3, size: 5,
      font, color: rgb(0, 0.5, 0), opacity: 0.9,
    });
  }

  // Marcadores en posiciones CartaPlantillaAfiliados escalado 0.567
  const fields = [
    { id: 'greeting',     y: 737, label: 'Hola [nombre]' },
    { id: 'Nombres',      y: 635, label: 'Nombres:' },
    { id: 'Apellidos',    y: 607, label: 'Apellidos:' },
    { id: 'Social',       y: 578, label: 'Social:' },
    { id: 'NumSocial',    y: 550, label: 'Numero Social:' },
    { id: 'Migratorio',   y: 521, label: 'Estatus migrat.:' },
    { id: 'Estado',       y: 493, label: 'Estado:' },
    { id: 'Direccion',    y: 465, label: 'Direccion:' },
    { id: 'TipoVivienda', y: 437, label: 'Tipo vivienda:' },
    { id: 'Postal',       y: 408, label: 'Cod. postal:' },
    { id: 'TelPrincipal', y: 380, label: 'Tel. principal:' },
    { id: 'Aseguradora',  y: 352, label: 'Aseguradora:' },
    { id: 'Ingresos',     y: 323, label: 'Ingresos:' },
    { id: 'IP',           y: 295, label: 'IP / extras:' },
  ];

  for (const f of fields) {
    // Triángulo/marcador rojo a la derecha
    page.drawRectangle({
      x: 330, y: f.y - 1,
      width: 175, height: 9,
      color: rgb(1, 0.9, 0.9),
      opacity: 0.7,
    });
    page.drawText(`<< y=${f.y} [${f.id}]`, {
      x: 332, y: f.y + 1,
      size: 6, font: fontBold,
      color: rgb(0.8, 0, 0),
    });
  }

  const outputPath = path.join(TEMPLATES_DIR, 'calibration-page3.pdf');
  await fs.writeFile(outputPath, await pdfDoc.save());
  console.log(`Calibración página 3 generada: ${outputPath}`);
  console.log('Abre document-templates/calibration-page3.pdf y compara las etiquetas');
  console.log('rojas (posiciones actuales) con las etiquetas pre-impresas del template.');
  console.log('Dime el desplazamiento: cuántos px hay que mover cada fila hacia arriba/abajo.');
}

calibratePage3().catch(err => {
  console.error('Error:', err.message);
});
