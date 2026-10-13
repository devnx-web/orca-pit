import { useCallback, useEffect, useState } from 'react'
import { Loader2, LogOut, RefreshCw, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import {
  DEVNX_CONTROL_DEFAULT_BASE_URL,
  DEVNX_CONTROL_PROVIDERS,
  type DevnxControlAccount,
  type DevnxControlResult,
  type DevnxControlStatus
} from '../../../../shared/devnx-control-types'
import { DEVNX_PROVIDER_LABELS, DevnxControlAccountsTable } from './DevnxControlAccountsTable'

// Why optional: the web client has no main process, so the bridge is absent there.
function devnxApi(): Window['api']['devnxControl'] | null {
  return typeof window.api?.devnxControl === 'object' ? window.api.devnxControl : null
}

function unwrap<T>(result: DevnxControlResult<T>): T | null {
  if (result.ok) {
    return result.value
  }
  toast.error(result.error)
  return null
}

export function DevnxControlSection(): React.JSX.Element | null {
  const api = devnxApi()
  const [status, setStatus] = useState<DevnxControlStatus | null>(null)
  const [accounts, setAccounts] = useState<DevnxControlAccount[]>([])
  const [baseUrl, setBaseUrl] = useState(DEVNX_CONTROL_DEFAULT_BASE_URL)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState<'connect' | 'refresh' | 'logout' | null>(null)
  const [busyAccountId, setBusyAccountId] = useState<string | null>(null)

  const loadAccounts = useCallback(async (): Promise<void> => {
    const result = await api?.listAccounts()
    if (result?.ok) {
      setAccounts(result.value)
    }
  }, [api])

  useEffect(() => {
    void api?.getStatus().then((next) => {
      setStatus(next)
      setBaseUrl(next.baseUrl)
      if (next.connected) {
        void loadAccounts()
      }
    })
  }, [api, loadAccounts])

  if (!api) {
    return null
  }

  const apply = async (next: DevnxControlStatus | null): Promise<void> => {
    if (!next) {
      return
    }
    setStatus(next)
    for (const warning of next.warnings) {
      toast.warning(warning)
    }
    if (next.connected) {
      await loadAccounts()
    } else {
      setAccounts([])
    }
  }

  const handleConnect = async (): Promise<void> => {
    setBusy('connect')
    try {
      const next = unwrap(await api.connect({ baseUrl, email, password }))
      if (next) {
        setPassword('')
        toast.success(translate('devnx.connected', 'Connected to DevNX Control.'))
      }
      await apply(next)
    } finally {
      setBusy(null)
    }
  }

  const handleRefresh = async (): Promise<void> => {
    setBusy('refresh')
    try {
      await apply(unwrap(await api.refresh({ syncUsage: true })))
    } finally {
      setBusy(null)
    }
  }

  const handleLogout = async (): Promise<void> => {
    setBusy('logout')
    try {
      await apply(unwrap(await api.logout()))
    } finally {
      setBusy(null)
    }
  }

  const handleSelect = async (account: DevnxControlAccount): Promise<void> => {
    setBusyAccountId(account.id)
    try {
      await apply(unwrap(await api.selectAccount(account.provider, account.id)))
    } finally {
      setBusyAccountId(null)
    }
  }

  const connected = status?.connected === true

  return (
    <section id="accounts-devnx-control" className="space-y-4 scroll-mt-6">
      <div className="space-y-1">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <ShieldCheck className="size-4" />
          DevNX Control
        </h3>
        <p className="text-xs text-muted-foreground">
          {translate(
            'devnx.description',
            'Sign in with your panel user. It picks the Claude, Codex and Antigravity account for each new terminal, with no CLI login.'
          )}
        </p>
      </div>

      {connected ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/20 p-3">
            <div className="min-w-0 space-y-1 text-xs">
              <p className="truncate font-medium">
                {status?.baseUrl}
                {status?.source === 'cockpit'
                  ? ` · ${translate('devnx.fromCockpit', 'Cockpit pairing')}`
                  : null}
              </p>
              <p className="text-muted-foreground">
                {DEVNX_CONTROL_PROVIDERS.map((provider) => {
                  const account = status?.selected[provider]
                  return `${DEVNX_PROVIDER_LABELS[provider]}: ${account?.label ?? '—'}`
                }).join(' · ')}
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="xs"
                disabled={busy !== null}
                onClick={() => void handleRefresh()}
              >
                {busy === 'refresh' ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <RefreshCw className="size-3" />
                )}
                {translate('devnx.refresh', 'Refresh')}
              </Button>
              <Button
                variant="outline"
                size="xs"
                disabled={busy !== null}
                onClick={() => void handleLogout()}
              >
                {busy === 'logout' ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <LogOut className="size-3" />
                )}
                {translate('devnx.logout', 'Sign out')}
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            {translate(
              'devnx.newTerminalsOnly',
              'Codex and Antigravity account changes apply to new terminals. Claude also switches in open terminals.'
            )}
          </p>
          <DevnxControlAccountsTable
            accounts={accounts}
            busyAccountId={busyAccountId}
            onSelect={(account) => void handleSelect(account)}
          />
        </div>
      ) : (
        <form
          className="grid gap-3 rounded-lg border border-border/60 bg-muted/20 p-3 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault()
            void handleConnect()
          }}
        >
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="devnx-base-url">{translate('devnx.url', 'Panel address')}</Label>
            <Input
              id="devnx-base-url"
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="devnx-email">{translate('devnx.email', 'Email')}</Label>
            <Input
              id="devnx-email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="devnx-password">{translate('devnx.password', 'Password')}</Label>
            <Input
              id="devnx-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
          <div className="sm:col-span-2">
            <Button type="submit" size="sm" disabled={busy !== null || !email || !password}>
              {busy === 'connect' ? <Loader2 className="size-3 animate-spin" /> : null}
              {translate('devnx.connect', 'Sign in')}
            </Button>
          </div>
        </form>
      )}
    </section>
  )
}

// Orca-Pit: the DevNX Control panel owns the team accounts, so it leads the Accounts pane.
export function withDevnx(
  searchQuery: string,
  sections: (React.JSX.Element | null)[]
): (React.JSX.Element | null)[] {
  const matches = !searchQuery || /devnx|control|painel|conta|account/i.test(searchQuery)
  return matches ? [<DevnxControlSection key="devnx-control" />, ...sections] : sections
}
