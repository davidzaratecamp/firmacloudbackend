const app = require('./app');
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { resolveServerLocation } = require('./utils/serverLocation');

const PORT = process.env.PORT || 3000;
const ROOT = path.join(__dirname, '..');

// Resolve storage dirs relative to backend root and expose as absolute paths
const resolvedir = (env, fallback) => path.isAbsolute(env || '') ? env : path.join(ROOT, env || fallback);
process.env.UPLOADS_DIR       = resolvedir(process.env.UPLOADS_DIR,       'uploads');
process.env.SIGNED_DIR        = resolvedir(process.env.SIGNED_DIR,        'signed');
process.env.CERTIFICATES_DIR  = resolvedir(process.env.CERTIFICATES_DIR,  'certificates');
process.env.FORM_UPLOADS_DIR  = resolvedir(process.env.FORM_UPLOADS_DIR,  'form-uploads');
// PLANTILLAS_DIR: source directory — resolved but NOT auto-created
if (process.env.PLANTILLAS_DIR && !path.isAbsolute(process.env.PLANTILLAS_DIR)) {
  process.env.PLANTILLAS_DIR = path.join(ROOT, process.env.PLANTILLAS_DIR);
}

[process.env.UPLOADS_DIR, process.env.SIGNED_DIR, process.env.CERTIFICATES_DIR, process.env.FORM_UPLOADS_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

app.listen(PORT, () => {
  console.log(`FirmaCloud API running on port ${PORT}`);
  resolveServerLocation();
});
