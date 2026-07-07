const path = require('path');
const transporter = require('../config/email');

const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQAABjE+ibYAAAAASUVORK5CYII=',
  'base64'
);

async function sendCartaFormulario({ clientName, clientEmail, token, requestId, cartaPath, npnName }) {
  const formularioUrl = `${process.env.APP_URL}/formulario/${token}`;
  const pixelUrl      = `${process.env.API_URL}/api/tracking/${requestId}/pixel.png`;
  const docName       = path.basename(cartaPath);

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#f4f7f9;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f7f9;padding:24px 12px;">
<tr><td align="center">
<table width="620" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,.10);">

  <tr>
    <td style="background:linear-gradient(135deg,#1e3a5f 0%,#2563eb 100%);padding:20px 32px;">
      <p style="margin:0;color:#93c5fd;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;">Aseguradora Oscar</p>
      <h1 style="margin:4px 0 0;color:#fff;font-size:19px;font-weight:700;">Actualización Urgente de Datos</h1>
    </td>
  </tr>

  <tr>
    <td style="padding:28px 32px 0;">
      <p style="margin:0 0 16px;font-size:16px;color:#111827;">Estimado/a <strong>${clientName}</strong>,</p>
      <p style="margin:0 0 14px;font-size:14px;color:#374151;line-height:1.8;">
        Nos comunicamos con usted de parte de la <strong>Aseguradora Oscar</strong> para informarle que,
        de acuerdo con nuestros registros, es necesario actualizar su información personal
        en nuestra base de datos de manera <strong>urgente</strong>.
      </p>
      <p style="margin:0 0 14px;font-size:14px;color:#374151;line-height:1.8;">
        Esta actualización es <strong>obligatoria</strong> para garantizar la continuidad de su cobertura
        y el correcto procesamiento de los beneficios de su póliza.
        Le recordamos que <strong>${npnName || 'su agente'}</strong> está disponible para
        acompañarle en este proceso.
      </p>
      <p style="margin:0 0 20px;font-size:14px;color:#374151;line-height:1.8;">
        Adjunto a este correo encontrará el <strong>comunicado oficial completo</strong>.
        Le pedimos leerlo detenidamente antes de proceder.
        Los enlaces que aparecen dentro del PDF son <strong>completamente accesibles con un solo clic</strong>.
      </p>
    </td>
  </tr>

  <tr>
    <td style="padding:0 32px 20px;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#fefce8;border:1px solid #fde047;border-radius:6px;">
        <tr>
          <td style="padding:12px 16px;">
            <p style="margin:0;font-size:13px;color:#854d0e;">
              &#9200; <strong>Este enlace expira en 72 horas.</strong>&nbsp; Es de uso &uacute;nico y personal.
            </p>
          </td>
        </tr>
      </table>
    </td>
  </tr>

  <tr>
    <td style="padding:0 32px 12px;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f4ff;border:1px solid #c7d2fe;border-radius:8px;">
        <tr>
          <td style="padding:14px 18px;">
            <p style="margin:0 0 6px;font-size:13px;color:#3730a3;font-weight:700;">&#128196;&nbsp; Comunicado adjunto</p>
            <p style="margin:0;font-size:13px;color:#4338ca;line-height:1.6;">
              Abra el archivo <strong>${docName}</strong> adjunto a este correo para leer el comunicado completo.
              Una vez le&iacute;do, regrese aqu&iacute; y haga clic en el bot&oacute;n de abajo para actualizar sus datos.
            </p>
          </td>
        </tr>
      </table>
    </td>
  </tr>

  <tr>
    <td style="padding:20px 32px 32px;text-align:center;">
      <a href="${formularioUrl}"
         style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;
                padding:16px 52px;border-radius:8px;font-size:16px;font-weight:700;
                box-shadow:0 4px 12px rgba(37,99,235,.35);">
        &#128203;&nbsp; Actualizar mis datos
      </a>
      <p style="font-size:11px;color:#9ca3af;margin:14px 0 0;">
        Si el bot&oacute;n no funciona, copie este enlace en su navegador:<br>
        <a href="${formularioUrl}" style="color:#2563eb;word-break:break-all;">${formularioUrl}</a>
      </p>
    </td>
  </tr>

  <tr>
    <td style="background:#f9fafb;padding:14px 32px;text-align:center;border-top:1px solid #e5e7eb;">
      <p style="font-size:11px;color:#9ca3af;margin:0;">
        Este mensaje fue enviado por <strong>Asiste Health Care</strong> en nombre de la <strong>Aseguradora Oscar</strong> &middot;
        <a href="mailto:soporte@asistehealth.com" style="color:#2563eb;">soporte@asistehealth.com</a>
      </p>
      <img src="${pixelUrl}" width="1" height="1" alt="" style="border:0;display:block;margin:4px auto 0;" />
    </td>
  </tr>

</table>
</td></tr>
</table>
</body>
</html>`;

  const text = [
    `Estimado/a ${clientName},`,
    '',
    `Nos comunicamos con usted de parte de la Aseguradora Oscar para informarle que es necesario actualizar su información personal de manera urgente.`,
    '',
    `Adjunto a este correo encontrará el comunicado oficial completo. Los enlaces del PDF son accesibles con un solo clic.`,
    '',
    `Una vez leído el comunicado, haga clic en el siguiente enlace para actualizar sus datos (válido 72 horas):`,
    formularioUrl,
    '',
    `Asiste Health Care — soporte@asistehealth.com`,
  ].join('\n');

  await transporter.sendMail({
    from:    `"${process.env.SMTP_FROM_NAME}" <${process.env.SMTP_FROM_EMAIL}>`,
    to:      clientEmail,
    subject: `URGENTE: Actualización de datos requerida — Aseguradora Oscar`,
    text,
    html,
    attachments: [{ filename: docName, path: cartaPath }],
  });
}

module.exports = { sendCartaFormulario, PIXEL_PNG };
