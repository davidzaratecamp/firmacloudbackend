const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const fs = require('fs').promises;
const path = require('path');

// Coordinates of "Firma Cliente: ____" line in carta-tratamiento-de-datos.pdf
// Page: 612x792 pts (US Letter). Field visually at ~y=498 from bottom.
const SIGN_FIELD = { x: 150, y: 495, width: 112, height: 32 };

async function stampSignature(originalPdfPath, signatureDataUrl, signerInfo) {
  const pdfBytes = await fs.readFile(originalPdfPath);
  const pdfDoc = await PDFDocument.load(pdfBytes);

  const base64Data = signatureDataUrl.replace(/^data:image\/png;base64,/, '');
  const signatureImageBytes = Buffer.from(base64Data, 'base64');
  const signatureImage = await pdfDoc.embedPng(signatureImageBytes);

  const pages = pdfDoc.getPages();
  const page = pages[0];

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  // Place signature image exactly on "Firma Cliente: ___" field
  const sigDims = signatureImage.scaleToFit(SIGN_FIELD.width, SIGN_FIELD.height);
  page.drawImage(signatureImage, {
    x: SIGN_FIELD.x + (SIGN_FIELD.width - sigDims.width) / 2,
    y: SIGN_FIELD.y + (SIGN_FIELD.height - sigDims.height) / 2,
    width: sigDims.width,
    height: sigDims.height,
    opacity: 0.92,
  });

  // Legal stamp block at bottom of page (outside document content area)
  const stampY = 20;
  const stampX = 40;
  page.drawRectangle({
    x: stampX,
    y: stampY,
    width: page.getWidth() - 80,
    height: 36,
    color: rgb(0.95, 0.97, 1),
    borderColor: rgb(0.7, 0.8, 0.95),
    borderWidth: 0.5,
  });
  page.drawText(`Firmado por: ${signerInfo.signerName}  |  ${signerInfo.signedAt}  |  IP: ${signerInfo.ipAddress}`, {
    x: stampX + 6, y: stampY + 20, size: 6.5, font: fontBold, color: rgb(0.2, 0.2, 0.5),
  });
  page.drawText(`ID Firma: ${signerInfo.id}`, {
    x: stampX + 6, y: stampY + 9, size: 6, font, color: rgb(0.4, 0.4, 0.6),
  });

  return await pdfDoc.save();
}

async function generateCertificate(sig, logs) {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595, 842]); // A4
  const { width, height } = page.getSize();

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  let y = height - 40;

  // Header
  page.drawRectangle({ x: 0, y: height - 100, width, height: 100, color: rgb(0.12, 0.23, 0.37) });
  page.drawText('SUMARIUM DE FIRMA DIGITAL', { x: 40, y: height - 45, size: 20, font: fontBold, color: rgb(1, 1, 1) });
  page.drawText('Evidencia Legal de Firma Electrónica - FirmaCloud', { x: 40, y: height - 68, size: 11, font, color: rgb(0.58, 0.76, 1) });
  page.drawText('Asiste Health Care', { x: 40, y: height - 86, size: 10, font, color: rgb(0.7, 0.85, 1) });

  y = height - 130;

  const drawSection = (title) => {
    y -= 20;
    page.drawRectangle({ x: 40, y: y - 4, width: width - 80, height: 22, color: rgb(0.93, 0.96, 1) });
    page.drawText(title, { x: 48, y: y + 2, size: 10, font: fontBold, color: rgb(0.12, 0.23, 0.37) });
    y -= 8;
  };

  const drawRow = (label, value) => {
    y -= 18;
    page.drawText(label + ':', { x: 48, y, size: 9, font: fontBold, color: rgb(0.3, 0.3, 0.3) });
    page.drawText(String(value || 'N/A'), { x: 200, y, size: 9, font, color: rgb(0.1, 0.1, 0.1) });
  };

  // Signature ID
  drawSection('IDENTIFICACIÓN DE LA FIRMA');
  drawRow('UUID de Firma', sig.id);
  drawRow('Estado', sig.status === 'signed' ? 'FIRMADO' : sig.status.toUpperCase());
  drawRow('Hash del Documento', sig.document_hash);
  drawRow('Nombre del Documento', sig.document_name);

  // Parties
  drawSection('PARTES INVOLUCRADAS');
  drawRow('Nombre del Firmante', sig.signer_name || sig.client_name);
  drawRow('Email del Cliente', sig.client_email);
  drawRow('Teléfono del Cliente', sig.client_phone);
  drawRow('Agente que Envió', sig.agent_name_sent || sig.agent_name);
  drawRow('Cédula del Agente', sig.agent_cedula);

  // Timestamps
  drawSection('REGISTRO DE FECHAS Y HORAS (UTC)');
  drawRow('Fecha de Envío', sig.sent_at ? new Date(sig.sent_at).toISOString().replace('T', ' ').slice(0, 19) + ' UTC' : 'N/A');
  drawRow('Fecha de Visualización', sig.viewed_at ? new Date(sig.viewed_at).toISOString().replace('T', ' ').slice(0, 19) + ' UTC' : 'N/A');
  drawRow('Fecha de Firma', sig.signed_at ? new Date(sig.signed_at).toISOString().replace('T', ' ').slice(0, 19) + ' UTC' : 'N/A');

  // Technical evidence
  drawSection('EVIDENCIA TÉCNICA DEL ENVÍO');
  drawRow('IP de Envío del Documento', sig.sent_from_ip);
  drawRow('Ubicación del Servidor de Envío', sig.sent_from_location);

  drawSection('EVIDENCIA TÉCNICA DEL FIRMANTE');
  drawRow('Dirección IP', sig.signer_ip || 'N/A');
  drawRow('Dispositivo', sig.signer_device || 'N/A');

  // User agent - wrap it
  if (sig.signer_user_agent) {
    y -= 18;
    page.drawText('User-Agent:', { x: 48, y, size: 9, font: fontBold, color: rgb(0.3, 0.3, 0.3) });
    const ua = sig.signer_user_agent;
    const maxChars = 70;
    if (ua.length <= maxChars) {
      page.drawText(ua, { x: 200, y, size: 8, font, color: rgb(0.1, 0.1, 0.1) });
    } else {
      page.drawText(ua.slice(0, maxChars), { x: 200, y, size: 8, font, color: rgb(0.1, 0.1, 0.1) });
      y -= 12;
      page.drawText(ua.slice(maxChars, maxChars * 2), { x: 200, y, size: 8, font, color: rgb(0.1, 0.1, 0.1) });
    }
  }

  // Geolocation
  if (sig.signer_geolocation) {
    const geo = typeof sig.signer_geolocation === 'string' ? JSON.parse(sig.signer_geolocation) : sig.signer_geolocation;
    if (geo && geo.latitude) {
      if (geo.locationName) drawRow('Ubicación', geo.locationName);
      drawRow('Geolocalización', `Lat: ${geo.latitude}, Lng: ${geo.longitude} (±${geo.accuracy}m)`);
    }
  }

  // Activity log
  drawSection('LOG DE ACTIVIDAD');
  if (logs && logs.length > 0) {
    for (const log of logs) {
      y -= 16;
      if (y < 80) break;
      const ts = new Date(log.created_at).toISOString().replace('T', ' ').slice(0, 19);
      page.drawText(`[${ts}] ${log.event_type}`, { x: 48, y, size: 8, font, color: rgb(0.2, 0.2, 0.2) });
      if (log.details) {
        const det = typeof log.details === 'string' ? log.details : JSON.stringify(log.details);
        page.drawText(det.slice(0, 80), { x: 100, y: y - 10, size: 7, font, color: rgb(0.5, 0.5, 0.5) });
        y -= 10;
      }
    }
  }

  // Footer
  y = 60;
  page.drawLine({ start: { x: 40, y }, end: { x: width - 40, y }, thickness: 1, color: rgb(0.8, 0.8, 0.8) });
  page.drawText('Este documento es un registro legal generado automáticamente por FirmaCloud.', { x: 40, y: y - 15, size: 8, font, color: rgb(0.5, 0.5, 0.5) });
  page.drawText(`Generado el: ${new Date().toISOString().replace('T', ' ').slice(0, 19)} UTC`, { x: 40, y: y - 27, size: 8, font, color: rgb(0.5, 0.5, 0.5) });

  return await pdfDoc.save();
}

async function mergePDFs(pdf1Buffer, pdf2Buffer) {
  const merged = await PDFDocument.create();
  const doc1 = await PDFDocument.load(pdf1Buffer);
  const doc2 = await PDFDocument.load(pdf2Buffer);
  const pages1 = await merged.copyPages(doc1, doc1.getPageIndices());
  const pages2 = await merged.copyPages(doc2, doc2.getPageIndices());
  pages1.forEach(p => merged.addPage(p));
  pages2.forEach(p => merged.addPage(p));
  return await merged.save();
}

module.exports = { stampSignature, generateCertificate, mergePDFs };
