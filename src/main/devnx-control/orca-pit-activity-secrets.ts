// Orca-Pit: what the diary must never carry. A terminal line that looks like a secret is
// replaced whole by "[oculto]"; an agent prompt keeps its text with the secret parts cut out.
import { ORCA_PIT_HIDDEN_DETAIL } from './orca-pit-activity-types'

const SECRET_NAME =
  '(?:pass(?:word|wd|phrase)?|senha|secret|token|api[_-]?key|apikey|access[_-]?key|private[_-]?key|client[_-]?secret|credentials?)'

const SECRET_LINE_PATTERNS: readonly RegExp[] = [
  // name=value / name: value, also inside env names like GITHUB_TOKEN=… or DB_PASSWORD=…
  new RegExp(`${SECRET_NAME}\\w*\\s*[=:]\\s*\\S`, 'i'),
  // --password x, --token=x, -psecret (mysql)
  new RegExp(`(?:^|\\s)--?${SECRET_NAME}(?:[=\\s]|$)`, 'i'),
  /(?:^|\s)(?:mysql|mariadb|mysqldump)\b.*\s-p\S+/i,
  /\b(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}/i,
  /\bauthorization\s*:/i,
  // URL with user:password@
  /:\/\/[^\s/:@]+:[^\s/@]+@/,
  // Well-known token shapes (OpenAI/Anthropic, GitHub, Slack, AWS, JWT, Laravel Sanctum).
  /\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|\d+\|[A-Za-z0-9]{30,})/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/
]

// Commands that ask for a password on the next line; that line is typed blind and never shown.
const ASKS_FOR_SECRET =
  /^(?:sudo|su|doas|passwd|ssh|scp|sftp|ssh-keygen|ssh-add|mysql|mariadb|psql|kinit|gpg|openssl|vault\s+login|docker\s+login|podman\s+login|npm\s+(?:login|adduser)|gh\s+auth\s+login|git\s+(?:push|pull|clone|fetch)|ansible-vault|keytool)\b/i

function characterClasses(word: string): number {
  return (
    Number(/[a-z]/.test(word)) +
    Number(/[A-Z]/.test(word)) +
    Number(/\d/.test(word)) +
    Number(/[^A-Za-z0-9]/.test(word))
  )
}

/** A lone word that reads like a password or a pasted key rather than a command. */
function looksLikeBareSecret(line: string): boolean {
  if (/\s/.test(line) || line.includes('/')) {
    return false
  }
  if (line.length >= 24 && /[A-Za-z]/.test(line) && /\d/.test(line)) {
    return true
  }
  return line.length >= 6 && characterClasses(line) >= 3
}

export function isSecretLookingLine(line: string): boolean {
  const trimmed = line.trim()
  if (!trimmed) {
    return false
  }
  return (
    looksLikeBareSecret(trimmed) || SECRET_LINE_PATTERNS.some((pattern) => pattern.test(trimmed))
  )
}

export function asksForSecretNext(line: string): boolean {
  return ASKS_FOR_SECRET.test(line.trim())
}

/** The terminal line the diary keeps: the line itself, or "[oculto]". */
export function maskTerminalLine(line: string, afterSecretPrompt: boolean): string {
  return afterSecretPrompt || isSecretLookingLine(line) ? ORCA_PIT_HIDDEN_DETAIL : line
}

const INLINE_REDACTIONS: readonly [RegExp, string][] = [
  [new RegExp(`(${SECRET_NAME}\\w*\\s*[=:]\\s*)[^\\s,;]+`, 'gi'), `$1${ORCA_PIT_HIDDEN_DETAIL}`],
  [/\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, `$1 ${ORCA_PIT_HIDDEN_DETAIL}`],
  [/(:\/\/[^\s/:@]+:)[^\s/@]+@/g, `$1${ORCA_PIT_HIDDEN_DETAIL}@`],
  [
    /\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}(?:\.[A-Za-z0-9_-]+)?|\d+\|[A-Za-z0-9]{30,})/g,
    ORCA_PIT_HIDDEN_DETAIL
  ],
  [
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
    ORCA_PIT_HIDDEN_DETAIL
  ]
]

/** An agent prompt with its secret-shaped parts replaced; the rest of the text stays readable. */
export function redactAgentText(text: string): string {
  let out = text
  for (const [pattern, replacement] of INLINE_REDACTIONS) {
    out = out.replace(pattern, replacement)
  }
  return out
}
