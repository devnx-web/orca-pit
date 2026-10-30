import { describe, expect, it } from 'vitest'
import { parseRouterAnswer } from './machines'
import { routePath } from './routing'

describe('routePath', () => {
  it('splits the machine prefix from the path its Orca sees', () => {
    expect(routePath('/nitro5/web-index.html')).toEqual({
      kind: 'machine',
      slug: 'nitro5',
      originPath: '/web-index.html'
    })
    expect(routePath('/nitro5/')).toEqual({ kind: 'machine', slug: 'nitro5', originPath: '/' })
    expect(routePath('/nitro5/assets/web-1.js')).toMatchObject({ originPath: '/assets/web-1.js' })
  })

  it('takes machine names in any case', () => {
    expect(routePath('/FtgkNote/')).toMatchObject({ slug: 'ftgknote' })
  })

  it('tells the bare machine path apart so a page can move under the slash', () => {
    expect(routePath('/mirella')).toEqual({ kind: 'machine-bare', slug: 'mirella' })
  })

  it('keeps the bare-domain Orca paths for clients paired before the router', () => {
    expect(routePath('/web-index.html')).toEqual({
      kind: 'legacy-root',
      originPath: '/web-index.html'
    })
    expect(routePath('/assets/web-1.js')).toMatchObject({ kind: 'legacy-root' })
    expect(routePath('/orca-pit/login')).toMatchObject({ kind: 'legacy-root' })
  })

  it('refuses reserved and malformed names', () => {
    for (const path of ['/cdn-cgi/trace', '/api/x', '/-x/', '/a_b/', '/caf%C3%A9/', '/x'.padEnd(80, 'y')]) {
      expect(routePath(path)).toEqual({ kind: 'not-found' })
    }
    expect(routePath('/')).toEqual({ kind: 'root' })
  })
})

describe('parseRouterAnswer', () => {
  it('accepts the Control’s base-36 origin suffix', () => {
    // The Control names origins `orca-<slug>-<6 base-36 chars>`, not hex (ftgknote got "ggv0gl").
    const answer = parseRouterAnswer(200, {
      status: 'approved',
      origin_host: 'orca-ftgknote-ggv0gl.devnx.com.br',
      origin_secret: 's',
      online: true
    })
    expect(answer).toMatchObject({ kind: 'found', originHost: 'orca-ftgknote-ggv0gl.devnx.com.br' })
  })
})
