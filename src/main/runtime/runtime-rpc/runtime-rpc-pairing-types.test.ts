import { describe, expect, it } from 'vitest'
import { createWebClientUrl, webClientPathForEndpoint } from './runtime-rpc-pairing-types'

describe('createWebClientUrl', () => {
  it('opens the web client under the same prefix as the endpoint', () => {
    // Orca-Pit: the orca.devnx.com.br router serves each machine under /<machine>.
    expect(createWebClientUrl('wss://orca.devnx.com.br/nitro5', 'orca://pair?code=x')).toBe(
      'https://orca.devnx.com.br/nitro5/web-index.html#pairing=orca%3A%2F%2Fpair%3Fcode%3Dx'
    )
    expect(createWebClientUrl('ws://10.0.0.5:6768', 'p')).toBe(
      'http://10.0.0.5:6768/web-index.html#pairing=p'
    )
  })

  it('keeps one slash between the prefix and the page', () => {
    expect(webClientPathForEndpoint('/nitro5/')).toBe('/nitro5/web-index.html')
    expect(webClientPathForEndpoint('/')).toBe('/web-index.html')
  })
})
