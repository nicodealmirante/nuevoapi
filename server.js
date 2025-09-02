// server.mjs
import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import pino from 'pino'
import {
  default as makeWASocket,
  DisconnectReason,
  useMultiFileAuthState
} from '@whiskeysockets/baileys'
import QRCode from 'qrcode'
import fetch from 'node-fetch'

const log = pino({ level: process.env.LOG_LEVEL || 'info' })
const app = express()
app.use(express.json({ limit: '2mb' }))
app.use(cors())

let sock
let isReady = false
let lastQR = null

// ========= Helpers =========
const onlyDigits = (s = '') => String(s).replace(/\D+/g, '')

/**
 * Normaliza números a JID (ej: 54911xxxxxxx@s.whatsapp.net)
 * Reglas 🇦🇷:
 *  - CC 54
 *  - Para móviles agregar '9' (549…)
 *  - Si ya viene jid, lo deja pasar
 */
function normalizePhone (raw) {
  if (!raw) return null
  if (typeof raw === 'string' && (raw.endsWith('@s.whatsapp.net') || raw.endsWith('@g.us'))) {
    return raw
  }
  let n = onlyDigits(raw)
  if (!n) return null

  // borra ceros leading
  n = n.replace(/^0+/, '')
  const cc = process.env.DEFAULT_COUNTRY_CODE || '54'

  // si no trae CC, se la agrego
  if (!n.startsWith(cc)) n = cc + n

  // Forzar prefijo móvil '9' en AR si no está
  if (cc === '54' && !n.startsWith('549')) {
    // si ya está 54 + area, anteponer 9
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
  return sock.sendMessage(jid, { text: String(text) })
}

async function sendImageUrl (jid, url, caption = '') {
  if (!isReady) throw new Error('WhatsApp no está listo aún')
  const r = await fetch(url)
  if (!r.ok) throw new Error(`No se pudo bajar imagen (${r.status})`)
  const buf = Buffer.from(await r.arrayBuffer())
  return sock.sendMessage(jid, { image: buf, caption })
}

// ========= WhatsApp =========
async function startSock () {
  const { state, saveCreds } = await useMultiFileAuthState(process.env.AUTH_DIR || './auth')
  sock = makeWASocket
