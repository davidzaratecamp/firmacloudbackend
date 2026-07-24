const transporter = require('../config/email');

// Sin nombre del destinatario ni ningún otro dato — solo el enlace de firma.
async function sendContractEmail({ recipientEmail, token, documentName }) {
  const signingUrl = `${process.env.APP_URL}/firmar-contrato/${token}`;

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
            <p style="color:#93c5fd;margin:6px 0 0;font-size:14px;">Recursos Humanos — Firma de Contrato</p>
          </td>
        </tr>
        <tr>
          <td style="padding:40px;">
            <p style="font-size:15px;color:#6b7280;line-height:1.6;margin:0 0 24px;">
              Se le ha enviado el documento <strong>"${documentName}"</strong> para que lo revise y firme digitalmente.
            </p>
            <div style="text-align:center;margin:0 0 32px;">
              <a href="${signingUrl}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:14px 40px;border-radius:8px;font-size:16px;font-weight:600;">
                Revisar y Firmar Contrato
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

  const text = `Se le ha enviado el documento "${documentName}" para que lo revise y firme digitalmente.\n\nAcceda al siguiente enlace para firmar:\n${signingUrl}\n\nAsiste Health Care\nsoporte@asistehealth.com`;

  await transporter.sendMail({
    from: `"${process.env.SMTP_FROM_NAME}" <${process.env.SMTP_FROM_EMAIL}>`,
    to: recipientEmail,
    subject: `Contrato para firmar: ${documentName}`,
    html,
    text,
  });
}

module.exports = { sendContractEmail };
