// Prueba manual de fillVitalDocument + stampSignature (flujo vital).
// Genera document-templates/test-vital-filled.pdf — no forma parte del flujo de producción.
require('dotenv').config();
const fs = require('fs').promises;
const path = require('path');
const { fillVitalDocument, stampSignature, getVitalSignConfig } = require('./src/services/pdfService');

async function main() {
  const documentData = {
    vital: {
      clientName: 'SILVIA REYES VILCHIS',
      agentName: 'LUIS VITIER',
      agentNPN: '18771778',
      agentPhone: '+1(786) 227-3915',
      agentEmail: 'VITIERLUIS98@GMAIL.COM',
      householdContactName: 'SILVIA REYES VILCHIS',
      householdContactPhone: '6783687620',
      householdContactEmail: 'VILCHISSILVIA72@GMAIL.COM',
      taxes: '30.09',
      company: 'OSCAR',
      plan: 'HMO',
      monthlyPay: '122.47',
      deductible: '8000',
      gd: '3',
      pd: '0',
      sd: '50%',
    },
  };

  const filledBuffer = await fillVitalDocument(documentData);
  const tmpPath = path.join(__dirname, 'document-templates', 'test-vital-unsigned.pdf');
  await fs.writeFile(tmpPath, filledBuffer);
  console.log('Generado (sin firmar):', tmpPath);

  const vitalConfig = await getVitalSignConfig();

  // PNG mínimo 1x1 transparente como firma dummy (imagen válida conocida)
  const dummyPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  const signatureDataUrl = `data:image/png;base64,${dummyPngBase64}`;

  const signedBuffer = await stampSignature(
    tmpPath,
    signatureDataUrl,
    {
      id: 'test-id-1234',
      signerName: 'SILVIA REYES VILCHIS',
      clientEmail: 'VILCHISSILVIA72@GMAIL.COM',
      signedAt: new Date(),
      ipAddress: '172.56.70.91',
      geolocation: { latitude: 33.7488, longitude: -84.38754, accuracy: 15, locationName: 'United States of America (US), Georgia - Atlanta' },
    },
    vitalConfig.signField,
    vitalConfig.signPageIndex,
    vitalConfig.extraSignLocations,
    'vital'
  );

  const signedPath = path.join(__dirname, 'document-templates', 'test-vital-signed.pdf');
  await fs.writeFile(signedPath, signedBuffer);
  console.log('Generado (firmado):', signedPath);
}

main().catch(err => {
  console.error('Error:', err.message);
  console.error(err.stack);
});
