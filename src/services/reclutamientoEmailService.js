const transporter = require('../config/reclutamientoEmail');

// Correo con el link de firma para el candidato. Sin más datos que el nombre — mismo criterio
// minimalista que ya usa hrEmailService.js. Usa el transporter propio del módulo (ver
// config/reclutamientoEmail.js), NO config/email.js ni config/npnEmail.js.
async function sendReclutamientoEmail({ candidateEmail, candidateName, token }) {
  const signingUrl = `${process.env.APP_URL}/firmar-reclutamiento/${token}`;

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
            <h1 style="color:#fff;margin:0;font-size:26px;font-weight:700;">Asiste ING</h1>
            <p style="color:#93c5fd;margin:6px 0 0;font-size:14px;">Proceso de Reclutamiento y Selección</p>
          </td>
        </tr>
        <tr>
          <td style="padding:40px;">
            <p style="font-size:15px;color:#374151;line-height:1.6;margin:0 0 8px;">Hola ${candidateName},</p>
            <p style="font-size:15px;color:#6b7280;line-height:1.6;margin:0 0 24px;">
              Completaste tu formulario del proceso de selección. Ahora necesitamos que revises tu
              <strong>hoja de vida</strong> y el <strong>tratamiento de datos personales</strong>, y los firmes
              digitalmente para continuar con el proceso.
            </p>
            <div style="text-align:center;margin:0 0 32px;">
              <a href="${signingUrl}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:14px 40px;border-radius:8px;font-size:16px;font-weight:600;">
                Revisar y Firmar
              </a>
            </div>
            <p style="font-size:12px;color:#9ca3af;text-align:center;margin:0;">
              Si no puedes hacer clic en el botón, copia este enlace en tu navegador:<br>
              <span style="color:#2563eb;">${signingUrl}</span>
            </p>
          </td>
        </tr>
        <tr>
          <td style="background:#f9fafb;padding:20px 40px;text-align:center;border-top:1px solid #e5e7eb;">
            <p style="font-size:12px;color:#9ca3af;margin:0;">Este es un mensaje automático, por favor no responder a este correo.</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = `Hola ${candidateName},\n\nCompletaste tu formulario del proceso de selección. Revisa y firma tu hoja de vida y el tratamiento de datos personales en:\n${signingUrl}\n\nAsiste ING`;

  await transporter.sendMail({
    from: process.env.RECLUTAMIENTO_EMAIL_FROM || process.env.RECLUTAMIENTO_SMTP_USER,
    to: candidateEmail,
    subject: 'Firma tu hoja de vida y tratamiento de datos — Asiste ING',
    html,
    text,
  });
}

module.exports = { sendReclutamientoEmail };
