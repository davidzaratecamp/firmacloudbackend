require('dotenv').config();
const path = require('path');
const fs   = require('fs').promises;

const TEMPLATES_DIR = path.resolve(process.env.DOCUMENT_TEMPLATES_DIR || 'document-templates');
const CONFIG_PATH   = path.join(__dirname, 'src/config/templates/contrato_activacion.json');

// Mapeo: id del campo en el JSON → texto de la etiqueta en el PDF
const FIELD_LABEL_MAP = {
  clientFirstName: 'Nombres:',
  clientLastName:  'Apellidos:',
  socialType:      'Social:',
  socialLastFour:  'Número Social:',
  migratoryStatus: 'Estatus migratorio:',
  state:           'Estado:',
  address:         'Dirección:',
  housingType:     'Tipo de vivienda:',
  zipCode:         'Código postal:',
  primaryPhone:    'Número teléfono principal:',
  additionalPhone: 'Número adicional:',
  incomeType:      'Tipo de ingresos:',
  totalIncome:     'Ingresos Totales:',
  insurerName:     'Nombre aseguradora:',
  planCategory:    'Categoría y tipo de plan:',
  planName:        'Nombre de plan:',
  premium:         'Prima:',
  quotationValue:  'Valor cotización:',
  deductible:      'Deducible:',
  maxOutOfPocket:  'Gasto máximo bolsillo:',
  activationDate:  'Fecha activación:',
  securityWord:    'Palabra de seguridad:',
};

async function fixPage3Coords() {
  // ── 1. Extraer posiciones exactas de las etiquetas vía pdfjs ──────────────
  const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
  const pdfData  = new Uint8Array(await fs.readFile(path.join(TEMPLATES_DIR, 'combinado 3.pdf')));
  const pdfDoc   = await pdfjsLib.getDocument({ data: pdfData }).promise;
  const page     = await pdfDoc.getPage(3);
  const viewport = page.getViewport({ scale: 1 });
  const pageH    = viewport.height; // 907

  const textContent = await page.getTextContent();

  // Construir mapa label → posición
  // pdfjs transform[4]=x, transform[5]=y desde abajo (igual que pdf-lib), item.width = ancho REAL
  // renderizado con la fuente real de la plantilla (NO usar una fuente sintética de pdf-lib para
  // estimar esto: sus métricas no coinciden con la fuente real incrustada en el PDF y el x calculado
  // queda varios puntos corrido).
  const labelPositions = {};
  for (const item of textContent.items) {
    const str = item.str ? item.str.trim() : '';
    if (!str) continue;
    const x = item.transform[4];
    const y = item.transform[5]; // y desde abajo = pdf-lib y directo
    labelPositions[str] = { x, y, width: item.width };
  }

  console.log('Posiciones extraídas del PDF:\n');
  for (const [label, pos] of Object.entries(labelPositions)) {
    if (Object.values(FIELD_LABEL_MAP).includes(label)) {
      console.log(`  "${label}"  x=${pos.x.toFixed(1)}  y=${pos.y.toFixed(1)}`);
    }
  }

  // ── 2. Gap fijo entre el final de la etiqueta y el inicio del valor ───────
  const VALUE_GAP = 2.5; // puntos, promedio observado entre etiqueta y valor calibrados a mano

  // ── 3. Leer config actual ──────────────────────────────────────────────────
  const config = JSON.parse(await fs.readFile(CONFIG_PATH, 'utf-8'));

  // ── 4. Actualizar campos de página 3 ──────────────────────────────────────
  let updated = 0;
  for (const field of config.textFields) {
    const labelText = FIELD_LABEL_MAP[field.id];
    if (!labelText) continue;

    const pos = labelPositions[labelText];
    if (!pos) {
      console.warn(`  AVISO: etiqueta "${labelText}" no encontrada en el PDF`);
      continue;
    }

    // x del valor = x_etiqueta + ancho REAL de la etiqueta (medido por pdfjs) + gap
    const xValue = Math.round(pos.x + pos.width + VALUE_GAP);
    const yValue = Math.round(pos.y);

    console.log(`  [${field.id}] "${labelText}"  y: ${field.y} → ${yValue}  x: ${field.x} → ${xValue}`);

    field.x = xValue;
    field.y = yValue;
    // fontSize NO se toca: el valor se dibuja en Myriad Pro a 11pt, tamaño independiente
    // del de la etiqueta pre-impresa.
    updated++;
  }

  console.log(`\nActualizados: ${updated} campos`);

  // ── 5. Guardar JSON ───────────────────────────────────────────────────────
  await fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
  console.log(`\nJSON guardado: ${CONFIG_PATH}`);
}

fixPage3Coords().catch(err => {
  console.error('Error:', err.message);
  console.error(err.stack);
});
