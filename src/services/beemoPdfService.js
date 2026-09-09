const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const fs = require('fs').promises;
const path = require('path');

const TEMPLATE_CONFIG_PATH = path.join(__dirname, '../config/templates/beemo_template.json');
const TEMPLATE_DIR = process.env.BEEMO_TEMPLATE_DIR
  ? path.resolve(process.env.BEEMO_TEMPLATE_DIR)
  : path.join(__dirname, '../../document-templates/beemo');

let cachedConfig = null;

async function getBeemoSignConfig() {
  if (cachedConfig) return cachedConfig;
  const raw = await fs.readFile(TEMPLATE_CONFIG_PATH, 'utf-8');
  cachedConfig = JSON.parse(raw);
  return cachedConfig;
}

async function getPageCount(pdfPath) {
  const pdfDoc = await PDFDocument.load(await fs.readFile(pdfPath));
  return pdfDoc.getPageCount();
}

// Modo plantilla: llena beemo.pdf con los datos del formulario según beemo_template.json.
// Bloqueado hasta que llegue el PDF de plantilla (fields: [] por ahora).
async function fillBeemoTemplate(documentData) {
  const config = await getBeemoSignConfig();
  if (!config.fields || config.fields.length === 0) {
    throw new Error('Plantilla Beemo no configurada aún (fields vacío en beemo_template.json)');
  }

  const templatePath = path.join(TEMPLATE_DIR, config.templateFile);
  const pdfDoc = await PDFDocument.load(await fs.readFile(templatePath));
  // Desactivar ligaduras si se embebe una fuente custom — lección de ObamaCare/florida2026.
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica, { features: { liga: false, rlig: false, clig: false } });
  const pages = pdfDoc.getPages();

  for (const field of config.fields) {
    let value = field.dataPath.split('.').reduce((obj, key) => obj?.[key], documentData);
    if (!value) continue; // campo ausente: no se dibuja (misma semántica que ObamaCare)
    if (field.type === 'date') {
      // El input type="date" del frontend entrega "YYYY-MM-DD"; se interpreta en UTC para
      // evitar que un huso horario negativo la corra un día hacia atrás al formatear.
      const d = new Date(`${value}T00:00:00Z`);
      if (!isNaN(d)) value = d.toLocaleDateString('es-CO', { timeZone: 'UTC' });
    }
    const page = pages[field.page];
    if (!page) continue;
    page.drawText(String(value), {
      x: field.x,
      y: field.y,
      size: field.fontSize || 11,
      font,
      color: rgb(0.1, 0.1, 0.1),
    });
  }

  return Buffer.from(await pdfDoc.save());
}

// Resuelve dónde va la firma para un PDF cargado (modo upload): si coincide en número de
// páginas con la plantilla calibrada usa signField del JSON; si no, cae al default por env
// (BEEMO_SIGN_FIELD_X/Y/W/H, mismo patrón que NPN_SIGN_FIELD_*) sobre la última página.
async function resolveSignField(pdfPath) {
  const config = await getBeemoSignConfig();
  const pageCount = await getPageCount(pdfPath);

  if (config.expectedPages && pageCount === config.expectedPages) {
    return { page: config.signPage, ...config.signField };
  }

  const x = parseFloat(process.env.BEEMO_SIGN_FIELD_X);
  const y = parseFloat(process.env.BEEMO_SIGN_FIELD_Y);
  const w = parseFloat(process.env.BEEMO_SIGN_FIELD_W);
  const h = parseFloat(process.env.BEEMO_SIGN_FIELD_H);

  return {
    page: pageCount - 1,
    x: isNaN(x) ? 40 : x,
    y: isNaN(y) ? 40 : y,
    width: isNaN(w) ? 180 : w,
    height: isNaN(h) ? 50 : h,
  };
}

// Estampa la firma + encabezado/pie de evidencia sobre el PDF (plantilla o cargado).
async function stampBeemoSignature(originalPath, signatureDataUrl, meta) {
  const pdfDoc = await PDFDocument.load(await fs.readFile(originalPath));
  const pages = pdfDoc.getPages();

  const base64Data = signatureDataUrl.replace(/^data:image\/png;base64,/, '');
  const sigImage = await pdfDoc.embedPng(Buffer.from(base64Data, 'base64'));
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const signField = await resolveSignField(originalPath);
  const extraLocations = (await getBeemoSignConfig()).extraSignLocations || [];
  const locations = [signField, ...extraLocations];

  const gray = rgb(0.35, 0.35, 0.35);
  const now = new Date();
  const headerText = `${meta.recipientEmail || meta.recipientName}  ${now.toLocaleDateString('es-CO')} ${now.toLocaleTimeString('es-CO')} UTC`;
  const footerText = `Firmante: ${meta.recipientName} | IP: ${meta.ip} | ${now.toLocaleDateString('es-CO')} UTC | ID: ${meta.documentId}`;

  for (const loc of locations) {
    const page = pages[loc.page];
    if (!page) continue;
    const dims = sigImage.scaleToFit(loc.width, loc.height);
    page.drawImage(sigImage, {
      x: loc.x,
      y: loc.y,
      width: dims.width,
      height: dims.height,
    });
  }

  for (const page of pages) {
    page.drawText(headerText, { x: 40, y: page.getHeight() - 14, size: 7.5, font, color: gray });
    page.drawText(footerText, { x: 40, y: 10, size: 6.5, font, color: gray });
  }

  return Buffer.from(await pdfDoc.save());
}

module.exports = { getBeemoSignConfig, getPageCount, fillBeemoTemplate, stampBeemoSignature };
