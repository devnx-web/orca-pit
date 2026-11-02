// Conector WhatsApp do Orca-Pit (contrato v1, 02/11/2026): a uazapi entrega os eventos em
// orca.devnx.com.br/whatsapp/<chave>. O Worker repassa ao Control (o único que guarda a caixa de
// entrada e o token da instância), devolve 200 à uazapi e, se o Control disser qual máquina
// cuida do grupo, a acorda pelo túnel dela. Nada aqui lê ou guarda a mensagem.
import type { ExecutionContextLike, RouterDeps, RouterEnv } from './env'
import { lookupMachine } from './machines'

// A chave que o Control gera (Str::random(48)); a rota de lá aceita 20 a 80 caracteres.
const KEY = /^[A-Za-z0-9]{20,80}$/
// Mesma gramática dos slugs de máquina (routing.ts).
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
// O Control fica atrás da checagem de navegador do Cloudflare, que recusa pedido sem UA.
const USER_AGENT = 'orca-devnx-router/1'
// Por que curto: a uazapi espera a resposta, e um webhook lento atrasa a fila da instância.
const CONTROL_TIMEOUT_MS = 8_000
// O acordar é só um atalho: a máquina busca a caixa de entrada sozinha a cada 60 s.
const WAKE_TIMEOUT_MS = 5_000
// Payload de mensagem é pequeno; nada maior que isso é um evento que nos interessa.
const MAX_BODY_BYTES = 2 * 1024 * 1024

export function isWhatsappPath(pathname: string): boolean {
  return pathname === '/whatsapp' || pathname.startsWith('/whatsapp/')
}

/** A chave do primeiro trecho depois de /whatsapp/; subcaminhos (`/<chave>/messages`) valem igual. */
export function whatsappKey(pathname: string): string | null {
  const key = pathname.slice('/whatsapp/'.length).split('/')[0] ?? ''
  return KEY.test(key) ? key : null
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  })
}

export async function handleWhatsapp(
  request: Request,
  env: RouterEnv,
  ctx: ExecutionContextLike,
  deps: RouterDeps
): Promise<Response> {
  const key = whatsappKey(new URL(request.url).pathname)
  // Sempre 200 para a uazapi: um erro faria ela reenviar e acumular fila. Sem chave válida não
  // há o que repassar.
  if (request.method !== 'POST' || !key) {
    return json({})
  }
  const declared = Number(request.headers.get('Content-Length') ?? '0')
  if (declared > MAX_BODY_BYTES) {
    return json({})
  }
  const body = await request.text()
  if (body.length > MAX_BODY_BYTES) {
    return json({})
  }

  let answer: Response
  try {
    answer = await deps.fetch(`${env.CONTROL_BASE_URL.replace(/\/$/, '')}/api/whatsapp/webhook/${key}`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': USER_AGENT,
        'X-Orca-Router-Key': env.ORCA_ROUTER_KEY
      },
      body,
      signal: AbortSignal.timeout(CONTROL_TIMEOUT_MS)
    })
  } catch (error) {
    console.warn('whatsapp: o Control não respondeu ao webhook', String(error))
    return json({})
  }

  if (answer.status !== 200) {
    // 404/403 = chave ou token errados; 5xx = Control com problema. Nenhum dos dois é da uazapi.
    if (answer.status >= 500) {
      console.warn('whatsapp: o Control recusou o webhook', answer.status)
    }
    return json({})
  }

  const result = (await answer.json().catch(() => null)) as { wake?: unknown } | null
  const wake = typeof result?.wake === 'string' ? result.wake.toLowerCase() : null
  if (wake && SLUG.test(wake)) {
    ctx.waitUntil(wakeMachine(wake, env, deps))
  }
  return json({ wake: wake && SLUG.test(wake) ? wake : null })
}

/**
 * `POST https://<origem escondida>/orca-pit/whatsapp/wake` com o segredo de origem, para a
 * máquina buscar a caixa de entrada agora. Falha é silenciosa.
 */
export async function wakeMachine(slug: string, env: RouterEnv, deps: RouterDeps): Promise<void> {
  const pending: Promise<unknown>[] = []
  try {
    const lookup = await lookupMachine(slug, env, deps, (promise) => void pending.push(promise))
    if (lookup.kind !== 'found') {
      return
    }
    const response = await deps.fetch(`https://${lookup.originHost}/orca-pit/whatsapp/wake`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': USER_AGENT,
        'X-Orca-Origin-Secret': lookup.originSecret
      },
      body: '{}',
      redirect: 'manual',
      signal: AbortSignal.timeout(WAKE_TIMEOUT_MS)
    })
    await response.body?.cancel()
  } catch {
    // A máquina desligada ou o túnel caído: ela busca sozinha quando voltar.
  } finally {
    await Promise.allSettled(pending)
  }
}
