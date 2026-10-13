import { mkdtempSync, rmSync } from 'node:fs'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DevnxControlBrokerServer,
  CODEX_REFRESH_PATH,
  CLAUDE_PROXY_PATH
} from './devnx-control-broker-server'
import { DevnxControlClient } from './devnx-control-client'
import { parseGeminiClient, parseOpenAiClient, toPublicAccount } from './devnx-control-payloads'
import { getDevnxControlPaths } from './devnx-control-paths'

const OPENAI_CLIENT = {
  access_token: 'access',
  id_token: 'id',
  account_id: 'acct',
  refresh_token: 'cockpit:placeholder'
}

describe('DevNX Control payloads', () => {
  it('refuses a real OpenAI refresh token from the panel', () => {
    expect(() => parseOpenAiClient({ ...OPENAI_CLIENT, refresh_token: 'rt_real' })).toThrow(
      /não brokerado/
    )
    expect(parseOpenAiClient(OPENAI_CLIENT).accessToken).toBe('access')
  })

  it('refuses a Google session carrying a refresh token', () => {
    const payload = JSON.stringify({ token: { access_token: 'a', refresh_token: 'r' } })
    expect(() => parseGeminiClient({ payload })).toThrow(/não brokerado/)
  })

  it('refuses a session path that escapes the account home', () => {
    const payload = JSON.stringify({ token: { access_token: 'a' } })
    expect(() => parseGeminiClient({ payload, path: '../../.ssh/id' })).toThrow(/fora do diretório/)
  })

  it('keeps credentials out of the public account', () => {
    const account = toPublicAccount({
      id: 7,
      provider: 'codex',
      label: 'time@devnx',
      credentials: { refresh_token: 'secret' },
      usage: { five_hour: { percent: '42.5' } }
    })
    expect(account).toMatchObject({ id: '7', provider: 'openai', label: 'time@devnx' })
    expect(account.fiveHour.percent).toBe(42.5)
    expect(JSON.stringify(account)).not.toContain('secret')
  })
})

type Reply = { status: number; body: string }

function send(
  port: number,
  path: string,
  options: { method?: string; headers?: Record<string, string>; body?: string } = {}
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port,
        path,
        method: options.method ?? 'POST',
        headers: { 'content-type': 'application/json', ...options.headers }
      },
      (res) => {
        let body = ''
        res.on('data', (chunk) => (body += chunk))
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }))
      }
    )
    req.on('error', reject)
    req.end(options.body)
  })
}

describe('DevNX Control broker server', () => {
  let userData: string
  let client: DevnxControlClient
  let broker: DevnxControlBrokerServer
  let port: number

  beforeEach(async () => {
    userData = mkdtempSync(join(tmpdir(), 'devnx-control-'))
    client = new DevnxControlClient(getDevnxControlPaths(userData), false)
    broker = new DevnxControlBrokerServer(client)
    await broker.start()
    port = Number(new URL(broker.baseUrl() ?? '').port)
  })

  afterEach(() => {
    broker.stop()
    rmSync(userData, { recursive: true, force: true })
  })

  it('exchanges a known Codex capability through the panel refresh', async () => {
    const capability = client.openAiCapability('acct-1')
    const refresh = vi.spyOn(client, 'refreshOpenAi').mockResolvedValue({
      authMode: 'chatgpt',
      accessToken: 'new-access',
      idToken: 'new-id',
      accountId: 'chatgpt-acct',
      lastRefresh: new Date().toISOString(),
      expiresAt: null
    })
    const reply = await send(port, CODEX_REFRESH_PATH, {
      body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: capability })
    })
    expect(reply.status).toBe(200)
    expect(refresh).toHaveBeenCalledWith('acct-1')
    // Why: Codex must keep holding the placeholder, never a provider refresh token.
    expect(JSON.parse(reply.body)).toMatchObject({
      access_token: 'new-access',
      refresh_token: capability
    })
  })

  it('rejects an unknown Codex capability', async () => {
    const reply = await send(port, CODEX_REFRESH_PATH, {
      body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: 'cockpit:x:forged' })
    })
    expect(reply.status).toBe(401)
  })

  it('rejects browser-shaped requests', async () => {
    const reply = await send(port, CODEX_REFRESH_PATH, {
      headers: { origin: 'https://evil.example' },
      body: '{}'
    })
    expect(reply.status).toBe(403)
  })

  it('rejects a Claude call without the terminal capability', async () => {
    const reply = await send(port, `${CLAUDE_PROXY_PATH}/v1/messages`, {
      headers: { authorization: 'Bearer cc-wrong' },
      body: '{}'
    })
    expect(reply.status).toBe(401)
  })

  it('keeps the port and capability across restarts', async () => {
    const capability = client.runtime.claudeCapability
    broker.stop()
    const reloaded = new DevnxControlClient(getDevnxControlPaths(userData), false)
    expect(reloaded.runtime.claudeCapability).toBe(capability)
    expect(reloaded.runtime.port).toBe(port)
  })
})
