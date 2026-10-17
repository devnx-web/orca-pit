// Orca-Pit: emissor de token do relay próprio, sem conta Orca. Cada computador recebe um
// token fixo (DEVNX_RELAY_DEVICE_TOKENS) e o troca aqui pelo JWT que o relay exige; é o
// papel do login.onorca.dev no relay da Stably. Ver relay-token-verifier.ts.
import { createHash, timingSafeEqual } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { SignJWT, exportJWK, generateKeyPair, importJWK } from 'jose'

const PORT = Number(process.env.DEVNX_RELAY_AUTH_PORT ?? 8081)
const ISSUER = process.env.ORCA_RELAY_AUTH_ISSUER
const DATA_DIR = process.env.ORCA_RELAY_DATA_DIR ?? './data/relay'
const TOKENS = (process.env.DEVNX_RELAY_DEVICE_TOKENS ?? '')
  .split(',')
  .map((token) => token.trim())
  .filter(Boolean)
// Why curto: o desktop renova sozinho antes de vencer; um JWT vazado vale pouco.
const TOKEN_TTL_SECONDS = 15 * 60

if (!ISSUER || TOKENS.length === 0) {
  console.error('[devnx-auth] faltam ORCA_RELAY_AUTH_ISSUER ou DEVNX_RELAY_DEVICE_TOKENS')
  process.exit(1)
}

// Why em disco: trocar a chave a cada boot derrubaria os JWTs já emitidos.
async function loadSigningKey() {
  const file = join(DATA_DIR, 'devnx-signing-key.json')
  if (!existsSync(file)) {
    const { privateKey } = await generateKeyPair('ES256', { extractable: true })
    writeFileSync(file, JSON.stringify(await exportJWK(privateKey)), { mode: 0o600 })
  }
  const privateJwk = JSON.parse(readFileSync(file, 'utf8'))
  const { d: _private, ...publicJwk } = privateJwk
  const kid = createHash('sha256').update(JSON.stringify(publicJwk)).digest('base64url').slice(0, 16)
  return {
    kid,
    privateKey: await importJWK(privateJwk, 'ES256'),
    jwks: { keys: [{ ...publicJwk, kid, alg: 'ES256', use: 'sig' }] }
  }
}

function matchDevice(header) {
  const presented = /^Bearer (\S+)$/.exec(header ?? '')?.[1]
  if (!presented) {
    return null
  }
  const left = Buffer.from(presented)
  return (
    TOKENS.find((token) => {
      const right = Buffer.from(token)
      return left.length === right.length && timingSafeEqual(left, right)
    }) ?? null
  )
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let raw = ''
    request.on('data', (chunk) => {
      raw += chunk
      if (raw.length > 16 * 1024) {
        reject(new Error('body too large'))
        request.destroy()
      }
    })
    request.on('end', () => resolve(raw))
    request.on('error', reject)
  })
}

function send(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
  response.end(JSON.stringify(body))
}

const key = await loadSigningKey()

createServer(async (request, response) => {
  try {
    const { pathname } = new URL(request.url ?? '/', 'http://local')
    if (request.method === 'GET' && pathname === '/jwks.json') {
      return send(response, 200, key.jwks)
    }
    if (request.method === 'GET' && pathname === '/health') {
      return send(response, 200, { ok: true })
    }
    if (request.method !== 'POST' || pathname !== '/v1/desktop/auth/relay-token') {
      return send(response, 404, { error: 'not_found' })
    }
    const device = matchDevice(request.headers.authorization)
    if (!device) {
      return send(response, 401, { error: 'unauthorized' })
    }
    const body = JSON.parse(await readBody(request))
    const publicKey = Buffer.from(String(body.hostPublicKeyB64 ?? ''), 'base64')
    const relayHostId = createHash('sha256').update(publicKey).digest('base64url').slice(0, 16)
    // Why: o relayHostId tem de ser o da chave que o desktop prova possuir depois.
    if (publicKey.length !== 32 || body.relayHostId !== relayHostId) {
      return send(response, 400, { error: 'invalid_host_key' })
    }
    const expiresAt = Date.now() + TOKEN_TTL_SECONDS * 1000
    const relayToken = await new SignJWT({ prof: device, purpose: 'host-control', relayHostId })
      .setProtectedHeader({ alg: 'ES256', kid: key.kid })
      .setIssuer(ISSUER)
      .setAudience('orca-relay')
      .setSubject(`devnx:${device}`)
      .setIssuedAt()
      .setExpirationTime(Math.floor(expiresAt / 1000))
      .sign(key.privateKey)
    console.log(`[devnx-auth] token emitido para ${device} (${relayHostId})`)
    return send(response, 200, { relayToken, expiresAt })
  } catch (error) {
    console.error('[devnx-auth] falha:', error)
    return send(response, 400, { error: 'bad_request' })
  }
}).listen(PORT, () => console.log(`[devnx-auth] ouvindo na porta ${PORT}`))
