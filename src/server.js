const app = require('./app');
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const PORT = process.env.PORT || 3000;
const ROOT = path.join(__dirname, '..');

// Resolve storage dirs relative to backend root and expose as absolute paths
const resolvedir = (env, fallback) => path.isAbsolute(env || '') ? env : path.join(ROOT, env || fallback);
process.env.UPLOADS_DIR = resolvedir(process.env.UPLOADS_DIR, 'uploads');
process.env.SIGNED_DIR = resolvedir(process.env.SIGNED_DIR, 'signed');
process.env.CERTIFICATES_DIR = resolvedir(process.env.CERTIFICATES_DIR, 'certificates');

[process.env.UPLOADS_DIR, process.env.SIGNED_DIR, process.env.CERTIFICATES_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

app.listen(PORT, () => {
  console.log(`FirmaCloud API running on port ${PORT}`);
});
