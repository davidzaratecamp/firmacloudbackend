const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
const { loadImage, createCanvas } = require('@napi-rs/canvas');
const fs = require('fs').promises;

// Motor de detección/estampado de firma PROPIO del módulo Reclutamiento — adaptado de
// hrContractPdfService.js, pero copiado a un archivo exclusivo (no importado desde ahí) para
// que un cambio futuro en RRHH nunca pueda afectar a este módulo, ni viceversa (ver
// claude/planReclutamiento.md, "Principio de independencia").
//
// A diferencia de RRHH (un solo documento), este módulo firma DOS documentos que Hydra arma
// y envía ya completos (hoja de vida + tratamiento de datos) — cada uno con su propio texto
// ancla de firma, verificado contra los documentos reales:
//   - Hoja de vida:        "FIRMA DEL CANDIDATO"
//   - Tratamiento de datos: "FIRMA"
// Por eso detectSignLocations() recibe el patrón de ancla como parámetro, en vez de tenerlo
// fijo — el resto de la lógica (buscar la línea "____" encima, o un recuadro vectorial) es
// igual para ambos documentos.
//
// A diferencia de RRHH (celdas de tabla altas y en blanco, ~50pt), los dos documentos de este
// módulo firman sobre un campo de UNA sola línea: "FIRMA DEL CANDIDATO: ____" corrido en el
// mismo renglón (hoja de vida) o una línea "____" con "FIRMA" impreso justo debajo
// (tratamiento) — en ambos casos el espacio real disponible es de apenas ~15-25pt, no 50. Un
// sello de 50pt de alto terminaba flotando muy por encima de la línea (hoja de vida) o incluso
// pisando el renglón siguiente. Por eso SIGN_BOX_HEIGHT bajó y el alto real se limita además
// dinámicamente al hueco vertical libre hasta el texto más cercano por encima (ver
// getAvailableGapAbove) — nunca asume que hay 50pt libres.
const SIGN_BOX_MAX_WIDTH = 200;
const SIGN_BOX_HEIGHT = 26;
const MIN_BOX_HEIGHT = 13;
const GAP_MARGIN = 3; // separación mínima entre el sello y el texto/línea más cercano arriba

const STAMP_SCALE_BY_MODE = { draw: 1, font: 0.7 };

const BRAND_BLUE = rgb(0.145, 0.388, 0.922); // #2563eb
const BRACKET_TICK = 6;
const BRACKET_RADIUS = 3;
const BRACKET_ZONE_WIDTH = 10;
// Sin fila "Firmado por:" — sería redundante, los dos documentos ya traen su propia etiqueta
// impresa ("FIRMA DEL CANDIDATO" / "FIRMA") justo ahí. Solo se deja una fila angosta con el ID
// truncado, que es la única traza que no está ya impresa en el documento.
const ID_ROW_HEIGHT = 7;

// Recuadro vectorial (bordes de tabla) inmediatamente ARRIBA de un label — mismo método que
// RRHH: busca los 2 bordes horizontales delgados más cercanos por encima del label y los
// bordes verticales que los delimitan.
async function detectVectorBoxAbove(page, labelX, labelY) {
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

// "ETIQUETA: ________" en un solo renglón corrido, fusionado en el MISMO item de texto que la
// etiqueta (caso real de hoja de vida: "FIRMA DEL CANDIDATO: ______" es un único string, no dos
// items separados) — a diferencia del caso con línea aparte (tratamiento de datos), aquí no hay
// ningún item "____" independiente que buscar.
const FUSED_UNDERSCORE_RE = /^(.*?)(_{3,})\s*$/;

// Mide, dentro de un item de texto fusionado "ETIQUETA: ____", en qué punto (en unidades reales
// del PDF) empieza el tramo de guiones bajos — mismo método que usa RRHH para ubicar el espacio
// en blanco de "entidad de afiliación" dentro de una frase corrida: se mide con Helvetica la
// PROPORCIÓN prefijo/total (no el ancho absoluto, que dependería de la fuente real de la
// plantilla) y se proyecta esa proporción sobre el ancho real ya medido del item por pdfjs.
function measureFusedUnderscoreOffset(measureFont, fullStr, prefix, realWidth) {
  const wPrefix = measureFont.widthOfTextAtSize(prefix, 1);
  const wFull = measureFont.widthOfTextAtSize(fullStr, 1);
  if (!wFull) return 0;
  return (wPrefix / wFull) * realWidth;
}

// Hueco vertical libre entre `refY` y el texto más cercano por encima (cualquier X — un renglón
// de la fila siguiente puede empezar más a la izquierda o más a la derecha que la firma y aun
// así quedar atropellado si el sello es más alto que el hueco real). Devuelve Infinity si no hay
// nada por encima en la página (ej. firma en la última línea).
function getAvailableGapAbove(items, refY) {
  let nearest = Infinity;
  for (const it of items) {
    const y = it.transform[5];
    if (y > refY + 1 && y < nearest) nearest = y;
  }
  return nearest === Infinity ? Infinity : nearest - refY;
}

// Detecta automáticamente dónde va la firma en un PDF concreto: busca cada ocurrencia del
// texto ancla (labelRegex) y ubica la línea "____" (como item separado, o fusionada en el mismo
// renglón de la etiqueta) inmediatamente encima o en el mismo renglón. Robusto ante reflow del
// documento (contenido variable que empuja el bloque de firma a otra posición o página) porque
// no asume coordenadas fijas: las calcula por documento, en cada llamada. El alto del sello se
// limita además al hueco vertical real disponible hasta el texto más cercano por encima — nunca
// asume que hay una celda alta en blanco (ver getAvailableGapAbove).
async function detectSignLocations(pdfPath, labelRegex) {
  const data = new Uint8Array(await fs.readFile(pdfPath));
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const locations = [];

  // pdf-lib desechable, solo para medir proporciones de ancho de texto con Helvetica (ver
  // measureFusedUnderscoreOffset) — no se guarda ni se usa para nada más.
  const measureDoc = await PDFDocument.create();
  const measureFont = await measureDoc.embedFont(StandardFonts.Helvetica);

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();
    const items = textContent.items.filter(i => i.str && i.str.trim());

    const labels = items.filter(i => labelRegex.test(i.str));

    for (const label of labels) {
      const labX = label.transform[4];
      const labY = label.transform[5];

      const underline = items
        .filter(i => /^_+$/.test(i.str.trim())
          && i.transform[5] > labY && i.transform[5] < labY + 60
          && Math.abs(i.transform[4] - labX) < 160)
        .sort((a, b) => a.transform[5] - b.transform[5])[0];

      const fusedMatch = label.str.match(FUSED_UNDERSCORE_RE);

      let x0, x1, lineY, boxHeight = SIGN_BOX_HEIGHT;

      if (underline) {
        x0 = underline.transform[4];
        x1 = underline.transform[4] + (underline.width || 0);
        lineY = underline.transform[5];
      } else if (fusedMatch) {
        const offset = measureFusedUnderscoreOffset(measureFont, label.str, fusedMatch[1], label.width || 0);
        x0 = labX + offset;
        x1 = labX + (label.width || 0);
        lineY = labY; // el guion bajo está en el MISMO renglón que la etiqueta, no arriba
      } else {
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

      const gapAbove = getAvailableGapAbove(items, lineY);
      boxHeight = Math.max(MIN_BOX_HEIGHT, Math.min(boxHeight, gapAbove - GAP_MARGIN));

      const width = Math.min(SIGN_BOX_MAX_WIDTH, x1 - x0);
      const midX = (x0 + x1) / 2;

      locations.push({
        page: pageNum - 1,
        x: +(midX - width / 2).toFixed(1),
        y: +(lineY + 2).toFixed(1),
        width,
        height: +boxHeight.toFixed(1),
      });
    }
  }

  return locations;
}

// Recorta el PNG de firma a su contenido real (bounding box del trazo por canal alfa) antes
// de estampar — si no, el margen transparente del canvas hace que la tinta se vea pequeña
// dentro de la caja destino.
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

  if (maxX < 0) return pngBuffer;

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

// Estampa una firma ya dibujada por el candidato en cada ubicación detectada de UN documento,
// más "FirmaCloud ID: {recordId}" en el encabezado de todas sus páginas. Se llama una vez por
// documento (hoja de vida y tratamiento de datos), con la misma imagen de firma recortada.
async function stampSignature(originalPdfPath, croppedSignatureBuffer, signLocations, recordId, signatureMode) {
  const pdfDoc = await PDFDocument.load(await fs.readFile(originalPdfPath));
  const sigImage = await pdfDoc.embedPng(croppedSignatureBuffer);
  const pages = pdfDoc.getPages();

  const modeScale = STAMP_SCALE_BY_MODE[signatureMode] ?? STAMP_SCALE_BY_MODE.draw;
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const shortId = recordId ? `${String(recordId).slice(0, 8)}...` : '';

  for (const loc of signLocations) {
    const page = pages[loc.page];
    if (!page) continue;

    const bracketPath = `M ${BRACKET_TICK} 0 L ${BRACKET_RADIUS} 0 Q 0 0 0 ${BRACKET_RADIUS} L 0 ${loc.height - BRACKET_RADIUS} Q 0 ${loc.height} ${BRACKET_RADIUS} ${loc.height} L ${BRACKET_TICK} ${loc.height}`;
    page.drawSvgPath(bracketPath, {
      x: loc.x,
      y: loc.y + loc.height,
      borderColor: BRAND_BLUE,
      borderWidth: 1.2,
    });

    const textX = loc.x + BRACKET_ZONE_WIDTH;
    if (recordId) {
      page.drawText(shortId, {
        x: textX,
        y: loc.y + 1,
        size: 5,
        font,
        color: BRAND_BLUE,
      });
    }

    const sigAreaX = textX;
    const sigAreaY = loc.y + ID_ROW_HEIGHT;
    const sigAreaWidth = loc.width - BRACKET_ZONE_WIDTH;
    const sigAreaHeight = loc.height - ID_ROW_HEIGHT;

    const dims = sigImage.scaleToFit(sigAreaWidth * modeScale, sigAreaHeight * modeScale);
    page.drawImage(sigImage, {
      x: sigAreaX,
      y: sigAreaY + (sigAreaHeight - dims.height) / 2,
      width: dims.width,
      height: dims.height,
      opacity: 1,
    });
  }

  if (recordId) {
    const headerText = `FirmaCloud ID: ${recordId}`;
    const gray = rgb(0.35, 0.35, 0.35);
    for (const page of pages) {
      page.drawText(headerText, { x: 40, y: page.getHeight() - 14, size: 7.5, font, color: gray });
    }
  }

  return await pdfDoc.save();
}

async function getPageCount(pdfPath) {
  const pdfDoc = await PDFDocument.load(await fs.readFile(pdfPath));
  return pdfDoc.getPageCount();
}

module.exports = {
  detectSignLocations,
  cropSignatureToContent,
  stampSignature,
  getPageCount,
  ANCHOR_CV: /FIRMA\s+DEL\s+CANDIDATO/i,
  ANCHOR_TRATAMIENTO: /^FIRMA$/i,
};
