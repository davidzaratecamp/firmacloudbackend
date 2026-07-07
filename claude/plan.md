# Plan: Servicio Independiente — Carta Formulario con Tracking de Email

## Contexto

El sistema actual de FirmaCloud envía siempre el mismo PDF (`carta-tratamiento-de-datos.pdf`) para firma electrónica. Se necesita un **servicio completamente independiente** que:
1. Envíe una carta diferente (PDF fijo ya existente) por email/WhatsApp
2. El correo contenga un link a un formulario de captura de datos personales
3. El correo tenga un **pixel de tracking** para detectar cuando fue abierto (como el visto de WhatsApp)
4. Los datos del formulario se guarden en una **MySQL externa** (servidor diferente)
5. El tracking/metadata del envío se quede en la **MySQL interna** actual

**Restricción crítica:** No tocar la funcionalidad existente de firmas.

---

## Archivos a Crear (8 nuevos)

| Archivo | Propósito |
|---|---|
| `database/schema_forms.sql` | DDL para `form_requests` (BD interna) y `form_submissions` (BD externa) |
| `src/config/externalDatabase.js` | Pool mysql2 para BD externa (`EXT_DB_*` env vars) |
| `src/services/cartaEmailService.js` | Email HTML con link al formulario + pixel de tracking + adjunto del PDF |
| `src/controllers/cartaController.js` | Enviar carta, listar, detalle |
| `src/controllers/publicFormController.js` | Validar token, procesar envío del formulario |
| `src/routes/cartas.js` | Rutas protegidas (JWT/API-Key): `/api/cartas/send`, `/api/cartas/`, `/api/cartas/:id` |
| `src/routes/publicForm.js` | Rutas públicas: `GET /api/formulario/:token`, `POST /api/formulario/:token/submit` |
| `src/routes/tracking.js` | Pixel público: `GET /api/tracking/:id/pixel.png` |

## Archivos a Modificar (2, mínimamente)

| Archivo | Cambio |
|---|---|
| `src/app.js` | Agregar 3 `require` + 3 `app.use` al final, sin tocar líneas existentes |
| `.env.example` | Agregar bloque de variables nuevas al final |

---

## Esquema de Base de Datos

### BD Interna — tabla `form_requests`
```sql
CREATE TABLE form_requests (
  id                   VARCHAR(36)   NOT NULL PRIMARY KEY,      -- UUID
  agent_id             INT           NOT NULL,                   -- FK → agents
  client_name          VARCHAR(150)  NOT NULL,
  client_email         VARCHAR(150)  NULL,
  client_phone         VARCHAR(20)   NULL,
  send_channel         ENUM('email','whatsapp','both') DEFAULT 'email',
  carta_path           VARCHAR(500)  NOT NULL,
  token                CHAR(96)      NOT NULL UNIQUE,            -- generateSecureToken()
  token_expires_at     DATETIME      NOT NULL,
  status               ENUM('pending','email_opened','form_submitted','expired') DEFAULT 'pending',
  email_opened_at      DATETIME      NULL,
  email_open_ip        VARCHAR(45)   NULL,
  email_open_user_agent TEXT         NULL,
  form_submitted_at    DATETIME      NULL,
  sent_at              DATETIME      DEFAULT CURRENT_TIMESTAMP,
  sent_from_ip         VARCHAR(45)   NULL,
  webhook_url          VARCHAR(500)  NULL,
  created_at           TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_fr_agent FOREIGN KEY (agent_id) REFERENCES agents(id)
);
```

### BD Externa — tabla `form_submissions`
```sql
CREATE TABLE form_submissions (
  id                VARCHAR(36)  NOT NULL PRIMARY KEY,
  form_request_id   VARCHAR(36)  NOT NULL,   -- referencia lógica sin FK constraint
  name              VARCHAR(150) NOT NULL,
  phone             VARCHAR(20)  NOT NULL,
  email             VARCHAR(150) NOT NULL,
  postalcode        VARCHAR(20)  NOT NULL,
  created_at        TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_form_request_id (form_request_id)
);
```

---

## Pixel de Tracking (mecanismo)

- En el email HTML se embebe: `<img src="${API_URL}/api/tracking/${requestId}/pixel.png" width="1" height="1" style="display:none" />`
- `GET /api/tracking/:id/pixel.png` retorna un PNG de 1×1 (67 bytes, hardcoded como Buffer)
- **Responde primero, luego actualiza la BD** (fire-and-forget) para no bloquear email clients
- `UPDATE form_requests SET status='email_opened' ... WHERE id=? AND status='pending'` — solo registra la primera apertura
- `Cache-Control: no-store` para evitar que el cliente cachee el pixel

---

## Máquina de Estados (`form_requests.status`)

```
sendCarta() ──► pending
                  │
                  ├─ pixel fetched ──► email_opened
                  │                        │
                  └── submitForm() ◄────────┘
                           │
                           ▼
                    form_submitted
                    
  (token vencido) ──► expired  [cualquier estado excepto form_submitted]
```

---

## Variables de Entorno Nuevas

```dotenv
CARTA_FORMULARIO_PATH=carta-formulario.pdf   # ruta al PDF (relativa a raíz del proyecto)

EXT_DB_HOST=external-mysql-host
EXT_DB_PORT=3306
EXT_DB_USER=ext_user
EXT_DB_PASSWORD=ext_password
EXT_DB_NAME=formularios_db

WHATSAPP_FORM_TEMPLATE_NAME=formulario_datos  # template de WA para el formulario
```

---

## Rutas Completas

| Método | Path | Auth | Descripción |
|---|---|---|---|
| POST | `/api/cartas/send` | JWT o X-Api-Key | Enviar carta + email/WA |
| GET | `/api/cartas/` | JWT | Listar envíos (paginado) |
| GET | `/api/cartas/:id` | JWT o X-Api-Key | Detalle de un envío |
| GET | `/api/formulario/:token` | Ninguna | Validar token (para frontend) |
| POST | `/api/formulario/:token/submit` | Ninguna (rate-limit 10/h) | Enviar datos del formulario |
| GET | `/api/tracking/:id/pixel.png` | Ninguna | Pixel de apertura de email |

---

## Orden de Implementación

1. `database/schema_forms.sql` — DDL primero, sin dependencias
2. `src/config/externalDatabase.js` — pool externo
3. `src/services/cartaEmailService.js` — email con pixel + adjunto PDF
4. `src/controllers/cartaController.js` — usa patrón de `signatureController.js`
5. `src/controllers/publicFormController.js` — valida token, guarda en BD externa
6. `src/routes/cartas.js`, `publicForm.js`, `tracking.js` — montan los controllers
7. `src/app.js` — agregar 3 require + 3 app.use (sin borrar nada)
8. `.env.example` — agregar variables al final

---

## Reutilización del Código Existente

- `src/utils/token.js` → `generateSecureToken()` y `getTokenExpiry()` (mismos tokens de firma)
- `src/config/email.js` → transporter de Nodemailer (importar en cartaEmailService.js)
- `src/middleware/auth.js` y `apiKeyOrAuth.js` → aplicar directamente en cartas.js
- `express-rate-limit` (ya instalado) → limitar POST /formulario/:token/submit

---

## Verificación (pruebas end-to-end)

1. **BD**: Correr `schema_forms.sql` en ambos servidores. Verificar con `DESCRIBE form_requests` y `DESCRIBE form_submissions`.

2. **Enviar carta**:
   ```bash
   curl -X POST /api/cartas/send -H "Authorization: Bearer <JWT>" \
     -d '{"clientName":"Test","clientEmail":"test@test.com"}'
   # Esperar 201 con { id, status: 'pending' }
   ```

3. **Pixel de tracking**:
   ```bash
   curl -v "/api/tracking/<id>/pixel.png" -o pixel.png
   file pixel.png  # debe decir "PNG image data, 1 x 1"
   # Verificar BD: status='email_opened', email_opened_at poblado
   ```

4. **Validar token**: `GET /api/formulario/<token>` → `200 { clientName, status }`

5. **Enviar formulario**:
   ```bash
   curl -X POST /api/formulario/<token>/submit \
     -d '{"primer_nombre":"Juan","primer_apellido":"Pérez","tipo_documento":"CC",...}'
   # Esperar 200 { ok: true }
   # Verificar BD externa: SELECT * FROM form_submissions WHERE form_request_id='<id>'
   # Verificar BD interna: status='form_submitted'
   ```

6. **Guards**: Re-enviar mismo token → `409`. Token vencido → `410`. Envío #11 → `429`.
