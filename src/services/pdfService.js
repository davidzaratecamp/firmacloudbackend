const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const fs = require('fs').promises;
const path = require('path');

const SIGN_FIELD = { x: 150, y: 495, width: 112, height: 32 };

function wrapText(text, maxWidth, font, fontSize) {
  const words = text.split(' ');
  const lines = [];
  let current = '';
  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(test, fontSize) > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines;
}

async function stampSignature(originalPdfPath, signatureDataUrl, signerInfo) {
  const pdfBytes = await fs.readFile(originalPdfPath);
  const pdfDoc = await PDFDocument.load(pdfBytes);

  const base64Data = signatureDataUrl.replace(/^data:image\/png;base64,/, '');
  const signatureImageBytes = Buffer.from(base64Data, 'base64');
  const signatureImage = await pdfDoc.embedPng(signatureImageBytes);

  const pages = pdfDoc.getPages();

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  // Formatear fecha como M-D-YYYY HH:mm:s (igual que el PDF de referencia)
  const d = signerInfo.signedAt instanceof Date ? signerInfo.signedAt : new Date(signerInfo.signedAt);
  const headerDate = `${d.getUTCMonth() + 1}-${d.getUTCDate()}-${d.getUTCFullYear()} ${d.getUTCHours()}:${String(d.getUTCMinutes()).padStart(2,'0')}:${d.getUTCSeconds()}`;
  const headerText = `${signerInfo.clientEmail}  ${headerDate}`.trim();
  const footerText = `Utilizando dirección IP: ${signerInfo.ipAddress}`;

  // Estampar la firma solo en página 1
  const page = pages[0];
  const sigDims = signatureImage.scaleToFit(SIGN_FIELD.width, SIGN_FIELD.height);
  page.drawImage(signatureImage, {
    x: SIGN_FIELD.x + (SIGN_FIELD.width - sigDims.width) / 2,
    y: SIGN_FIELD.y + (SIGN_FIELD.height - sigDims.height) / 2,
    width: sigDims.width,
    height: sigDims.height,
    opacity: 0.92,
  });

  // Encabezado (email + fecha) y pie (IP) en TODAS las páginas
  for (const p of pages) {
    const pw = p.getWidth();
    const ph = p.getHeight();
    const gray = rgb(0.3, 0.3, 0.3);

    // Encabezado: email + fecha en la parte superior
    p.drawText(headerText, {
      x: 40, y: ph - 14,
      size: 7.5, font, color: gray,
    });

    // Separador horizontal bajo el encabezado
    p.drawLine({
      start: { x: 40, y: ph - 18 },
      end:   { x: pw - 40, y: ph - 18 },
      thickness: 0.4,
      color: rgb(0.7, 0.7, 0.7),
    });

    // Pie: IP en la parte inferior
    p.drawLine({
      start: { x: 40, y: 22 },
      end:   { x: pw - 40, y: 22 },
      thickness: 0.4,
      color: rgb(0.7, 0.7, 0.7),
    });
    p.drawText(footerText, {
      x: 40, y: 10,
      size: 7.5, font, color: gray,
    });
  }

  return await pdfDoc.save();
}

async function generateCertificate(sig, logs) {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const M = 48;
  const W = 595;
  const H = 842;
  const CW = W - M * 2;

  const fmtDate = (d) => d ? new Date(d).toISOString().replace('T', ' ').slice(0, 19) + ' UTC' : 'N/A';

  // ===== PÁGINA 1: Certificado principal =====
  {
    const page = pdfDoc.addPage([W, H]);
    let y = H - 40;

    page.drawRectangle({ x: 0, y: H - 110, width: W, height: 110, color: rgb(0.12, 0.23, 0.37) });
    page.drawText('SUMARIUM DE FIRMA DIGITAL', { x: M, y: H - 42, size: 20, font: fontBold, color: rgb(1, 1, 1) });
    page.drawText('Evidencia Legal de Firma Electrónica - Asiste Health Care', { x: M, y: H - 64, size: 11, font, color: rgb(0.58, 0.76, 1) });
    // Company info — right side
    page.drawText('Asiste Health Care', { x: 360, y: H - 42, size: 11, font: fontBold, color: rgb(1, 1, 1) });
    page.drawText('EIN 93-3452400', { x: 360, y: H - 58, size: 9, font, color: rgb(0.85, 0.92, 1) });
    page.drawText('5345 SW 34TH AVE', { x: 360, y: H - 72, size: 9, font, color: rgb(0.7, 0.85, 1) });
    page.drawText('FORT LAUDERDALE, FL 33312', { x: 360, y: H - 85, size: 9, font, color: rgb(0.7, 0.85, 1) });
    page.drawText('admin@asistehealth.com', { x: 360, y: H - 98, size: 8, font, color: rgb(0.6, 0.78, 1) });
    y = H - 140;

    const drawSection = (title) => {
      y -= 20;
      page.drawRectangle({ x: M, y: y - 4, width: CW, height: 22, color: rgb(0.93, 0.96, 1) });
      page.drawText(title, { x: M + 8, y: y + 2, size: 10, font: fontBold, color: rgb(0.12, 0.23, 0.37) });
      y -= 8;
    };

    const drawRow = (label, value) => {
      y -= 18;
      page.drawText(label + ':', { x: M + 8, y, size: 9, font: fontBold, color: rgb(0.3, 0.3, 0.3) });
      page.drawText(String(value || 'N/A'), { x: 200, y, size: 9, font, color: rgb(0.1, 0.1, 0.1) });
    };

    drawSection('IDENTIFICACIÓN DE LA FIRMA');
    drawRow('UUID de Firma', sig.id);
    drawRow('Estado', sig.status === 'signed' ? 'FIRMADO' : sig.status.toUpperCase());
    drawRow('Hash del Documento', sig.document_hash);
    drawRow('Nombre del Documento', sig.document_name);

    drawSection('PARTES INVOLUCRADAS');
    drawRow('Nombre del Firmante', sig.signer_name || sig.client_name);
    drawRow('Email del Cliente', sig.client_email);
    drawRow('Teléfono del Cliente', sig.client_phone);
    drawRow('Agente que Envió', sig.agent_name_sent || sig.agent_name);
    drawRow('Cédula del Agente', sig.agent_cedula);

    if (sig.ersd_accepted_at) {
      drawSection('DIVULGACIÓN DE FIRMA ELECTRÓNICA (ERSD)');
      drawRow('Estado de Aceptación', 'ACEPTADO');
      drawRow('Aceptado el', fmtDate(sig.ersd_accepted_at));
      drawRow('ID de Aceptación', sig.ersd_acceptance_id);
    }

    drawSection('REGISTRO DE FECHAS Y HORAS (UTC)');
    drawRow('Fecha de Envío', fmtDate(sig.sent_at));
    drawRow('Fecha de Visualización', fmtDate(sig.viewed_at));
    drawRow('Fecha de Firma', fmtDate(sig.signed_at));

    drawSection('EVIDENCIA TÉCNICA DEL ENVÍO');
    drawRow('IP de Envío del Documento', sig.sent_from_ip);
    drawRow('Ubicación del Servidor de Envío', sig.sent_from_location);

    drawSection('EVIDENCIA TÉCNICA DEL FIRMANTE');
    drawRow('Dirección IP', sig.signer_ip || 'N/A');
    drawRow('Dispositivo', sig.signer_device || 'N/A');

    if (sig.signer_user_agent) {
      y -= 18;
      page.drawText('User-Agent:', { x: M + 8, y, size: 9, font: fontBold, color: rgb(0.3, 0.3, 0.3) });
      const ua = sig.signer_user_agent;
      const maxChars = 70;
      page.drawText(ua.slice(0, maxChars), { x: 200, y, size: 8, font, color: rgb(0.1, 0.1, 0.1) });
      if (ua.length > maxChars) {
        y -= 12;
        page.drawText(ua.slice(maxChars, maxChars * 2), { x: 200, y, size: 8, font, color: rgb(0.1, 0.1, 0.1) });
      }
    }

    if (sig.signer_geolocation) {
      const geo = typeof sig.signer_geolocation === 'string' ? JSON.parse(sig.signer_geolocation) : sig.signer_geolocation;
      if (geo && geo.latitude) {
        if (geo.locationName) drawRow('Ubicación', geo.locationName);
        drawRow('Geolocalización', `Lat: ${geo.latitude}, Lng: ${geo.longitude} (±${geo.accuracy}m)`);
      }
    }

    if (sig.signature_image_path) {
      try {
        const sigImageBytes = await fs.readFile(sig.signature_image_path);
        const sigImage = await pdfDoc.embedPng(sigImageBytes);
        drawSection('FIRMA DEL CLIENTE');
        y -= 10;
        if (y > 120) {
          const sigDims = sigImage.scaleToFit(180, 60);
          page.drawRectangle({
            x: M + 8, y: y - sigDims.height - 6,
            width: sigDims.width + 12, height: sigDims.height + 12,
            color: rgb(0.98, 0.98, 0.98),
            borderColor: rgb(0.8, 0.8, 0.85),
            borderWidth: 0.5,
          });
          page.drawImage(sigImage, { x: M + 14, y: y - sigDims.height, width: sigDims.width, height: sigDims.height });
          y -= sigDims.height + 20;
        }
      } catch {}
    }

    page.drawLine({ start: { x: M, y: 50 }, end: { x: W - M, y: 50 }, thickness: 0.5, color: rgb(0.8, 0.8, 0.8) });
    page.drawText('Este documento es un registro legal generado automáticamente por Asiste Health Care.', { x: M, y: 36, size: 8, font, color: rgb(0.5, 0.5, 0.5) });
    page.drawText(`Generado el: ${fmtDate(new Date())}`, { x: M, y: 24, size: 8, font, color: rgb(0.5, 0.5, 0.5) });
  }

  // ===== PÁGINA 2: Resumen formal de eventos =====
  {
    const page = pdfDoc.addPage([W, H]);
    let y = H - 40;

    page.drawRectangle({ x: 0, y: H - 90, width: W, height: 90, color: rgb(0.12, 0.23, 0.37) });
    page.drawText('RESUMEN DE EVENTOS DEL DOCUMENTO', { x: M, y: H - 40, size: 16, font: fontBold, color: rgb(1, 1, 1) });
    page.drawText('Asiste Health Care · Asiste Health Care', { x: M, y: H - 64, size: 10, font, color: rgb(0.7, 0.85, 1) });
    y = H - 115;

    // Tabla de eventos
    y -= 10;
    page.drawRectangle({ x: M, y: y - 5, width: CW, height: 24, color: rgb(0.12, 0.23, 0.37) });
    page.drawText('Evento del documento', { x: M + 8, y: y, size: 9.5, font: fontBold, color: rgb(1, 1, 1) });
    page.drawText('Estado', { x: M + 220, y: y, size: 9.5, font: fontBold, color: rgb(1, 1, 1) });
    page.drawText('Marca de tiempo', { x: M + 360, y: y, size: 9.5, font: fontBold, color: rgb(1, 1, 1) });
    y -= 24;

    const eventMap = {
      DOCUMENT_SENT:   { label: 'Documento enviado',      status: 'Con hash/cifrado',      color: rgb(0.1, 0.1, 0.5) },
      DOCUMENT_VIEWED: { label: 'Documento visualizado',   status: 'Seguridad comprobada',  color: rgb(0.05, 0.45, 0.1) },
      DOCUMENT_SIGNED: { label: 'Firma completada',        status: 'Seguridad comprobada',  color: rgb(0.05, 0.45, 0.1) },
    };

    let alt = false;
    const drawnTypes = new Set();
    if (logs && logs.length > 0) {
      for (const log of logs) {
        const ev = eventMap[log.event_type];
        if (!ev || drawnTypes.has(log.event_type)) continue;
        drawnTypes.add(log.event_type);
        if (alt) page.drawRectangle({ x: M, y: y - 6, width: CW, height: 22, color: rgb(0.96, 0.97, 0.99) });
        const ts = fmtDate(log.created_at);
        page.drawText(ev.label, { x: M + 8, y, size: 9, font, color: rgb(0.1, 0.1, 0.1) });
        page.drawText(ev.status, { x: M + 220, y, size: 9, font, color: ev.color });
        page.drawText(ts, { x: M + 360, y, size: 9, font, color: rgb(0.2, 0.2, 0.2) });
        y -= 22;
        alt = !alt;
      }
    }

    if (sig.status === 'signed' && sig.signed_at) {
      if (alt) page.drawRectangle({ x: M, y: y - 6, width: CW, height: 22, color: rgb(0.96, 0.97, 0.99) });
      page.drawText('Completado', { x: M + 8, y, size: 9, font: fontBold, color: rgb(0.05, 0.4, 0.05) });
      page.drawText('Seguridad comprobada', { x: M + 220, y, size: 9, font, color: rgb(0.05, 0.45, 0.1) });
      page.drawText(fmtDate(sig.signed_at), { x: M + 360, y, size: 9, font, color: rgb(0.2, 0.2, 0.2) });
      y -= 22;
    }

    page.drawLine({ start: { x: M, y: y + 2 }, end: { x: W - M, y: y + 2 }, thickness: 0.5, color: rgb(0.7, 0.7, 0.7) });
    y -= 30;

    // Log de actividad técnico
    page.drawRectangle({ x: M, y: y - 4, width: CW, height: 22, color: rgb(0.93, 0.96, 1) });
    page.drawText('LOG DE ACTIVIDAD TÉCNICO', { x: M + 8, y: y + 2, size: 10, font: fontBold, color: rgb(0.12, 0.23, 0.37) });
    y -= 28;

    if (logs && logs.length > 0) {
      for (const log of logs) {
        if (y < 80) break;
        const ts = new Date(log.created_at).toISOString().replace('T', ' ').slice(0, 19);
        page.drawText(`[${ts} UTC]  ${log.event_type}`, { x: M + 8, y, size: 8, font: fontBold, color: rgb(0.2, 0.2, 0.2) });
        y -= 13;
        if (log.details) {
          const det = typeof log.details === 'string' ? log.details : JSON.stringify(log.details);
          page.drawText(det.slice(0, 90), { x: M + 20, y, size: 7.5, font, color: rgb(0.45, 0.45, 0.45) });
          y -= 13;
        }
      }
    }

    page.drawLine({ start: { x: M, y: 50 }, end: { x: W - M, y: 50 }, thickness: 0.5, color: rgb(0.8, 0.8, 0.8) });
    page.drawText('Este documento es un registro legal generado automáticamente por Asiste Health Care.', { x: M, y: 36, size: 8, font, color: rgb(0.5, 0.5, 0.5) });
    page.drawText(`Generado el: ${fmtDate(new Date())}`, { x: M, y: 24, size: 8, font, color: rgb(0.5, 0.5, 0.5) });
  }

  // ===== PÁGINAS 3+: ERSD =====
  {
    let page = pdfDoc.addPage([W, H]);
    let y = H - 40;

    // Header ERSD
    page.drawRectangle({ x: 0, y: H - 90, width: W, height: 90, color: rgb(0.12, 0.23, 0.37) });
    page.drawText('ELECTRONIC RECORD AND SIGNATURE DISCLOSURE', { x: M, y: H - 38, size: 13, font: fontBold, color: rgb(1, 1, 1) });
    page.drawText('Asiste Health Care · Asiste Health Care', { x: M, y: H - 62, size: 10, font, color: rgb(0.7, 0.85, 1) });
    y = H - 108;

    const addFooter = () => {
      page.drawLine({ start: { x: M, y: 44 }, end: { x: W - M, y: 44 }, thickness: 0.5, color: rgb(0.8, 0.8, 0.8) });
      page.drawText('Electronic Record and Signature Disclosure · Asiste Health Care · Asiste Health Care', { x: M, y: 30, size: 7, font, color: rgb(0.6, 0.6, 0.6) });
    };

    const checkPage = (space = 30) => {
      if (y < 60 + space) {
        addFooter();
        page = pdfDoc.addPage([W, H]);
        y = H - M;
      }
    };

    const writeLine = (text, opts = {}) => {
      const { fontSize = 9.5, bold = false, indent = 0, color: c = rgb(0.1, 0.1, 0.1) } = opts;
      const f = bold ? fontBold : font;
      const lines = wrapText(text, CW - indent, f, fontSize);
      for (const line of lines) {
        checkPage(fontSize + 5);
        page.drawText(line, { x: M + indent, y, size: fontSize, font: f, color: c });
        y -= fontSize + 4;
      }
    };

    const writeParagraph = (text, opts = {}) => { writeLine(text, opts); y -= 8; };

    const writeHeading = (text) => {
      checkPage(40);
      y -= 8;
      page.drawText(text, { x: M, y, size: 11, font: fontBold, color: rgb(0, 0, 0) });
      y -= 18;
    };

    // Meta
    const sentDate = sig.sent_at ? new Date(sig.sent_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : 'N/A';
    writeLine(`Disclosure created: ${sentDate}`, { fontSize: 8.5, color: rgb(0.4, 0.4, 0.4) });
    if (sig.signer_name) writeLine(`The parties agree: ${sig.signer_name}`, { fontSize: 8.5, color: rgb(0.4, 0.4, 0.4) });
    y -= 14;

    writeParagraph('From time to time, Asiste Health Care (we, us or Company) may be required by law to provide to you certain written notices or disclosures. Described below are the terms and conditions for providing to you such notices and disclosures electronically through the Asiste Health Care system. Please read the information below carefully and thoroughly, and if you can access this information electronically to your satisfaction and agree to this Electronic Record and Signature Disclosure (ERSD), please confirm your agreement by selecting the check-box next to "I agree to use electronic records and signatures" before signing your document.');

    writeHeading('Getting paper copies');
    writeParagraph('At any time, you may request from us a paper copy of any record provided or made available electronically to you by us. You will have the ability to download and print documents we send to you through the Asiste Health Care system during and immediately after the signing session. After the signing session, if you wish for us to send you paper copies of any such documents, please contact us using the information provided below.');

    writeHeading('Withdrawing your consent');
    writeParagraph('If you decide to receive notices and disclosures from us electronically, you may at any time change your mind and tell us that thereafter you want to receive required notices and disclosures only in paper format. How you must inform us of your decision to receive future notices and disclosure in paper format and withdraw your consent to receive notices and disclosures electronically is described below.');

    writeHeading('Consequences of changing your mind');
    writeParagraph('If you elect to receive required notices and disclosures only in paper format, it will slow the speed at which we can complete certain steps in transactions with you and delivering services to you because we will need first to send the required notices or disclosures to you in paper format, and then wait until we receive back from you your acknowledgment of your receipt of such paper notices or disclosures. Further, you will no longer be able to use the Asiste Health Care system to receive required notices and consents electronically from us or to sign electronically documents from us.');

    writeHeading('All notices and disclosures will be sent to you electronically');
    writeParagraph('Unless you tell us otherwise in accordance with the procedures described herein, we will provide electronically to you through the Asiste Health Care system all required notices, disclosures, authorizations, acknowledgements, and other documents that are required to be provided or made available to you during the course of our relationship with you. To reduce the chance of you inadvertently not receiving any notice or disclosure, we prefer to provide all of the required notices and disclosures to you by the same method and to the same address that you have given us. Thus, you can receive all the disclosures and notices electronically or in paper format through the paper mail delivery system. If you do not agree with this process, please let us know as described below.');

    writeHeading('How to contact Asiste Health Care');
    writeParagraph('You may contact us to let us know of your changes as to how we may contact you electronically, to request paper copies of certain information from us, and to withdraw your prior consent to receive notices and disclosures electronically as follows:');
    writeParagraph('Asiste Health Care', { bold: true });
    writeLine('5345 SW 34TH AVE, Fort Lauderdale, FL 33312');
    writeLine('EIN: 93-3452400');
    writeParagraph('To contact us by email send messages to: admin@asistehealth.com');

    writeHeading('To advise Asiste Health Care of your new email address');
    writeParagraph('To let us know of a change in your email address, you must send an email message to us at admin@asistehealth.com stating: your previous email address and your new email address. We do not require any other information from you to change your email address.');

    writeHeading('To request paper copies from Asiste Health Care');
    writeParagraph('To request delivery of paper copies of the notices and disclosures previously provided electronically, you must send us an email to admin@asistehealth.com stating your email address, full name, mailing address, and telephone number.');

    writeHeading('To withdraw your consent with Asiste Health Care');
    writeParagraph('To inform us that you no longer wish to receive future notices and disclosures in electronic format you may:');
    writeParagraph('i. Decline to sign a document from within your signing session, or you may;', { indent: 15 });
    writeParagraph('ii. Send us an email to admin@asistehealth.com stating your email, full name, mailing address, and telephone number. Mailing address: 5345 SW 34TH AVE, Fort Lauderdale, FL 33312. The consequences of your withdrawing consent for online documents will be that transactions may take a longer time to process.', { indent: 15 });

    writeHeading('Required hardware and software');
    writeParagraph('To access and retain the disclosures and notices electronically, you will need: a device (computer, tablet, or smartphone) with internet access, a current web browser with JavaScript enabled, and the ability to receive email or WhatsApp messages. Recommended browsers: Chrome 90+, Safari 14+, Firefox 88+, or Edge 90+.');

    writeHeading('Acknowledging your access and consent to receive and sign documents electronically');
    writeParagraph('To confirm to us that you can access this information electronically, which will be similar to other electronic notices and disclosures that we will provide to you, please confirm that you have read this ERSD, and (i) that you are able to print on paper or electronically save this ERSD for your future reference and access; or (ii) that you are able to email this ERSD to an email address where you will be able to print on paper or save it for your future reference and access. Further, if you consent to receiving notices and disclosures exclusively in electronic format as described herein, then select the check-box next to "I agree to use electronic records and signatures" before signing your document.');

    writeParagraph('By selecting the check-box next to "I agree to use electronic records and signatures", you confirm that:');
    writeParagraph('• You can access and read this Electronic Record and Signature Disclosure; and', { indent: 15 });
    writeParagraph('• You can print on paper this Electronic Record and Signature Disclosure, or save or send this Electronic Record and Disclosure to a location where you can print it, for future reference and access; and', { indent: 15 });
    writeParagraph('• Until or unless you notify Asiste Health Care as described above, you consent to receive exclusively through electronic means all notices, disclosures, authorizations, acknowledgements, and other documents that are required to be provided or made available to you by Asiste Health Care during the course of your relationship with Asiste Health Care.', { indent: 15 });

    addFooter();
  }

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
