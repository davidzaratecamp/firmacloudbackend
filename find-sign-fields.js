require('dotenv').config();
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
const fs   = require('fs');
const path = require('path');

const TEMPLATES_DIR = path.resolve(process.env.DOCUMENT_TEMPLATES_DIR || 'document-templates');

async function findSignatureFields() {
  const data = new Uint8Array(fs.readFileSync(path.join(TEMPLATES_DIR, 'combinado 2.pdf')));
  const pdf  = await pdfjsLib.getDocument({ data }).promise;

  for (const pageNum of [2, 4]) {
    const page     = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1 });
    const content  = await page.getTextContent();
    console.log('\n=== Pagina ' + pageNum + ' (' + viewport.width.toFixed(0) + 'x' + viewport.height.toFixed(0) + ') ===');
    for (const item of content.items) {
      const str = (item.str || '').trim();
      if (str) {
        const x = item.transform[4];
        const y = item.transform[5];
        console.log('  "' + str + '"  x=' + x.toFixed(1) + '  y=' + y.toFixed(1));
      }
    }
  }
}

findSignatureFields().catch(console.error);
