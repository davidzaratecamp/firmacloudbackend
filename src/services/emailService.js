const transporter = require('../config/email');
const vitalTransporter = require('../config/vitalEmail');

async function sendSignatureRequest({ clientName, clientEmail, token, documentName, agentName }) {
  const signingUrl = `${process.env.APP_URL}/firmar/${token}`;

  const html = `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f4f7f9;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f7f9;padding:40px 20px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
        <tr>
          <td style="background:linear-gradient(135deg,#1e3a5f,#2563eb);padding:36px 40px;text-align:center;">
            <h1 style="color:#fff;margin:0;font-size:28px;font-weight:700;">Asiste Health Care</h1>
            <p style="color:#93c5fd;margin:6px 0 0;font-size:14px;">Firma Digital de Documentos</p>
          </td>
        </tr>
        <tr>
          <td style="padding:40px;">
            <p style="font-size:16px;color:#374151;margin:0 0 16px;">Estimado/a <strong>${clientName}</strong>,</p>
            <p style="font-size:15px;color:#6b7280;line-height:1.6;margin:0 0 24px;">
              ${agentName} de <strong>Asiste Health Care</strong> le ha enviado el documento
              <strong>"${documentName}"</strong> para que lo revise y firme digitalmente.
            </p>
            <div style="background:#f0f9ff;border-left:4px solid #2563eb;padding:16px 20px;border-radius:0 8px 8px 0;margin:0 0 32px;">
              <p style="margin:0;color:#1e40af;font-size:14px;font-weight:600;">Este enlace expira en 72 horas</p>
              <p style="margin:4px 0 0;color:#3b82f6;font-size:13px;">Por seguridad, el enlace de firma es de un solo uso.</p>
            </div>
            <div style="text-align:center;margin:0 0 32px;">
              <a href="${signingUrl}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:14px 40px;border-radius:8px;font-size:16px;font-weight:600;">
                Revisar y Firmar Documento
              </a>
            </div>
            <p style="font-size:12px;color:#9ca3af;text-align:center;margin:0;">
              Si no puede hacer clic en el botón, copie este enlace en su navegador:<br>
              <span style="color:#2563eb;">${signingUrl}</span>
            </p>
          </td>
        </tr>
        <tr>
          <td style="background:#f9fafb;padding:20px 40px;text-align:center;border-top:1px solid #e5e7eb;">
            <p style="font-size:12px;color:#9ca3af;margin:0;">
              Este correo fue enviado por Asiste Health Care<br>
              Si tiene dudas, contáctenos en soporte@asistehealth.com
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = `Estimado/a ${clientName},\n\n${agentName} de Asiste Health Care le ha enviado el documento "${documentName}" para que lo revise y firme digitalmente.\n\nAcceda al siguiente enlace para firmar (válido por 72 horas):\n${signingUrl}\n\nEste enlace es de un solo uso.\n\nAsiste Health Care\nsoporte@asistehealth.com`;

  await transporter.sendMail({
    from: `"${process.env.SMTP_FROM_NAME}" <${process.env.SMTP_FROM_EMAIL}>`,
    to: clientEmail,
    subject: `Documento pendiente de firma: ${documentName}`,
    text,
    html,
  });
}

// Módulo Vital — Firma Tratamiento de Datos: mismo texto/branding que la plantilla de
// WhatsApp aprobada en Meta ("vital_health_insurance"), para que el cliente reciba el mismo
// mensaje sin importar el canal. `sendDocumentWithData` es exclusiva de Vital, así que esta
// función reemplaza a `sendSignatureRequest` ahí sin condicional (igual que sendVitalWhatsApp
// reemplazó a sendSignatureWhatsApp).
async function sendVitalSignatureRequest({ clientName, clientEmail, token }) {
  const signingUrl = `${process.env.APP_URL}/firmar/${token}`;

  const html = `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f4f7f9;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f7f9;padding:40px 20px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
        <tr>
          <td style="background:linear-gradient(135deg,#1e3a5f,#2563eb);padding:36px 40px;text-align:center;">
            <h1 style="color:#fff;margin:0;font-size:28px;font-weight:700;">Vital Health Insurance</h1>
            <p style="color:#93c5fd;margin:6px 0 0;font-size:14px;">Firma Digital de Documentos</p>
          </td>
        </tr>
        <tr>
          <td style="padding:40px;">
            <p style="font-size:16px;color:#374151;margin:0 0 16px;">Estimado(a) <strong>${clientName}</strong>,</p>
            <p style="font-size:15px;color:#6b7280;line-height:1.6;margin:0 0 16px;">
              Desde <strong>Vital Health Insurance</strong> le hacemos llegar el documento de autorización
              para el tratamiento de sus datos personales, necesario para continuar con el proceso de su
              solicitud de seguro médico.
            </p>
            <p style="font-size:15px;color:#6b7280;line-height:1.6;margin:0 0 24px;">
              Puede revisarlo y firmarlo digitalmente dando clic en el botón de abajo.
            </p>
            <div style="background:#f0f9ff;border-left:4px solid #2563eb;padding:16px 20px;border-radius:0 8px 8px 0;margin:0 0 32px;">
              <p style="margin:0;color:#1e40af;font-size:14px;font-weight:600;">Este enlace expira en 72 horas</p>
              <p style="margin:4px 0 0;color:#3b82f6;font-size:13px;">Por seguridad, el enlace de firma es de un solo uso.</p>
            </div>
            <div style="text-align:center;margin:0 0 32px;">
              <a href="${signingUrl}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:14px 40px;border-radius:8px;font-size:16px;font-weight:600;">
                Firma Digital
              </a>
            </div>
            <p style="font-size:15px;color:#6b7280;line-height:1.6;margin:0 0 4px;">
              Quedamos atentos ante cualquier consulta.
            </p>
            <p style="font-size:15px;color:#374151;line-height:1.6;margin:0;">
              Saludos cordiales,<br>Equipo Vital Health Insurance
            </p>
            <p style="font-size:12px;color:#9ca3af;text-align:center;margin:32px 0 0;">
              Si no puede hacer clic en el botón, copie este enlace en su navegador:<br>
              <span style="color:#2563eb;">${signingUrl}</span>
            </p>
          </td>
        </tr>
        <tr>
          <td style="background:#f9fafb;padding:20px 40px;text-align:center;border-top:1px solid #e5e7eb;">
            <p style="font-size:12px;color:#9ca3af;margin:0;">
              Este correo fue enviado por Vital Health Insurance
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = `Estimado(a) ${clientName},\n\nDesde Vital Health Insurance le hacemos llegar el documento de autorización para el tratamiento de sus datos personales, necesario para continuar con el proceso de su solicitud de seguro médico.\n\nPuede revisarlo y firmarlo digitalmente en el siguiente enlace (válido por 72 horas, un solo uso):\n${signingUrl}\n\nQuedamos atentos ante cualquier consulta.\n\nSaludos cordiales,\nEquipo Vital Health Insurance`;

  await vitalTransporter.sendMail({
    from: `"${process.env.VITAL_SMTP_FROM_NAME || 'Vital Health Insurance'}" <${process.env.VITAL_SMTP_FROM_EMAIL || process.env.VITAL_SMTP_USER}>`,
    to: clientEmail,
    subject: 'Documento de autorización para el tratamiento de sus datos personales',
    text,
    html,
  });
}

module.exports = { sendSignatureRequest, sendVitalSignatureRequest };
