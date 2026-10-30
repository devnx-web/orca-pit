// The router's own pages, in PT-BR: the people who see them are the company's.

const STYLE = `
:root{--bg:#f6f6f4;--fg:#1c1c1a;--muted:#6b6b66;--card:#fff;--line:#deded8;--accent:#2563eb}
@media (prefers-color-scheme:dark){:root{--bg:#131312;--fg:#ececea;--muted:#9a9a94;--card:#1d1d1b;--line:#33332f;--accent:#60a5fa}}
*{box-sizing:border-box}body{margin:0;min-height:100dvh;display:grid;place-items:center;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;padding:16px}
main{width:100%;max-width:420px;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:28px}
h1{font-size:19px;margin:0 0 8px}p{margin:0 0 16px;color:var(--muted)}code{font-size:13px}
form{display:flex;gap:8px}input{flex:1;min-width:0;padding:9px 11px;border:1px solid var(--line);border-radius:8px;background:transparent;color:inherit;font:inherit}
button{padding:9px 14px;border:0;border-radius:8px;background:var(--accent);color:#fff;font:inherit;cursor:pointer}
`

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char
  )
}

function page(status: number, title: string, body: string): Response {
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} · Orca-Pit</title><style>${STYLE}</style></head><body><main>${body}</main></body></html>`
  return new Response(html, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    }
  })
}

const PICKER_FORM = `<form method="get" action="/"><input name="maquina" placeholder="ex.: nitro5" autocapitalize="none" autocomplete="off" required aria-label="Nome da máquina"><button type="submit">Abrir</button></form>`

export function machinePickerPage(): Response {
  return page(
    200,
    'Escolha a máquina',
    `<h1>Escolha a máquina</h1><p>Digite o nome do computador da empresa que você quer abrir. A lista completa fica no app, em Configurações → Servidores.</p>${PICKER_FORM}`
  )
}

export function missingMachinePage(slug: string): Response {
  return page(
    404,
    'Máquina não encontrada',
    `<h1>Máquina não encontrada</h1><p>Nenhum computador da empresa se chama <code>${escapeHtml(slug)}</code>. Confira o nome com quem cuida dele.</p>${PICKER_FORM}`
  )
}

export function offlineMachinePage(slug: string): Response {
  return page(
    503,
    'Máquina desligada',
    `<h1>Máquina desligada</h1><p>O computador <code>${escapeHtml(slug)}</code> não está conectado agora. Ele volta sozinho quando o Orca-Pit abrir nele.</p>`
  )
}

export function blockedMachinePage(slug: string, status: 'pending' | 'disabled' | 'unknown'): Response {
  const text =
    status === 'pending'
      ? 'ainda está esperando a aprovação de um administrador no DevNX Control.'
      : 'está desativado no DevNX Control.'
  return page(
    403,
    'Máquina indisponível',
    `<h1>Máquina indisponível</h1><p>O computador <code>${escapeHtml(slug)}</code> ${text}</p>`
  )
}

export function controlUnavailablePage(): Response {
  return page(
    502,
    'Tente de novo',
    `<h1>Tente de novo em instantes</h1><p>Não foi possível consultar o DevNX Control para achar esta máquina.</p>`
  )
}
