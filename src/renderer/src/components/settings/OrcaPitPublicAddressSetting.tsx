// Orca-Pit: where to edit the address this machine is reached at. "Share this computer" opens
// on it, and every link made for a custom address updates it.
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { translate } from '@/i18n/i18n'
import { parseServerShareAddress } from '../../../../shared/network/server-share-address'
import { orcaPitAppApi } from '../orca-pit-login/orca-pit-app-session-store'
import { runtimePairingLinkCache } from './runtime-pairing-link-state'

// Why untranslated: an address, the company's own central.
const EXAMPLE_ADDRESS = 'wss://orca.devnx.com.br'

export function OrcaPitPublicAddressSetting(): React.JSX.Element | null {
  const api = orcaPitAppApi()
  const [saved, setSaved] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    let cancelled = false
    void api
      ?.getPublicAddress()
      .then((address) => {
        if (!cancelled) {
          setSaved(address)
          setDraft(address ?? '')
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [api])
  if (!api) {
    return null
  }
  const trimmed = draft.trim()
  const invalid = trimmed !== '' && !parseServerShareAddress(trimmed).ok
  const changed = trimmed !== (saved ?? '')

  const save = async (): Promise<void> => {
    setSaving(true)
    try {
      const stored = await api.setPublicAddress(trimmed || null)
      setSaved(stored)
      setDraft(stored ?? '')
      // The next "Share this computer" opens on the new address.
      runtimePairingLinkCache.customAddress = ''
      toast.success(translate('devnx.publicAddress.saved', 'Address saved.'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-2">
      <Label htmlFor="orca-pit-public-address" className="text-sm font-semibold">
        {translate('devnx.publicAddress.title', "This computer's address")}
      </Label>
      <p className="text-xs text-muted-foreground">
        {translate(
          'devnx.publicAddress.description',
          'Where other devices reach this computer, such as wss://orca.devnx.com.br. Share this computer opens on it.'
        )}
      </p>
      <form
        className="flex max-w-xl gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          if (changed && !invalid) {
            void save()
          }
        }}
      >
        <Input
          id="orca-pit-public-address"
          value={draft}
          disabled={saving}
          aria-invalid={invalid}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={EXAMPLE_ADDRESS}
          className="min-w-0 font-mono"
        />
        <Button type="submit" size="sm" disabled={!changed || invalid || saving}>
          {translate('devnx.publicAddress.save', 'Save')}
        </Button>
      </form>
      {invalid ? (
        <p className="text-xs text-destructive">
          {translate(
            'auto.components.settings.RuntimePairingUrlGenerator.customInvalid',
            'Enter a valid host, host:port, IPv6 address, or ws(s):// URL.'
          )}
        </p>
      ) : null}
    </div>
  )
}
