# Chatwoot → WhatsApp (Baileys) — Railway

API mínima que recibe un webhook de Chatwoot y envía WhatsApp usando `@whiskeysockets/baileys`.

## Archivos
- `server.js`, `package.json`, `.env.example`
- `Dockerfile`, `.dockerignore`, `railway.toml`

## Deploy en Railway (sin GitHub Actions)
1. Crea proyecto en Railway → **New Service** → *Deploy from Repo* o *Empty Project* (Dockerfile).
2. Sube este repo y asegúrate de incluir estos archivos.
3. En **Variables**: define si querés `DEFAULT_COUNTRY_CODE`, `FORCE_ARG_MOBILE_PREFIX`, `ALLOW_GROUPS`.
4. En **Volumes**: crea un volumen y móntalo en `/app/auth` (para no perder sesión).
5. Deploy → abre **Logs** → escanea el **QR** en consola la primera vez.
6. Copia la **Public URL** y en Chatwoot configura el webhook a `/webhooks/chatwoot`.

## Probar
```bash
curl -X POST https://TU-APP.up.railway.app/webhooks/chatwoot  -H 'Content-Type: application/json'  -d '{"phone":"11 5555-4444","message":"Hola desde Railway"}'
```

## Local
```bash
npm i
cp .env.example .env
npm start
```

> Aviso: el uso de Baileys puede ir en contra de Términos de WhatsApp. Úsalo bajo tu responsabilidad.
