import { describe, expect, it } from 'vitest'
import {
  asksForSecretNext,
  isSecretLookingLine,
  maskTerminalLine,
  redactAgentText
} from './orca-pit-activity-secrets'
import { OrcaPitLineBuffer } from './orca-pit-terminal-lines'

function typeKeys(buffer: OrcaPitLineBuffer, key: string, keys: string): string[] {
  const lines: string[] = []
  for (const char of keys) {
    lines.push(...buffer.feed(key, char))
  }
  return lines
}

describe('Orca-Pit line buffer: only the line submitted with Enter', () => {
  it('records nothing while typing, and the whole line on Enter', () => {
    const buffer = new OrcaPitLineBuffer()
    expect(typeKeys(buffer, 'pty-1', 'git status')).toEqual([])
    expect(buffer.feed('pty-1', '\r')).toEqual(['git status'])
    expect(buffer.feed('pty-1', '\r')).toEqual([])
  })

  it('applies backspace, Ctrl-W and Ctrl-U as the shell would', () => {
    const buffer = new OrcaPitLineBuffer()
    typeKeys(buffer, 'p', 'lss')
    buffer.feed('p', '\u007f')
    expect(buffer.feed('p', ' -la\r')).toEqual(['ls -la'])
    typeKeys(buffer, 'p', 'rm -rf build')
    buffer.feed('p', '\u0017')
    expect(buffer.feed('p', 'dist\r')).toEqual(['rm -rf dist'])
    typeKeys(buffer, 'p', 'oops')
    buffer.feed('p', '\u0015')
    expect(buffer.feed('p', 'pwd\n')).toEqual(['pwd'])
  })

  it('drops a line cancelled with Ctrl-C', () => {
    const buffer = new OrcaPitLineBuffer()
    typeKeys(buffer, 'p', 'make deploy')
    buffer.feed('p', '\u0003')
    expect(buffer.feed('p', '\r')).toEqual([])
  })

  it('keeps terminals apart', () => {
    const buffer = new OrcaPitLineBuffer()
    typeKeys(buffer, 'a', 'echo a')
    typeKeys(buffer, 'b', 'echo b')
    expect(buffer.feed('a', '\r')).toEqual(['echo a'])
    expect(buffer.feed('b', '\r')).toEqual(['echo b'])
  })

  it('ignores cursor keys and marks a line started from history', () => {
    const buffer = new OrcaPitLineBuffer()
    expect(buffer.feed('p', 'npm test\u001b[D\u001b[C\r')).toEqual(['npm test'])
    buffer.feed('p', '\u001b[A')
    expect(buffer.feed('p', ' --watch\r')).toEqual(['… --watch'])
    buffer.feed('p', '\u001b[A')
    expect(buffer.feed('p', '\r')).toEqual([])
  })

  it('splits a pasted block into its lines and unwraps bracketed paste', () => {
    const buffer = new OrcaPitLineBuffer()
    expect(buffer.feed('p', '\u001b[200~cd app\r\nnpm i\u001b[201~\r')).toEqual(['cd app', 'npm i'])
  })
})

describe('Orca-Pit secret masking', () => {
  it('hides lines that carry a secret', () => {
    for (const line of [
      'export GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz123456',
      'DB_PASSWORD=hunter2 php artisan migrate',
      'mysql -uroot -pS3cret db',
      'curl -H "Authorization: Bearer abc.def.ghi" https://x',
      'git clone https://fabio:senha123@github.com/org/repo.git',
      'deploy --token abc123',
      'sk-ant-api03-abcdefghijklmnopqrstuvwxyz',
      'Senha@2026'
    ]) {
      expect(isSecretLookingLine(line), line).toBe(true)
      expect(maskTerminalLine(line, false)).toBe('[oculto]')
    }
  })

  it('keeps ordinary commands', () => {
    for (const line of [
      'git status',
      'npm run dev',
      'ls -la src/main',
      'cd ..',
      'php artisan test'
    ]) {
      expect(maskTerminalLine(line, false), line).toBe(line)
    }
  })

  it('hides the line typed right after a command that asks for a password', () => {
    expect(asksForSecretNext('sudo apt install jq')).toBe(true)
    expect(asksForSecretNext('ssh root@31.97.91.125')).toBe(true)
    expect(asksForSecretNext('git status')).toBe(false)
    expect(maskTerminalLine('minhasenha', true)).toBe('[oculto]')
  })

  it('keeps an agent prompt readable with only the secret cut out', () => {
    expect(
      redactAgentText('use a senha=abc123 e o token: ghp_abcdefghijklmnopqrstuvwxyz1234')
    ).toBe('use a senha=[oculto] e o token: [oculto]')
    expect(redactAgentText('refatore o relatório de SAC')).toBe('refatore o relatório de SAC')
  })
})
