// Orca-Pit: "Share this computer" opens on the address this machine is reached at, remembered
// per machine in main (`wss://orca.devnx.com.br` on the central), instead of asking every time.
import { useEffect, useRef } from 'react'
import { orcaPitAppApi } from '../orca-pit-login/orca-pit-app-session-store'
import { runtimePairingLinkCache, type RuntimePairingIntent } from './runtime-pairing-link-state'

/**
 * Opens on the remembered address once per mount, unless a custom one was typed this session,
 * and remembers the address of every link made for a custom address.
 */
export function useOrcaPitShareAddress(args: {
  intent: RuntimePairingIntent
  generatedAddress: string | null
  /** The generator's own intent switch: 'custom' selects the cached custom address. */
  onIntentChange: (intent: RuntimePairingIntent) => void
}): void {
  const { intent, generatedAddress } = args
  const onIntentChange = useRef(args.onIntentChange)
  onIntentChange.current = args.onIntentChange
  useEffect(() => {
    const api = orcaPitAppApi()
    if (!api) {
      return
    }
    let cancelled = false
    void api
      .getPublicAddress()
      .then((address) => {
        if (cancelled || typeof address !== 'string' || !address) {
          return
        }
        if (!runtimePairingLinkCache.customAddress) {
          runtimePairingLinkCache.customAddress = address
          onIntentChange.current('custom')
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const lastRemembered = useRef<string | null>(null)
  useEffect(() => {
    if (intent !== 'custom' || !generatedAddress || generatedAddress === lastRemembered.current) {
      return
    }
    lastRemembered.current = generatedAddress
    void orcaPitAppApi()
      ?.setPublicAddress(generatedAddress)
      .catch(() => {})
  }, [intent, generatedAddress])
}
