import 'dotenv/config'
import express from 'express'
import pino from 'pino'
import makeWASocket, { DisconnectReason, useMultiFileAuthState } from '@whiskeysockets/baileys'
import QRCode from 'qrcode'

const log = pino({ level: 'info' })
const app = express()
app.use(express.json({ limit: '1mb' }))

let sock
let isReady = false
let lastQR = null

async function startSock () {
  const { state, saveCreds } = await useMultiFileAuthState('./auth')
  sock = makeWASocket({
    auth: state,
    browser: ['Chatwoot Relay', 'Chrome', '1.3'],
    markOnlineOnConnect: false,
    syncFullHistory: false
  })

  sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      lastQR = qr
      log.warn('Nuevo QR disponible en /qr.png o /qr.svg')
    }
    if (connection === 'open') {
      isReady = true
      lastQR = null
      log.info('✅ Conectado a WhatsApp')
    }
    if (connection === 'close') {
      isReady = false
      const reason = lastDisconnect?.error?.output?.statusCode
      log.warn({ reason }, 'Conexión cerrada, reintentando...')
      if (reason !== DisconnectReason.loggedOut) {
        startSock().catch(err => log.error(err, 'Error reintentando conexión'))
      } else {
        log.error('Sesión cerrada. Borrá ./auth para re-loguear')
      }
    }
  })

  sock.ev.on('creds.update', saveCreds)
}

// ====== HELPERS ======
function onlyDigits (s = '') { return String(s).replace(/\D+/g, '') }

function normalizePhone (raw) {
  if (!raw) return null
  if (typeof raw === 'string' && (raw.endsWith('@s.whatsapp.net') || raw.endsWith('@g.us'))) return raw
  let n = onlyDigits(raw)
  if (!n) return null
  if (n.startsWith('0')) n = n.replace(/^0+/, '')
  const cc = process.env.DEFAULT_COUNTRY_CODE || '54'
  if (!n.startsWith(cc)) n = cc + n
  if (process.env.FORCE_ARG_MOBILE_PREFIX === '1' && cc === '54' && !n.startsWith('549')) {
    n = '549' + n.slice(2)
  }
  return `${n}@s.whatsapp.net`
}

function extractFromChatwoot (raw) {
  const b = raw?.payload || raw?.data || raw || {}
  const phone =
    b.phone || b.to || b.number ||
    b?.contact?.phone_number ||
    b?.conversation?.contact?.phone_number ||
    b?.conversation?.contact_inbox?.contact?.phone_number ||
    b?.sender?.phone_number ||
    b?.message?.sender?.phone_number ||
    b?.meta?.sender?.phone_number ||
    b?.conversation?.meta?.sender?.phone_number

  let message =
    b?.message?.content ??
    b?.content ??
    (Array.isArray(b?.messages) ? b.messages[0]?.content : undefined) ??
    b?.conversation?.messages?.[0]?.content

  return { phone, message }
}

async function sendText (jid, text) {
  if (!isReady) throw new Error('WhatsApp no está listo aún')
  return sock.sendMessage(jid, { text })
}

// ====== ROUTES ======
app.get('/healthz', (_, res) => res.status(200).send('ok'))

app.get('/', (_, res) =>
  res.json({ ok: true, status: isReady ? 'whatsapp_ready' : 'whatsapp_connecting' })
)

// QR públicos (para escanear desde el móvil)
app.get('/qr.png', async (_, res) => {
  if (!lastQR) return res.status(404).send('Aún no hay QR')
  const png = await QRCode.toBuffer(lastQR, { width: 360, margin: 1 })
  res.set('Content-Type', 'image/png').send(png)
})

app.get('/qr.svg', async (_, res) => {
  if (!lastQR) return res.status(404).send('Aún no hay QR')
  const svg = await QRCode.toString(lastQR, { type: 'svg', margin: 1 })
  res.set('Content-Type', 'image/svg+xml').send(svg)
})

app.post('/webhooks/chatwoot', async (req, res) => {
  try {
    const { phone, message } = extractFromChatwoot(req.body)
    if (!phone || !message) {
      log.warn({ body: req.body }, 'Payload incompleto (falta phone o message)')
      return res.status(400).json({ ok: false, error: 'Faltan campos: phone y message' })
    }
    const jid = normalizePhone(phone)
    if (!jid) {
      log.warn({ phone }, 'Número inválido tras normalizar')
      return res.status(400).json({ ok: false, error: 'Número inválido' })
    }
    await sendText(jid, message)
    return res.json({ ok: true, to: jid })
  } catch (err) {
    log.error({ err, body: req.body }, 'Fallo enviando mensaje')
    return res.status(500).json({ ok: false, error: err?.message || 'Error interno' })
  }
})

const PORT = process.env.PORT || 3000
app.listen(PORT, '0.0.0.0', () => {
  log.info(`HTTP listo en :${PORT}`)
  startSock().catch(err => log.error({ err }, 'Fallo iniciando Baileys'))
})
