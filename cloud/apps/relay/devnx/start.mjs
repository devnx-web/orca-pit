// Orca-Pit: roda o emissor de token e o relay no mesmo container; se um cair, o container
// termina e o Easypanel o reinicia inteiro.
import { spawn } from 'node:child_process'

const children = [
  spawn(process.execPath, ['apps/relay/devnx/auth-server.mjs'], { stdio: 'inherit' }),
  spawn(process.execPath, ['apps/relay/dist/index.js'], { stdio: 'inherit' })
]
for (const child of children) {
  child.once('exit', (code) => {
    for (const other of children) {
      other.kill('SIGTERM')
    }
    process.exit(code ?? 1)
  })
}
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, () => children.forEach((child) => child.kill(signal)))
}
