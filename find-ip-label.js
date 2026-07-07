require('dotenv').config();
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
const fs   = require('fs');
const path = require('path');

const TEMPLATES_DIR = path.resolve(process.env.DOCUMENT_TEMPLATES_DIR || 'document-templates');

async function findIpLabel() {
  const data = new Uint8Array(fs.readFileSync(path.join(TEMPLATES_DIR, 'combinado 2.pdf')));
  const pdf  = await pdfjsLib.getDocument({ data }).promise;
  const page = await pdf.getPage(3);
  const content = await page.getTextContent();

  for (const item of content.items) {
    const str = (item.str || '').trim();
    if (/IP|direcci/i.test(str)) {
      console.log('"' + str + '"  x=' + item.transform[4].toFixed(1) + '  y=' + item.transform[5].toFixed(1));
    }
  }
}

findIpLabel().catch(console.error);
