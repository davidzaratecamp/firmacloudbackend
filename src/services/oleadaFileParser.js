const XLSX = require('xlsx');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_ROWS = parseInt(process.env.OLEADA_MAX_RECIPIENTS) || 5000;

const HEADER_ALIASES = {
  name:  ['nombre', 'name', 'cliente', 'client_name'],
  email: ['email', 'correo', 'e-mail', 'client_email'],
  phone: ['telefono', 'teléfono', 'phone', 'celular', 'client_phone'],
};

function normalizeHeader(h) {
  return String(h || '').trim().toLowerCase();
}

function mapRow(rawRow) {
  const out = { name: '', email: '', phone: '' };
  for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
    for (const rawKey of Object.keys(rawRow)) {
      if (aliases.includes(normalizeHeader(rawKey))) {
        out[key] = String(rawRow[rawKey] ?? '').trim();
        break;
      }
    }
  }
  return out;
}

// sendChannel: 'email' | 'whatsapp' | 'both' — determina qué campos son obligatorios por fila
function parseRecipientsFile(buffer, sendChannel) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

  if (rawRows.length > MAX_ROWS) {
    const err = new Error(`El archivo supera el máximo de ${MAX_ROWS} filas`);
    err.code = 'TOO_MANY_ROWS';
    throw err;
  }

  const seenEmails = new Set();
  const valid = [];
  const invalid = [];

  rawRows.forEach((rawRow, idx) => {
    const rowNum = idx + 2; // fila 1 es encabezado
    const { name, email, phone } = mapRow(rawRow);

    if (!name) return invalid.push({ row: rowNum, reason: 'Nombre requerido' });
    if ((sendChannel === 'email' || sendChannel === 'both') && !email)
      return invalid.push({ row: rowNum, reason: 'Email requerido' });
    if (email && !EMAIL_RE.test(email))
      return invalid.push({ row: rowNum, reason: 'Email inválido' });
    if ((sendChannel === 'whatsapp' || sendChannel === 'both') && !phone)
      return invalid.push({ row: rowNum, reason: 'Teléfono requerido' });

    const emailKey = email.toLowerCase();
    if (email && seenEmails.has(emailKey))
      return invalid.push({ row: rowNum, reason: 'Email duplicado en el archivo' });
    if (email) seenEmails.add(emailKey);

    valid.push({ name, email: email || null, phone: phone || null });
  });

  return { valid, invalid, totalRows: rawRows.length };
}

module.exports = { parseRecipientsFile };
