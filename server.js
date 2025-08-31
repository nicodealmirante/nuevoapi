import 'dotenv/config'
import express from 'express'
import pino from 'pino'
import makeWASocket, { DisconnectReason, useMultiFileAuthState } from '@whiskeysockets/baileys'
import qrcode from 'qrcode-terminal'

const log = pino({ level: 'info' })
const app = express()
app.use(express.json({ limit: '1mb' }))

let sock
let isReady = false

async function startSock () {
  const { state, saveCreds } = await useMultiFileAuthState('./auth')
  sock = makeWASocket({
    printQRInTerminal: true,
    auth: state,
    browser: ['Chatwoot Relay', 'Chrome', '1.0'],
    markOnlineOnConnect: false,
    syncFullHistory: false
  })

  sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      log.warn('Escaneá el QR desde WhatsApp:')
      qrcode.generate(qr, { small: true })
    }
    if (connection === 'open') {
      isReady = true
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

await startSock()

function onlyDigits (s = '') { return (s + '').replace(/\D+/g, '') }

function normalizePhone (raw) {
  let n = onlyDigits(raw)
  if (!n) return null
  if (raw.endsWith('@s.whatsapp.net')) return raw
  if (n.startsWith('0')) n = n.replace(/^0+/, '')
  const cc = process.env.DEFAULT_COUNTRY_CODE || '54'
  if (!n.startsWith(cc)) {
    n = cc + n
  }
  if (process.env.FORCE_ARG_MOBILE_PREFIX === '1' && cc === '54' && !n.startsWith('549')) {
    n = '549' + n.slice(2)
  }
  return `${n}@s.whatsapp.net`
}

function extractFromChatwoot (body) {
  const simplePhone = body.phone || body.to || body.number
  const simpleMsg = body.message || body.text || body.content
  let phone = simplePhone
  let message = simpleMsg
  if (!phone) {
    phone = body?.sender?.phone_number
      || body?.conversation?.meta?.sender?.phone_number
      || body?.contact?.phone_number
      || body?.conversation?.contact_inbox?.contact?.phone_number
  }
  if (!message) {
    message = body?.message?.content || body?.content || body?.messages?.[0]?.content
  }
  return { phone, message }
}

async function sendText (jid, text) {
  if (!isReady) throw new Error('WhatsApp no está listo aún')
  return sock.sendMessage(jid, { text })
}

app.get('/', (_, res) => res.json({ ok: true, status: isReady ? 'whatsapp_ready' : 'whatsapp_connecting' }))

app.post('/webhooks/chatwoot', async (req, res) => {
  try {
    const { phone, message } = extractFromChatwoot(req.body)
    if (!phone || !message) {
      return res.status(400).json({ ok: false, error: 'Faltan campos: phone y message' })
    }
    const jid = normalizePhone(phone)
    if (!jid) return res.status(400).json({ ok: false, error: 'Número inválido' })
    await sendText(jid, message)
    return res.json({ ok: true, to: jid })
  } catch (err) {
    log.error({ err }, 'Fallo enviando mensaje')
    return res.status(500).json({ ok: false, error: err?.message || 'Error interno' })
  }
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => log.info(`HTTP listo en :${PORT}`))