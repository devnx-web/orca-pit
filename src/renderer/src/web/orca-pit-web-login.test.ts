import { describe, expect, it } from 'vitest'
import { browserPrefersPortuguese, webClientRuntimeEndpoint } from './orca-pit-web-login'

describe('the endpoint the web client asks the login offer for', () => {
  it('is the page origin as ws(s), with any proxy prefix', () => {
    expect(webClientRuntimeEndpoint({ href: 'http://10.0.0.5:6768/web-index.html#x' })).toBe(
      'ws://10.0.0.5:6768/'
    )
    expect(webClientRuntimeEndpoint({ href: 'https://orca.empresa.com/pit/web-index.html' })).toBe(
      'wss://orca.empresa.com/pit'
    )
  })

  it('follows the first browser language before any settings exist', () => {
    expect(browserPrefersPortuguese(['pt-BR', 'en'])).toBe(true)
    expect(browserPrefersPortuguese(['en-US', 'pt-BR'])).toBe(false)
    expect(browserPrefersPortuguese([])).toBe(false)
  })
})
