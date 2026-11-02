// Orca-Pit: "WhatsApp" in Settings → Servers, below the company machines. The company's one
// number (a uazapi instance) is connected here and its groups synced; each group is then linked in
// its project's settings. Admins of the company in the DevNX Control change it; members only see.
// The instance token goes straight to the Control and is never shown back.
import { useCallback, useEffect, useState } from 'react'
import { Loader2, RefreshCw, Unplug } from 'lucide-react'
import type { OrcaPitWhatsappOverview } from '../../../../shared/orca-pit-whatsapp'
import type { RuntimeClientTarget } from '../../../../shared/runtime-client-target'
import { translate } from '@/i18n/i18n'
import { devnxFailureText } from '@/lib/orca-pit-devnx-status'
import { orcaPitWhatsapp } from '@/runtime/orca-pit-whatsapp-client'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../ui/dialog'
import { OrcaPitWhatsappGroupsTable } from './OrcaPitWhatsappGroupsTable'

const TARGET: RuntimeClientTarget = { kind: 'local' }

type Loaded =
  | { status: 'loading' }
  | { status: 'hidden' }
  | { status: 'error'; error: string }
  | { status: 'ready'; overview: OrcaPitWhatsappOverview }

function ConnectForm({
  initialUrl,
  hasToken,
  busy,
  onConnect
}: {
  initialUrl: string
  hasToken: boolean
  busy: boolean
  onConnect: (baseUrl: string, token: string) => void
}): React.JSX.Element {
  const [baseUrl, setBaseUrl] = useState(initialUrl)
  const [token, setToken] = useState('')
  return (
    <form
      className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]"
      onSubmit={(event) => {
        event.preventDefault()
        onConnect(baseUrl.trim(), token.trim())
      }}
    >
      <Input
        aria-label={translate('devnx.whatsapp.url', 'uazapi URL')}
        placeholder={translate('devnx.whatsapp.urlPlaceholder', 'https://your-instance.uazapi.com')}
        value={baseUrl}
        onChange={(event) => setBaseUrl(event.target.value)}
        autoComplete="off"
      />
      <Input
        type="password"
        aria-label={translate('devnx.whatsapp.token', 'Instance token')}
        placeholder={
          hasToken
            ? translate('devnx.whatsapp.tokenSaved', 'Token saved')
            : translate('devnx.whatsapp.token', 'Instance token')
        }
        value={token}
        onChange={(event) => setToken(event.target.value)}
        autoComplete="off"
      />
      <Button type="submit" size="sm" disabled={busy || !baseUrl.trim() || !token.trim()}>
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
        {translate('devnx.whatsapp.connect', 'Connect')}
      </Button>
    </form>
  )
}

function statusText(overview: OrcaPitWhatsappOverview): string {
  const instance = overview.instance
  if (!instance) {
    return ''
  }
  if (!instance.connected) {
    return translate(
      'devnx.whatsapp.offline',
      'The number is not connected in uazapi ({{status}}).',
      {
        status: instance.status ?? '?'
      }
    )
  }
  const who = [instance.ownerPhone ? `+${instance.ownerPhone}` : null, instance.profileName]
    .filter(Boolean)
    .join(' · ')
  return translate('devnx.whatsapp.connected', 'Connected: {{who}}', { who })
}

export function OrcaPitWhatsappSettings(): React.JSX.Element | null {
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' })
  const [busy, setBusy] = useState<'connect' | 'sync' | 'disconnect' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [confirming, setConfirming] = useState(false)

  const refresh = useCallback(async () => {
    const result = await orcaPitWhatsapp.overview(TARGET)
    if (result.ok) {
      setLoaded({ status: 'ready', overview: result.value })
    } else if (result.code === 'not_connected') {
      setLoaded({ status: 'hidden' })
    } else {
      setLoaded({ status: 'error', error: devnxFailureText(result) })
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const run = async (
    kind: 'connect' | 'sync' | 'disconnect',
    action: () => ReturnType<typeof orcaPitWhatsapp.overview>
  ): Promise<boolean> => {
    setBusy(kind)
    setError(null)
    try {
      const result = await action()
      if (!result.ok) {
        setError(devnxFailureText(result))
        return false
      }
      setLoaded({ status: 'ready', overview: result.value })
      return true
    } finally {
      setBusy(null)
    }
  }

  if (loaded.status === 'hidden') {
    return null
  }
  const overview = loaded.status === 'ready' ? loaded.overview : null
  const instance = overview?.instance ?? null
  const canManage = overview?.canManage === true
  return (
    <section className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-0.5">
          <h3 className="text-sm font-semibold">{translate('devnx.whatsapp.title', 'WhatsApp')}</h3>
          <p className="text-xs text-muted-foreground">
            {translate(
              'devnx.whatsapp.description',
              "The company's number. Each group linked to a project becomes a chat of the agent there; mention @orca in the group to call it."
            )}
          </p>
        </div>
        {instance && canManage ? (
          <div className="flex shrink-0 items-center gap-1.5">
            <Button
              size="sm"
              variant="outline"
              disabled={busy !== null}
              onClick={() => void run('sync', () => orcaPitWhatsapp.sync(TARGET))}
            >
              {busy === 'sync' ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <RefreshCw className="size-3.5" />
              )}
              {translate('devnx.whatsapp.sync', 'Sync')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy !== null}
              onClick={() => setEditing((value) => !value)}
            >
              {translate('devnx.whatsapp.change', 'Change')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy !== null}
              onClick={() => setConfirming(true)}
            >
              <Unplug className="size-3.5" />
              {translate('devnx.whatsapp.disconnect', 'Disconnect')}
            </Button>
          </div>
        ) : null}
      </div>
      {loaded.status === 'loading' ? (
        <p className="text-xs text-muted-foreground">
          {translate('devnx.whatsapp.loading', 'Loading WhatsApp…')}
        </p>
      ) : null}
      {loaded.status === 'error' ? (
        <p className="text-xs text-destructive">{loaded.error}</p>
      ) : null}
      {overview && instance ? <p className="text-xs">{statusText(overview)}</p> : null}
      {overview && !instance && !canManage ? (
        <p className="text-xs text-muted-foreground">
          {translate(
            'devnx.whatsapp.notConnectedMember',
            'Not connected yet. An administrator of the company connects the number here.'
          )}
        </p>
      ) : null}
      {overview && canManage && (!instance || editing) ? (
        <ConnectForm
          initialUrl={instance?.baseUrl ?? ''}
          hasToken={instance !== null}
          busy={busy === 'connect'}
          onConnect={(baseUrl, token) =>
            void run('connect', () => orcaPitWhatsapp.connect(TARGET, { baseUrl, token })).then(
              (ok) => ok && setEditing(false)
            )
          }
        />
      ) : null}
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
      {overview && instance ? <OrcaPitWhatsappGroupsTable groups={overview.groups} /> : null}
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent className="max-w-sm sm:max-w-sm" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>
              {translate('devnx.whatsapp.disconnectTitle', 'Disconnect WhatsApp?')}
            </DialogTitle>
            <DialogDescription>
              {translate(
                'devnx.whatsapp.disconnectDescription',
                'The groups stop reaching the agents and their links are removed. The number stays in uazapi.'
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)} disabled={busy !== null}>
              {translate('devnx.whatsapp.cancel', 'Cancel')}
            </Button>
            <Button
              variant="destructive"
              disabled={busy !== null}
              onClick={() =>
                void run('disconnect', () => orcaPitWhatsapp.disconnect(TARGET)).then(() =>
                  setConfirming(false)
                )
              }
            >
              {busy === 'disconnect' ? <Loader2 className="animate-spin" /> : <Unplug />}
              {translate('devnx.whatsapp.disconnect', 'Disconnect')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
