# Integración API — Módulo Vital (Firma Tratamiento de Datos)

Guía para que el equipo de la intranet **Vital** integre el envío de documentos de firma electrónica a través de la API de FirmaCloud. Esta integración es independiente de cualquier otra intranet conectada a FirmaCloud (por ejemplo, la intranet de ObamaCare/Asiste Health Care) — usa su propia credencial, que nunca debe compartirse ni reutilizarse entre sistemas.

- **Base URL**: `https://firmahealthcare.com/api`
- **Formato**: JSON sobre HTTPS.
- **Documento que se envía**: `Carta CMS Vital.pdf` — un formulario de consentimiento CMS de 3 páginas (agente, contacto del hogar, datos del plan, y firma).

---

## 1. Autenticación

Todas las peticiones llevan el header:

```
X-Api-Key: 68d7766da344ae61c49f5e65efb7ae1c813e6547dccb74cd6ece8370e87dc54e
```

Esta clave es exclusiva de la intranet Vital — la genera y entrega el equipo de FirmaCloud (`openssl rand -hex 32`, o equivalente). **No es la misma clave que usa ninguna otra intranet conectada a FirmaCloud**; si en algún momento se necesita rotarla, eso no afecta a ningún otro sistema integrado.

Una key inválida o ausente devuelve:

```json
// 401 Unauthorized
{ "error": "API key inválida" }
```

---

## 2. Enviar un documento para firma

```
POST /api/signatures/send-with-data
Content-Type: application/json
X-Api-Key: 68d7766da344ae61c49f5e65efb7ae1c813e6547dccb74cd6ece8370e87dc54e
```

### Body

```json
{
  "clientName":   "Silvia Reyes Vilchis",
  "clientEmail":  "cliente@email.com",
  "clientPhone":  "+13001234567",
  "sendChannel":  "email",
  "agentName":    "Luis Vitier",
  "agentCedula":  "18771778",
  "webhookUrl":   "https://tu-intranet.com/api/webhooks/firmacloud",
  "ventaId":      "4521",

  "documentData": {
    "vital": {
      "clientName":             "Silvia Reyes Vilchis",
      "agentName":               "Luis Vitier",
      "agentNPN":                "18771778",
      "agentPhone":              "+1(786) 227-3915",
      "agentEmail":              "luis.vitier@ejemplo.com",
      "householdContactName":   "Silvia Reyes Vilchis",
      "householdContactPhone":  "6783687620",
      "householdContactEmail":  "silvia.reyes@ejemplo.com",
      "taxes":                   "30.09",
      "company":                 "OSCAR",
      "plan":                    "HMO",
      "monthlyPay":              "122.47",
      "deductible":              "8000",
      "gd":                      "3",
      "pd":                      "0",
      "sd":                      "50%"
    }
  }
}
```

> **⚠️ Canal `whatsapp` / `both` — todavía no disponible (2026-09-17).** El número de WhatsApp Business dedicado a Vital (`+1 307-357-2609`) y su plantilla de mensaje (`vital_health_insurance`) están en revisión/aprobación en Meta. Mientras no queden Aprobados/Conectados, cualquier envío con `sendChannel: "whatsapp"` o `"both"` devuelve `503 WHATSAPP_UNAVAILABLE` (ver tabla de errores abajo) — **no es un error de tu integración**. Usa `sendChannel: "email"` para todas las pruebas hasta que el equipo de FirmaCloud confirme que WhatsApp ya está activo.

### Campos de la raíz

| Campo | Requerido | Descripción |
|---|---|---|
| `clientName` | Sí | Nombre completo del cliente que va a firmar |
| `clientEmail` | Si `sendChannel` es `email` o `both` | Email del cliente |
| `clientPhone` | Si `sendChannel` es `whatsapp` o `both` | Teléfono con código de país (ej. `+13001234567`) — **canal aún no disponible, ver nota arriba** |
| `sendChannel` | No (default `email`) | `email` \| `whatsapp` \| `both` — usa `email` por ahora |
| `agentName` | Sí (llamando con API key) | Nombre del agente que envía |
| `agentCedula` | Sí (llamando con API key) | Identificador/cédula del agente |
| `webhookUrl` | No, pero muy recomendado | URL propia donde recibir los eventos de estado (ver sección 4) |
| `ventaId` | No | Identificador interno de Vital para esta venta/trámite, se guarda como referencia pero no se usa en el PDF |
| `documentData.vital` | **Sí** | Los datos que se llenan en el PDF — ver tabla abajo |

### Campos de `documentData.vital`

| Campo | Tipo | Notas |
|---|---|---|
| `clientName` | texto | Nombre del cliente. Si se omite, se usa el `clientName` de la raíz — pero se recomienda enviarlo explícito aquí también |
| `agentName` | texto | Nombre del agente. Si se omite, se usa el `agentName` de la raíz |
| `agentNPN` | texto | Número de productor (NPN) del agente |
| `agentPhone` | texto | Teléfono del agente |
| `agentEmail` | texto | Email del agente |
| `householdContactName` | texto | Nombre del contacto principal del hogar (puede ser el mismo cliente) |
| `householdContactPhone` | texto | Teléfono de ese contacto |
| `householdContactEmail` | texto | Email de ese contacto |
| `taxes` | **numérico** | Solo el número, ej. `"30.09"` — el PDF le antepone el signo `$` automáticamente, **no lo incluyas en el valor** |
| `company` | texto | Aseguradora/compañía del plan |
| `plan` | texto | Tipo de plan (ej. `"HMO"`) |
| `monthlyPay` | **numérico** | Igual que `taxes`, sin `$` |
| `deductible` | **numérico** | Igual que `taxes`, sin `$` |
| `gd` | **numérico** | Igual que `taxes`, sin `$` |
| `pd` | **numérico** | Igual que `taxes`, sin `$` |
| `sd` | texto/porcentaje | **Este sí lleva el `%` incluido**, ej. `"50%"` — es la única excepción, el PDF no le agrega nada |

Cualquier campo que no envíes (o mandes vacío) simplemente no se dibuja en el documento — no genera error.

### Respuesta (201 Created)

```json
{
  "id": "6f1a2e3d-...-uuid",
  "status": "pending",
  "message": "Documento enviado por correo electrónico"
}
```

Guarda el `id` — es el identificador que usarás para consultar el estado o descargar el documento firmado (secciones 5 y 6).

### Errores posibles

| Código | Cuándo |
|---|---|
| `400` | Falta `clientName`, `documentData.vital`, `agentName`/`agentCedula`, o el email/teléfono no es válido para el canal elegido |
| `401` | `X-Api-Key` inválida o ausente |
| `503` | `EMAIL_UNAVAILABLE` o `WHATSAPP_UNAVAILABLE` — no se pudo enviar por el canal elegido en ese momento; no se creó el registro, se puede reintentar. **`WHATSAPP_UNAVAILABLE` es esperado hasta que Meta apruebe el número/plantilla de Vital** (ver nota arriba) — no reintentar en loop por este canal hasta recibir confirmación de FirmaCloud |

### Contenido del mensaje que recibe el cliente

FirmaCloud arma el mensaje (correo y, cuando esté disponible, WhatsApp) con branding **"Vital Health Insurance"** y el mismo texto en ambos canales: agradece/explica que el documento es la autorización de tratamiento de datos personales necesaria para continuar con la solicitud de seguro médico, e incluye un botón/enlace **"Firma Digital"** hacia el formulario. No es configurable por la intranet — el body de la petición solo controla los datos que se llenan en el PDF, no el copy del mensaje de invitación a firmar.

---

## 3. Qué NO tiene este documento

- **No genera sumario/certificado.** A diferencia de otros documentos de FirmaCloud, `Carta CMS Vital.pdf` no produce un PDF de evidencia/certificado aparte — el propio documento firmado ya incluye fecha, IP, ubicación y coordenadas del firmante en su última página. `GET /:id/certificate` devuelve `400` para estos documentos; no lo llames para IDs generados por este endpoint.
- **Enlace de firma**: válido por 72 horas, un solo uso.

---

## 4. Webhooks (recomendado)

Si mandas `webhookUrl` al enviar el documento, FirmaCloud hace `POST` a esa URL cuando el estado del documento cambia — así no tienes que hacer polling constante a la API.

### Eventos

| `event` | Cuándo se dispara |
|---|---|
| `document.viewed` | El cliente abrió el enlace por primera vez |
| `document.signed` | El cliente completó la firma |
| `document.expired` | Pasaron 72 horas sin que el cliente firmara |

### Payload — `document.viewed` / `document.expired`

```json
{
  "event": "document.viewed",
  "id": "6f1a2e3d-...-uuid",
  "clientName": "Silvia Reyes Vilchis",
  "clientEmail": "cliente@email.com",
  "clientPhone": "+13001234567",
  "documentName": "vital-firma-tratamiento-datos.pdf",
  "viewedAt": "2026-09-17T14:32:10.000Z"
}
```

(`document.expired` trae `expiredAt` en vez de `viewedAt`, mismo resto de campos.)

### Payload — `document.signed`

```json
{
  "event": "document.signed",
  "id": "6f1a2e3d-...-uuid",
  "clientName": "Silvia Reyes Vilchis",
  "clientEmail": "cliente@email.com",
  "clientPhone": "+13001234567",
  "documentName": "vital-firma-tratamiento-datos.pdf",
  "signerName": "Silvia Reyes Vilchis",
  "signerIp": "172.56.70.91",
  "signerDevice": "Móvil",
  "signedAt": "2026-09-17T15:01:44.000Z",
  "downloadUrl": "https://firmahealthcare.com/api/signatures/6f1a2e3d-...-uuid/download"
}
```

### Verificar la firma del webhook

Cada request de webhook trae dos headers:

```
X-FirmaCloud-Event: document.signed
X-FirmaCloud-Signature: <hmac-sha256 hex>
```

`X-FirmaCloud-Signature` es un HMAC-SHA256 del **cuerpo exacto del POST** (el JSON tal cual se envía, sin reformatear), firmado con **tu propia `VITAL_API_KEY`** — la misma que usas en `X-Api-Key`. Para verificar en tu servidor:

```js
const crypto = require('crypto');

function isValidSignature(rawBody, signatureHeader, vitalApiKey) {
  const expected = crypto.createHmac('sha256', vitalApiKey).update(rawBody).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader));
}
```

Importante: `rawBody` debe ser el **cuerpo crudo** del request (antes de `JSON.parse`), no un objeto reconstruido — cualquier diferencia de formato (espacios, orden de llaves) invalida la comparación.

Si el webhook falla (tu servidor no responde, timeout, error 5xx), FirmaCloud no reintenta automáticamente — usa la consulta de estado (sección 5) como respaldo si necesitas garantías más fuertes.

---

## 5. Consultar el estado de un documento

```
GET /api/signatures/:id
X-Api-Key: 68d7766da344ae61c49f5e65efb7ae1c813e6547dccb74cd6ece8370e87dc54e
```

Devuelve el registro completo, incluyendo `status` (`pending` | `viewed` | `signed` | `expired` | `failed`), fechas (`sent_at`, `viewed_at`, `signed_at`), y datos del firmante una vez firmado (`signer_name`, `signer_ip`, `signer_device`, `signer_geolocation`). No requiere `webhookUrl` — puedes usarlo independientemente o como respaldo del webhook.

---

## 6. Descargar el documento firmado

```
GET /api/signatures/:id/download
X-Api-Key: 68d7766da344ae61c49f5e65efb7ae1c813e6547dccb74cd6ece8370e87dc54e
```

Devuelve el PDF firmado (`Content-Type: application/pdf`) una vez que el estado es `signed`. Si todavía no se firmó, responde `400 { "error": "Documento aún no firmado" }`.

---

## 7. Checklist de puesta en marcha (lado FirmaCloud)

### Para el canal `email` (disponible ya)

1. Correr `database/migration_vital_intranet.sql` (crea el usuario sistema `sistema.vital@firmahealthcare.com`).
2. ✅ `VITAL_API_KEY` ya generada (2026-09-17) y puesta en el `.env` del backend — es la que aparece en la sección 1 de este documento.
3. Consultar el id real del agente sistema (`SELECT id FROM agents WHERE email = 'sistema.vital@firmahealthcare.com';`) y ponerlo en `VITAL_AGENT_ID` (pendiente — la migración del paso 1 todavía no se ha corrido).
4. Reiniciar el backend para que tome las nuevas variables de entorno.
5. **Este documento ya incluye la `VITAL_API_KEY` real** (sección 1) — trátalo como confidencial a partir de aquí: no lo subas a un repositorio público ni lo reenvíes por canales sin control de acceso. Si la key se rota en el futuro, actualizar este documento también.

### Para el canal `whatsapp` / `both` (bloqueado hasta que Meta apruebe)

6. Esperar a que en el Business Manager de Meta el número `+1 307-357-2609` quede **Conectado/verificado** y la plantilla `vital_health_insurance` quede **Aprobada** (portafolio "Asiste Health Care").
7. Confirmar cómo quedó configurado en Meta el botón de la plantilla ("Visitar sitio web dinámico") — FirmaCloud asume `sub_type: url` con el token de firma como sufijo dinámico de la URL base configurada en el template.
8. Una vez aprobados ambos, poner en el `.env` del backend: `VITAL_WHATSAPP_ACCESS_TOKEN` (token permanente de System User con permiso sobre ese número), `VITAL_WHATSAPP_PHONE_NUMBER_ID` (el ID interno de Meta del número, no el número en sí), `VITAL_WHATSAPP_TEMPLATE_NAME=vital_health_insurance` y `VITAL_WHATSAPP_TEMPLATE_LANG` (el código de idioma exacto con el que quedó registrada la plantilla en Meta).
9. Reiniciar el backend. A partir de ahí, `sendChannel: "whatsapp"`/`"both"` funcionan sin más cambios de código ni de contrato de API — el body que manda la intranet no cambia.
10. Avisar al equipo de Vital que ya pueden probar `whatsapp`/`both` — hasta entonces, deben seguir usando `email`.

Ver `claude/planObamaCareFirmaTratamiento.md` (repo `firmacloudbackend`) para el detalle técnico completo del módulo, coordenadas de la plantilla, y el historial de decisiones detrás de este contrato de API.
