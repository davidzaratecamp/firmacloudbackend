const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
const { loadImage, createCanvas } = require('@napi-rs/canvas');
const fs = require('fs').promises;
const path = require('path');

const TEMPLATE_CONFIG_PATH = path.join(__dirname, '../config/templates/contrato_laboral.json');
const SIGN_BOX_MAX_WIDTH = 210;
const SIGN_BOX_HEIGHT = 50;

// El modo "fuente" (texto tipeado con una tipografía cursiva) llena su propio recuadro de
// forma mucho más densa que un trazo dibujado a mano (que es delgado y disperso). Al recortar
// ambos a su contenido real y escalar a la misma caja, la firma de fuente se ve
// desproporcionadamente más grande. Se aplica un factor de escala independiente por modo.
const STAMP_SCALE_BY_MODE = { draw: 1, font: 0.7 };

// Estilo "estela de firma" (inspirado en el corchete morado de DocuSign, en azul de marca
// FirmaCloud): corchete redondeado a la izquierda + "Firmado por:" arriba + ID del contrato
// (truncado) abajo, con la firma en el espacio restante entre esos dos textos.
const BRAND_BLUE = rgb(0.145, 0.388, 0.922); // #2563eb
const BRACKET_TICK = 8;     // largo de los brazos horizontales del corchete
const BRACKET_RADIUS = 4;    // radio de esquina
const BRACKET_ZONE_WIDTH = 12; // ancho reservado a la izquierda (corchete + margen al texto)
const LABEL_ROW_HEIGHT = 10;  // alto reservado arriba para "Firmado por:"
const ID_ROW_HEIGHT = 9;    // alto reservado abajo para el ID truncado

async function getContractSignConfig() {
  const raw = await fs.readFile(TEMPLATE_CONFIG_PATH, 'utf-8');
  return JSON.parse(raw);
}

// Algunas hojas no tienen línea "____" sino un recuadro vectorial (rectángulo dibujado) donde
// va la firma — ej. tablas con fila "espacio en blanco" / fila "FIRMA TRABAJADOR" separadas por
// bordes. Se buscan los bordes horizontales delgados (líneas de tabla) que crucen la columna
// del label, por encima de éste: el primero de abajo hacia arriba es el techo de la fila del
// label (= piso del recuadro de firma), el segundo es el techo del recuadro. Luego se buscan los
// bordes verticales que delimitan esa fila a izquierda/derecha del label. Devuelve null si no
// encuentra un recuadro reconocible (queda el fallback más simple basado en el ancho del label).
async function detectVectorBoxAbove(page, labelX, labelY) {
  const opList = await page.getOperatorList();
  const THIN = 1.0; // pt — grosor típico de una línea de borde de tabla

  const horizLines = [];
  const vertLines = [];

  for (let i = 0; i < opList.fnArray.length; i++) {
    if (opList.fnArray[i] !== pdfjsLib.OPS.constructPath) continue;
    const bbox = opList.argsArray[i][2]; // [minX, maxX, minY, maxY]
    if (!bbox) continue;
    const [minX, maxX, minY, maxY] = bbox;
    const w = maxX - minX, h = maxY - minY;
    if (h <= THIN && w > 20) horizLines.push({ minX, maxX, y: (minY + maxY) / 2 });
    else if (w <= THIN && h > 8) vertLines.push({ minY, maxY, x: (minX + maxX) / 2 });
  }

  const above = horizLines
    .filter(l => l.minX <= labelX && l.maxX >= labelX && l.y > labelY)
    .sort((a, b) => a.y - b.y);
  if (above.length < 2) return null;

  const boxBottom = above[0].y;
  const boxTop = above[1].y;

  const inRange = vertLines.filter(v => v.minY <= boxBottom + 2 && v.maxY >= boxTop - 2);
  const left  = inRange.filter(v => v.x <= labelX).sort((a, b) => b.x - a.x)[0];
  const right = inRange.filter(v => v.x > labelX).sort((a, b) => a.x - b.x)[0];
  if (!left || !right) return null;

  return { x0: left.x, x1: right.x, y0: boxBottom, y1: boxTop };
}

// Igual que detectVectorBoxAbove, pero busca el recuadro de tabla inmediatamente DEBAJO de un
// label (ej. "TALLA CAMISA" en el encabezado de columna, con la celda de dato justo debajo).
async function detectVectorBoxBelow(page, labelX, labelY) {
  const opList = await page.getOperatorList();
  const THIN = 1.0;

  const horizLines = [];
  const vertLines = [];

  for (let i = 0; i < opList.fnArray.length; i++) {
    if (opList.fnArray[i] !== pdfjsLib.OPS.constructPath) continue;
    const bbox = opList.argsArray[i][2];
    if (!bbox) continue;
    const [minX, maxX, minY, maxY] = bbox;
    const w = maxX - minX, h = maxY - minY;
    if (h <= THIN && w > 20) horizLines.push({ minX, maxX, y: (minY + maxY) / 2 });
    else if (w <= THIN && h > 8) vertLines.push({ minY, maxY, x: (minX + maxX) / 2 });
  }

  const below = horizLines
    .filter(l => l.minX <= labelX && l.maxX >= labelX && l.y < labelY)
    .sort((a, b) => b.y - a.y);
  if (below.length < 2) return null;

  const boxTop = below[0].y;
  const boxBottom = below[1].y;

  const inRange = vertLines.filter(v => v.minY <= boxTop + 2 && v.maxY >= boxBottom - 2);
  const left  = inRange.filter(v => v.x <= labelX).sort((a, b) => b.x - a.x)[0];
  const right = inRange.filter(v => v.x > labelX).sort((a, b) => a.x - b.x)[0];
  if (!left || !right) return null;

  return { x0: left.x, x1: right.x, y0: boxBottom, y1: boxTop };
}

// Detecta, en ESTE PDF concreto, los espacios en blanco que el trabajador debe llenar antes de
// firmar: el nombre de la entidad de afiliación (dentro de una frase corrida en la página del
// formato de autorización) y las 3 tallas de dotación (celdas de una tabla con bordes
// vectoriales). Devuelve null por campo si no se encuentra — el llamador decide qué hacer.
async function detectFillInFields(pdfPath) {
  const data = new Uint8Array(await fs.readFile(pdfPath));
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const result = { entidadAfiliacion: null, tallaCamisa: null, tallaPantalon: null, tallaCalzado: null };

  // pdf-lib desechable, solo para medir proporciones de ancho de texto con Helvetica y así
  // ubicar dónde empieza el tramo de guiones bajos dentro de una frase corrida.
  const measureDoc = await PDFDocument.create();
  const measureFont = await measureDoc.embedFont(StandardFonts.Helvetica);

  const tallaLabels = {
    tallaCamisa: /TALLA\s+CAMISA/i,
    tallaPantalon: /TALLA\s+PANTAL[OÓ]N/i,
    tallaCalzado: /TALLA\s+CALZADO/i,
  };

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const items = (await page.getTextContent()).items.filter(i => i.str && i.str.trim());

    if (!result.entidadAfiliacion) {
      const entidadItem = items.find(i => /afiliaci[oó]n con la entidad/i.test(i.str));
      const match = entidadItem && entidadItem.str.match(/^(.*?entidad\s+)(_+)/i);
      if (match) {
        const [, prefix, blank] = match;
        const wFull = measureFont.widthOfTextAtSize(entidadItem.str, 1);
        const wPrefix = measureFont.widthOfTextAtSize(prefix, 1);
        const wBlank = measureFont.widthOfTextAtSize(blank, 1);
        const measuredWidth = entidadItem.width || wFull;
        const blankStartX = entidadItem.transform[4] + (wPrefix / wFull) * measuredWidth;
        const blankWidth = (wBlank / wFull) * measuredWidth;
        result.entidadAfiliacion = {
          page: pageNum - 1,
          x: +blankStartX.toFixed(1),
          y: +(entidadItem.transform[5] + 1).toFixed(1),
          width: +blankWidth.toFixed(1),
          height: 10,
        };
      }
    }

    for (const [key, regex] of Object.entries(tallaLabels)) {
      if (result[key]) continue;
      const label = items.find(i => regex.test(i.str));
      if (!label) continue;
      const box = await detectVectorBoxBelow(page, label.transform[4], label.transform[5]);
      if (!box) continue;
      const margin = 6;
      result[key] = {
        page: pageNum - 1,
        x: +(box.x0 + margin).toFixed(1),
        y: +(box.y0 + 3).toFixed(1),
        width: +(box.x1 - box.x0 - margin * 2).toFixed(1),
        height: +(box.y1 - box.y0 - 6).toFixed(1),
      };
    }
  }

  return result;
}

// Detecta automáticamente dónde va la firma en ESTE PDF concreto: busca cada ocurrencia
// del texto "FIRMA TRABAJADOR" (a veces fragmentado como "RMA TRABAJADOR" por el extractor
// de texto) y ubica la línea "____" inmediatamente encima. Esto es robusto ante reflujo del
// documento (ej. un nombre de empleado más largo que empuja el bloque de firma a otra
// posición o página) porque no asume coordenadas fijas: las calcula por documento.
async function detectSignLocations(pdfPath) {
  const data = new Uint8Array(await fs.readFile(pdfPath));
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const locations = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();
    const items = textContent.items.filter(i => i.str && i.str.trim());

    const labels = items.filter(i => /(?:FI)?RMA\s+TRABAJADOR/i.test(i.str));

    for (const label of labels) {
      // pdfjs entrega transform en el mismo sistema de coordenadas que pdf-lib
      // (origen inferior-izquierdo), así que labY/lineY se usan directo para dibujar.
      const labX = label.transform[4];
      const labY = label.transform[5];

      const underline = items
        .filter(i => /^_+$/.test(i.str.trim())
          && i.transform[5] > labY && i.transform[5] < labY + 60
          && Math.abs(i.transform[4] - labX) < 160)
        .sort((a, b) => a.transform[5] - b.transform[5])[0];

      let x0, x1, lineY, boxHeight = SIGN_BOX_HEIGHT;

      if (underline) {
        x0 = underline.transform[4];
        x1 = underline.transform[4] + (underline.width || 0);
        lineY = underline.transform[5];
      } else {
        // No hay línea de texto: puede ser un recuadro vectorial (ver detectVectorBoxAbove)
        // o un trazo vectorial simple sin recuadro (último recurso: estimar por el label).
        const box = await detectVectorBoxAbove(page, labX, labY);
        if (box) {
          const margin = 3;
          x0 = box.x0 + margin;
          x1 = box.x1 - margin;
          lineY = box.y0;
          boxHeight = Math.min(SIGN_BOX_HEIGHT, box.y1 - box.y0 - margin * 2);
        } else {
          x0 = labX;
          x1 = labX + (label.width || 180);
          lineY = labY + 13;
        }
      }

      const width = Math.min(SIGN_BOX_MAX_WIDTH, x1 - x0);
      const midX = (x0 + x1) / 2;

      locations.push({
        page: pageNum - 1,
        x: +(midX - width / 2).toFixed(1),
        y: +(lineY + 2).toFixed(1),
        width,
        height: boxHeight,
      });
    }
  }

  return locations;
}

// El canvas de firma (DrawPad) tiene fondo transparente y el trazo suele ocupar solo una
// fracción del área dibujable. Si se estampa el PNG completo, scaleToFit escala también todo
// ese margen vacío, dejando la tinta real pequeña dentro de la caja. Recortar al bounding box
// del trazo (según canal alfa) antes de estampar hace que la tinta use la caja casi completa.
async function cropSignatureToContent(pngBuffer, paddingRatio = 0.08) {
  const img = await loadImage(pngBuffer);
  const w = img.width, h = img.height;
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);

  const ALPHA_THRESHOLD = 10;
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > ALPHA_THRESHOLD) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < 0) return pngBuffer; // lienzo vacío (no debería pasar; el frontend ya valida)

  const padX = Math.round((maxX - minX) * paddingRatio) + 4;
  const padY = Math.round((maxY - minY) * paddingRatio) + 4;
  const cropX = Math.max(0, minX - padX);
  const cropY = Math.max(0, minY - padY);
  const cropW = Math.min(w, maxX + padX) - cropX;
  const cropH = Math.min(h, maxY + padY) - cropY;

  const cropCanvas = createCanvas(cropW, cropH);
  cropCanvas.getContext('2d').drawImage(canvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
  return cropCanvas.toBuffer('image/png');
}

// Estampa una sola firma dibujada por el trabajador sobre la línea correspondiente
// de cada hoja configurada en contrato_laboral.json (justo encima de "FIRMA TRABAJADOR"),
// agrega "FirmaCloud ID: {contractId}" en la parte superior de TODAS las hojas del PDF
// (no solo las firmadas), y estampa los campos pre-firma (entidad de afiliación + tallas)
// que el trabajador llenó a mano antes de firmar. `fillInValues` es un objeto opcional
// { entidadAfiliacion, tallaCamisa, tallaPantalon, tallaCalzado } — estos valores NO se
// guardan en la base de datos, solo se estampan en el PDF resultante.
async function stampContractSignature(originalPdfPath, signatureDataUrl, signLocations, contractId, signatureMode, fillInValues) {
  const pdfDoc = await PDFDocument.load(await fs.readFile(originalPdfPath));

  const base64Data = signatureDataUrl.replace(/^data:image\/png;base64,/, '');
  const croppedBuffer = await cropSignatureToContent(Buffer.from(base64Data, 'base64'));
  const sigImage = await pdfDoc.embedPng(croppedBuffer);
  const pages = pdfDoc.getPages();

  const modeScale = STAMP_SCALE_BY_MODE[signatureMode] ?? STAMP_SCALE_BY_MODE.draw;
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const shortId = contractId ? `${String(contractId).slice(0, 8)}...` : '';

  if (fillInValues && Object.values(fillInValues).some(v => v && String(v).trim())) {
    const fields = await detectFillInFields(originalPdfPath);
    const darkText = rgb(0.1, 0.1, 0.1);
    for (const key of Object.keys(fields)) {
      const value = fillInValues[key];
      const loc = fields[key];
      if (!value || !String(value).trim() || !loc) continue;
      const page = pages[loc.page];
      if (!page) continue;
      const text = String(value).trim();
      const naturalWidth = font.widthOfTextAtSize(text, 10);
      const fontSize = naturalWidth > loc.width ? (10 * loc.width) / naturalWidth : 10;
      const textWidth = font.widthOfTextAtSize(text, fontSize);
      // Centrado horizontal dentro del espacio/celda detectado. Las tallas además se suben
      // 1pt (quedan un poco más altas dentro de su celda que la entidad de afiliación).
      const x = loc.x + Math.max(0, (loc.width - textWidth) / 2);
      const yOffset = key === 'entidadAfiliacion' ? 0 : 1;
      page.drawText(text, { x, y: loc.y + yOffset, size: fontSize, font, color: darkText });
    }
  }

  for (const loc of signLocations) {
    const page = pages[loc.page];
    if (!page) continue;

    // Corchete azul: ancla en la esquina superior-izquierda del recuadro. pdf-lib invierte
    // el eje Y de las rutas SVG, así que la ruta se define en coordenadas locales donde
    // (0,0) = esquina superior y el alto del corchete crece hacia abajo.
    const bracketPath = `M ${BRACKET_TICK} 0 L ${BRACKET_RADIUS} 0 Q 0 0 0 ${BRACKET_RADIUS} L 0 ${loc.height - BRACKET_RADIUS} Q 0 ${loc.height} ${BRACKET_RADIUS} ${loc.height} L ${BRACKET_TICK} ${loc.height}`;
    page.drawSvgPath(bracketPath, {
      x: loc.x,
      y: loc.y + loc.height,
      borderColor: BRAND_BLUE,
      borderWidth: 1.2,
    });

    const textX = loc.x + BRACKET_ZONE_WIDTH;
    if (contractId) {
      page.drawText('Firmado por:', {
        x: textX,
        y: loc.y + loc.height - LABEL_ROW_HEIGHT + 1,
        size: 6,
        font: fontBold,
        color: rgb(0.15, 0.15, 0.15),
      });
      page.drawText(shortId, {
        x: textX,
        y: loc.y + 2,
        size: 5.5,
        font,
        color: BRAND_BLUE,
      });
    }

    // Firma dentro del espacio restante (a la derecha del corchete, entre el label y el ID)
    const sigAreaX = textX;
    const sigAreaY = loc.y + ID_ROW_HEIGHT;
    const sigAreaWidth = loc.width - BRACKET_ZONE_WIDTH;
    const sigAreaHeight = loc.height - LABEL_ROW_HEIGHT - ID_ROW_HEIGHT;

    const dims = sigImage.scaleToFit(sigAreaWidth * modeScale, sigAreaHeight * modeScale);
    page.drawImage(sigImage, {
      // Alineada a la izquierda (pegada al corchete/label), no centrada en todo el ancho
      // disponible — si no, una firma angosta queda flotando lejos del corchete.
      x: sigAreaX,
      y: sigAreaY + (sigAreaHeight - dims.height) / 2,
      width: dims.width,
      height: dims.height,
      opacity: 1,
    });
  }

  if (contractId) {
    const headerText = `FirmaCloud ID: ${contractId}`;
    const gray = rgb(0.35, 0.35, 0.35);
    for (const page of pages) {
      page.drawText(headerText, {
        x: 40,
        y: page.getHeight() - 14,
        size: 7.5,
        font,
        color: gray,
      });
    }
  }

  return await pdfDoc.save();
}

async function getPageCount(pdfPath) {
  const pdfDoc = await PDFDocument.load(await fs.readFile(pdfPath));
  return pdfDoc.getPageCount();
}

module.exports = { getContractSignConfig, detectSignLocations, detectFillInFields, stampContractSignature, getPageCount };
