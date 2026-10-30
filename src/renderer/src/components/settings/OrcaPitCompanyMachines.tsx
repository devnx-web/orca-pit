// Orca-Pit: "Company machines" in Settings → Servers. The DevNX Control lists every Orca-Pit of
// the company; Connect signs in there with the person's own session (the pit12 login) and saves
// the server like a pasted access link. This computer shows its own entry and tunnel.
import { useCallback, useEffect, useState } from 'react'
import { ExternalLink, Loader2, Monitor, RefreshCw } from 'lucide-react'
import type {
  OrcaPitMachine,
  OrcaPitMachineSelfState,
  OrcaPitTunnelState
} from '../../../../shared/orca-pit-machines'
import { orcaPitMachineHttpsUrl } from '../../../../shared/orca-pit-machines'
import { DEVNX_CONTROL_WEB_URL } from '../../../../shared/devnx-control-types'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { Button } from '../ui/button'
import { OrcaPitPersonAvatar } from '../sidebar/OrcaPitPersonAvatar'
import { orcaPitAppApi, useOrcaPitAppSession } from '../orca-pit-login/orca-pit-app-session-store'
import { orcaPitServerLoginFailureText } from './OrcaPitServerLoginForm'
import {
  isOrcaPitMachineOutdated,
  orcaPitMachineRowAction,
  sortOrcaPitMachines
} from './orca-pit-company-machines'

// Why 30 s: online flags move with the 60 s heartbeat; Settings is rarely open for long.
const REFRESH_MS = 30_000

type SavedServer = { id: string; endpoints: readonly { endpoint: string }[] }

function tunnelText(state: OrcaPitTunnelState, machine: OrcaPitMachine): string {
  switch (state.kind) {
    case 'running':
      return translate('devnx.machines.tunnelRunning', 'Online at {{address}}', {
        address: (machine.webUrl ?? machine.publicUrl).replace(/^\w+:\/\//, '')
      })
    case 'installing':
      return translate('devnx.machines.tunnelInstalling', 'Downloading the tunnel…')
    case 'starting':
      return translate('devnx.machines.tunnelStarting', 'Starting the tunnel…')
    case 'error':
      return state.message
    default:
      return translate('devnx.machines.tunnelOff', 'Tunnel off')
  }
}

function selfText(self: OrcaPitMachineSelfState, machine: OrcaPitMachine): string {
  if (machine.status === 'pending') {
    return translate('devnx.machines.selfPending', 'Waiting for an administrator to approve it')
  }
  if (machine.status === 'disabled') {
    return translate('devnx.machines.disabled', 'Disabled in DevNX Control')
  }
  return self.kind === 'registered' ? tunnelText(self.tunnel, machine) : ''
}

export function OrcaPitCompanyMachines({
  servers,
  busy,
  onPairingUrl
}: {
  servers: readonly SavedServer[]
  busy: boolean
  onPairingUrl: (pairingUrl: string, suggestedName: string) => void
}): React.JSX.Element | null {
  const api = orcaPitAppApi()
  const session = useOrcaPitAppSession()
  const [machines, setMachines] = useState<OrcaPitMachine[] | null>(null)
  const [self, setSelf] = useState<OrcaPitMachineSelfState>({ kind: 'idle' })
  const [loadError, setLoadError] = useState<string | null>(null)
  const [connecting, setConnecting] = useState<number | null>(null)
  const [rowError, setRowError] = useState<{ id: number; text: string } | null>(null)
  const signedIn = session?.kind === 'signed-in'

  const refresh = useCallback(
    async (force: boolean) => {
      if (!api) {
        return
      }
      const [list, own] = await Promise.all([api.listMachines(force), api.getMachineState()])
      setSelf(own)
      if (list.ok) {
        setMachines(list.machines)
        setLoadError(null)
      } else if (list.reason === 'unavailable') {
        setLoadError(
          list.message ??
            translate('devnx.machines.loadFailed', "Couldn't load the machines from DevNX Control.")
        )
      }
    },
    [api]
  )

  useEffect(() => {
    if (!signedIn) {
      return
    }
    void refresh(true)
    const timer = setInterval(() => void refresh(false), REFRESH_MS)
    return () => clearInterval(timer)
  }, [refresh, signedIn])

  if (!api || !signedIn) {
    return null
  }

  const connect = async (machine: OrcaPitMachine): Promise<void> => {
    const address = orcaPitMachineHttpsUrl(machine.publicUrl)
    if (!address) {
      return
    }
    setConnecting(machine.id)
    setRowError(null)
    try {
      const result = await api.loginToServer({ address })
      if (!result.ok) {
        setRowError({ id: machine.id, text: orcaPitServerLoginFailureText(result) })
        return
      }
      onPairingUrl(result.pairingUrl, machine.name)
    } finally {
      setConnecting(null)
    }
  }

  const selfId = self.kind === 'registered' ? self.machine.id : null
  const list = sortOrcaPitMachines(machines ?? [], selfId)
  return (
    <section className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-0.5">
          <h3 className="text-sm font-semibold">
            {translate('devnx.machines.title', 'Company machines')}
          </h3>
          <p className="text-xs text-muted-foreground">
            {translate(
              'devnx.machines.description',
              'Every Orca-Pit of the company, at orca.devnx.com.br. Connect signs in with your login.'
            )}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={translate('devnx.machines.refresh', 'Refresh')}
          onClick={() => void refresh(true)}
        >
          <RefreshCw className="size-3.5" />
        </Button>
      </div>
      {loadError ? <p className="text-xs text-destructive">{loadError}</p> : null}
      {machines === null && !loadError ? (
        <p className="text-xs text-muted-foreground">
          {translate('devnx.machines.loading', 'Loading machines…')}
        </p>
      ) : null}
      {machines !== null && list.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {translate(
            'devnx.machines.empty',
            'No machine yet. Each Orca-Pit joins the list when someone signs in on it.'
          )}
        </p>
      ) : null}
      <div className="divide-y divide-border rounded-md border border-border">
        {list.map((machine) => {
          const action = orcaPitMachineRowAction(machine, self, servers)
          const outdated = isOrcaPitMachineOutdated(machine, list)
          return (
            <div key={machine.id} className="flex items-center gap-3 px-3 py-2">
              <span
                className={cn(
                  'size-2 shrink-0 rounded-full',
                  machine.online ? 'bg-emerald-500' : 'bg-muted-foreground/40'
                )}
                title={
                  machine.online
                    ? translate('devnx.machines.online', 'Online')
                    : translate('devnx.machines.offline', 'Offline')
                }
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-sm font-medium">
                  <span className="truncate">{machine.name}</span>
                  <span className="truncate text-xs font-normal text-muted-foreground">
                    /{machine.slug}
                  </span>
                  {action.kind === 'this-computer' ? (
                    <span className="inline-flex items-center gap-0.5 rounded border border-border px-1 text-[10px] text-muted-foreground">
                      <Monitor className="size-2.5" />
                      {translate('devnx.machines.thisComputer', 'This computer')}
                    </span>
                  ) : null}
                </div>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <OrcaPitPersonAvatar
                    personKey={`u:${machine.owner.id}`}
                    name={machine.owner.name}
                    avatarUrl={machine.owner.avatarUrl}
                  />
                  <span className="truncate">{machine.owner.name}</span>
                  {machine.version ? <span>· {machine.version}</span> : null}
                  {outdated ? (
                    <span className="text-amber-700 dark:text-amber-300">
                      · {translate('devnx.machines.outdated', 'needs update')}
                    </span>
                  ) : null}
                </div>
                {action.kind === 'this-computer' ? (
                  <p className="text-xs text-muted-foreground">{selfText(self, machine)}</p>
                ) : null}
                {rowError?.id === machine.id ? (
                  <p className="text-xs text-destructive">{rowError.text}</p>
                ) : null}
              </div>
              <div className="shrink-0">
                {action.kind === 'connect' ? (
                  <Button
                    size="sm"
                    disabled={busy || connecting !== null}
                    onClick={() => void connect(machine)}
                  >
                    {connecting === machine.id ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : null}
                    {translate('devnx.machines.connect', 'Connect')}
                  </Button>
                ) : null}
                {action.kind === 'saved' ? (
                  <span className="text-xs text-muted-foreground">
                    {translate('devnx.machines.saved', 'Added')}
                  </span>
                ) : null}
                {action.kind === 'offline' ? (
                  <span className="text-xs text-muted-foreground">
                    {translate('devnx.machines.offline', 'Offline')}
                  </span>
                ) : null}
                {action.kind === 'pending' || action.kind === 'disabled' ? (
                  machine.canManage ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        void window.api.shell.openUrl(
                          `${DEVNX_CONTROL_WEB_URL}/maquinas/${machine.id}`
                        )
                      }
                    >
                      {action.kind === 'pending'
                        ? translate('devnx.machines.approve', 'Approve in Control')
                        : translate('devnx.machines.openInControl', 'Open in Control')}
                      <ExternalLink className="size-3" />
                    </Button>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      {action.kind === 'pending'
                        ? translate('devnx.machines.pending', 'Waiting for approval')
                        : translate('devnx.machines.disabledShort', 'Disabled')}
                    </span>
                  )
                ) : null}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
