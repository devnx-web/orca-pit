// Orca-Pit: "About Orca-Pit" — stands in for Orca's Updates section, whose updater is off in
// this fork, and for the native About panel, which only fits a version line. It reads the
// releases.json our release script publishes; see src/main/devnx-control/orca-pit-updates.
import type React from 'react'
import { useCallback, useEffect, useState } from 'react'
import { Download, Loader2, RefreshCw } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { ORCA_PIT_ABOUT_SECTION_ID } from '@/lib/orca-pit-open-updates'
import type { OrcaPitRelease, OrcaPitUpdateCheck } from '../../../../shared/devnx-control-types'
import { Button } from '../ui/button'
import { SearchableSetting } from './SearchableSetting'
import { SettingsSubsectionHeader } from './SettingsFormControls'

type CheckState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'done'; result: OrcaPitUpdateCheck }
  | { kind: 'error'; message: string }

// Why plain text: the notes come from the Markdown changelog, and the bold marks and code
// ticks would show up literally here.
function plainNote(note: string): string {
  return note.replace(/\*\*|`/g, '')
}

function Fact({
  label,
  value,
  tone = 'default'
}: {
  label: string
  value: string
  tone?: 'default' | 'good' | 'attention'
}): React.JSX.Element {
  return (
    <div className="min-w-0 rounded-md border border-border/60 px-3 py-2">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p
        className={cn(
          'truncate text-sm font-semibold',
          tone === 'good' && 'text-emerald-500',
          tone === 'attention' && 'text-amber-500'
        )}
      >
        {value}
      </p>
    </div>
  )
}

function ReleaseBadge({ children, tone }: { children: string; tone: 'good' | 'new' | 'muted' }) {
  return (
    <span
      className={cn(
        'rounded px-1.5 py-0.5 text-[10px] font-medium',
        tone === 'good' && 'bg-emerald-500/15 text-emerald-500',
        tone === 'new' && 'bg-amber-500/15 text-amber-500',
        tone === 'muted' && 'bg-muted text-muted-foreground line-through'
      )}
    >
      {children}
    </span>
  )
}

function ReleaseHistory({
  releases,
  installed,
  newerVersions
}: {
  releases: OrcaPitRelease[]
  installed: string | null
  newerVersions: ReadonlySet<string>
}): React.JSX.Element {
  return (
    <div className="divide-y divide-border/60 rounded-md border border-border/60">
      {releases.map((release) => (
        <div key={release.version} className={cn('space-y-1 p-3', !release.active && 'opacity-60')}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-foreground">{release.version}</span>
            {release.date ? (
              <span className="text-[11px] text-muted-foreground">{release.date}</span>
            ) : null}
            {release.version === installed ? (
              <ReleaseBadge tone="good">
                {translate('devnx.updates.badgeInstalled', 'Installed')}
              </ReleaseBadge>
            ) : null}
            {newerVersions.has(release.version) ? (
              <ReleaseBadge tone="new">{translate('devnx.updates.badgeNew', 'New')}</ReleaseBadge>
            ) : null}
            {!release.active ? (
              <ReleaseBadge tone="muted">
                {translate('devnx.updates.badgeWithdrawn', 'Withdrawn')}
              </ReleaseBadge>
            ) : null}
          </div>
          <ul className="list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
            {release.notes.map((note) => (
              <li key={note}>{plainNote(note)}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

export function OrcaPitUpdateSection(): React.JSX.Element {
  const [installed, setInstalled] = useState<string | null>(null)
  const [orcaVersion, setOrcaVersion] = useState<string | null>(null)
  const [check, setCheck] = useState<CheckState>({ kind: 'idle' })
  const [installing, setInstalling] = useState(false)
  const [installError, setInstallError] = useState<string | null>(null)

  const runCheck = useCallback(async () => {
    setCheck({ kind: 'checking' })
    const result = await window.api.devnxControl.checkForUpdate()
    setCheck(
      result.ok ? { kind: 'done', result: result.value } : { kind: 'error', message: result.error }
    )
  }, [])

  useEffect(() => {
    let cancelled = false
    void window.api.devnxControl.getInstalledRelease().then((version) => {
      if (!cancelled) {
        setInstalled(version)
      }
    })
    void window.api.updater.getVersion().then((version) => {
      if (!cancelled) {
        setOrcaVersion(version)
      }
    })
    // Why check on open: this is where people come to ask "is there a new one?".
    void runCheck()
    return () => {
      cancelled = true
    }
  }, [runCheck])

  const handleInstall = async (): Promise<void> => {
    setInstalling(true)
    setInstallError(null)
    // Resolves only when it did not install: on success the app restarts into the new version.
    const result = await window.api.devnxControl.installUpdate()
    setInstalling(false)
    if (!result.ok) {
      setInstallError(result.error)
    }
  }

  const result = check.kind === 'done' ? check.result : null
  const newer = result?.newer ?? []
  const status =
    check.kind === 'checking'
      ? {
          value: translate('devnx.updates.statusChecking', 'Checking…'),
          tone: 'default' as const
        }
      : check.kind === 'error'
        ? {
            value: translate('devnx.updates.statusUnknown', 'Could not check'),
            tone: 'attention' as const
          }
        : newer.length > 0
          ? {
              value: translate('devnx.updates.statusBehind', '{{count}} new version(s)', {
                count: newer.length
              }),
              tone: 'attention' as const
            }
          : result
            ? {
                value: translate('devnx.updates.statusCurrent', 'Up to date'),
                tone: 'good' as const
              }
            : { value: '—', tone: 'default' as const }

  return (
    <section
      key="updates"
      id={ORCA_PIT_ABOUT_SECTION_ID}
      data-settings-section={ORCA_PIT_ABOUT_SECTION_ID}
      className="space-y-4"
    >
      <SettingsSubsectionHeader
        title={translate('devnx.updates.title', 'About Orca-Pit')}
        description={translate(
          'devnx.updates.subtitle',
          'Orca with the DevNX Control accounts, in Portuguese. New versions are published by DevNX and installed from here.'
        )}
      />
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Fact
          label={translate('devnx.updates.factInstalled', 'Installed version')}
          value={installed ?? '…'}
        />
        <Fact
          label={translate('devnx.updates.factOrca', 'Based on Orca')}
          value={orcaVersion ?? '…'}
        />
        <Fact
          label={translate('devnx.updates.factLatest', 'Latest published')}
          value={result?.latest ?? '—'}
        />
        <Fact
          label={translate('devnx.updates.factStatus', 'Status')}
          value={status.value}
          tone={status.tone}
        />
      </div>

      <SearchableSetting
        title={translate(
          'auto.components.settings.GeneralUpdateSettingsSection.e1a647adc5',
          'Check for Updates'
        )}
        description={translate(
          'devnx.updates.description',
          'Check for a newer Orca-Pit version and install it.'
        )}
        keywords={['update', 'version', 'release notes', 'changelog', 'about', 'orca-pit']}
        className="space-y-3"
      >
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void runCheck()}
            disabled={check.kind === 'checking' || installing}
            className="gap-2"
          >
            {check.kind === 'checking' ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
            {translate(
              'auto.components.settings.GeneralUpdateSettingsSection.e1a647adc5',
              'Check for Updates'
            )}
          </Button>
          {newer.length > 0 && result?.latest ? (
            <Button
              variant="default"
              size="sm"
              onClick={() => void handleInstall()}
              disabled={installing}
              className="gap-2"
            >
              {installing ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Download className="size-3.5" />
              )}
              {translate('devnx.updates.install', 'Update to {{version}} and restart', {
                version: result.latest
              })}
            </Button>
          ) : null}
        </div>
        {check.kind === 'error' ? (
          <p className="text-xs text-destructive">{check.message}</p>
        ) : null}
        {installing ? (
          <p className="text-xs text-muted-foreground">
            {translate(
              'devnx.updates.installing',
              'Installing. Enter the administrator password when asked; Orca-Pit restarts when it finishes.'
            )}
          </p>
        ) : null}
        {installError ? <p className="text-xs text-destructive">{installError}</p> : null}
      </SearchableSetting>

      {result && result.releases.length > 0 ? (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground">
            {translate('devnx.updates.history', 'Releases')}
          </p>
          <ReleaseHistory
            releases={result.releases}
            installed={installed}
            newerVersions={new Set(newer.map((release) => release.version))}
          />
        </div>
      ) : null}
    </section>
  )
}
