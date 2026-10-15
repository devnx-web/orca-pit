#!/usr/bin/env node
// =============================================================
// config/scripts/orca-pit-releases-manifest.mjs — gera o releases.json
// =============================================================
// O app (Configurações → Atualizações) lê este arquivo para saber se há
// versão nova e mostrar o que mudou. Ele sai inteiro do
// ORCA-PIT-CHANGELOG.md, que continua sendo o único lugar a editar.
//
// Cada versão é um "## <versão> — <data>". Para retirar uma versão (ninguém
// mais é levado a ela), acrescente "(retirada)" no fim do título e publique
// de novo o manifesto: "latest" passa a ser a mais nova ainda ativa.
//
// Uso: node config/scripts/orca-pit-releases-manifest.mjs <CHANGELOG.md> > releases.json
// =============================================================
import { readFileSync } from 'node:fs'

const HEADING = /^## (\d+\.\d+\.\d+-pit\d+)\s*(?:—\s*(.*?))?\s*$/
const WITHDRAWN = /\(retirada\)\s*$/i

export function buildManifest(markdown) {
  const releases = []
  let current = null
  for (const line of markdown.split('\n')) {
    const heading = HEADING.exec(line)
    if (heading) {
      const rest = heading[2] ?? ''
      current = {
        version: heading[1],
        date: rest.replace(WITHDRAWN, '').trim(),
        notes: [],
        active: !WITHDRAWN.test(rest)
      }
      releases.push(current)
      continue
    }
    if (!current || line.startsWith('#')) {
      if (line.startsWith('#')) {
        current = null
      }
      continue
    }
    const text = line.trim()
    if (!text) {
      continue
    }
    // Why: a bullet that wraps continues on indented lines; they belong to the same note.
    if (line.startsWith('- ') || current.notes.length === 0 || !/^\s/.test(line)) {
      current.notes.push(text.replace(/^- /, ''))
    } else {
      current.notes[current.notes.length - 1] += ` ${text}`
    }
  }
  return { latest: releases.find((release) => release.active)?.version ?? null, releases }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const file = process.argv[2]
  if (!file) {
    console.error('uso: orca-pit-releases-manifest.mjs <CHANGELOG.md>')
    process.exit(1)
  }
  process.stdout.write(`${JSON.stringify(buildManifest(readFileSync(file, 'utf8')), null, 2)}\n`)
}
