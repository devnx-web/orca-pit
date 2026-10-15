// Orca-Pit: stands in for Orca's Updates section, whose updater is off in this fork. It reads
// the releases.json our release script publishes; see src/main/devnx-control/orca-pit-updates.
import type React from 'react'
import { useCallback, useEffect, useState } from 'react'
import { Download, Loader2, RefreshCw } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import type { OrcaPitUpdateCheck } from '../../../../shared/devnx-control-types'
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

export function OrcaPitUpdateSection(): React.JSX.Element {
  const [installed, setInstalled] = useState<string | null>(null)
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
    // Why check on open: the section is where people come to ask "is there a new one?".
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

  const newer = check.kind === 'done' ? check.result.newer : []
  const latest = check.kind === 'done' ? check.result.latest : null

  return (
    <section key="updates" className="space-y-4">
      <SettingsSubsectionHeader
        title={translate(
          'auto.components.settings.GeneralUpdateSettingsSection.f2b1ccc12a',
          'Updates'
        )}
        description={translate(
          'auto.components.settings.GeneralUpdateSettingsSection.d91ebfb87e',
          'Current version: {{value0}}',
          { value0: installed ?? '...' }
        )}
      />
      <SearchableSetting
        title={translate(
          'auto.components.settings.GeneralUpdateSettingsSection.e1a647adc5',
          'Check for Updates'
        )}
        description={translate(
          'devnx.updates.description',
          'Check for a newer Orca-Pit version and install it.'
        )}
        keywords={['update', 'version', 'release notes', 'changelog', 'orca-pit']}
        className="space-y-3"
      >
        <div className="flex items-center gap-3">
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
          {newer.length > 0 && latest ? (
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
                version: latest
              })}
            </Button>
          ) : null}
        </div>

        <p className="text-xs text-muted-foreground">
          {check.kind === 'checking' &&
            translate(
              'auto.components.settings.GeneralUpdateSettingsSection.31fd7150cf',
              'Checking for updates...'
            )}
          {check.kind === 'error' && check.message}
          {check.kind === 'done' &&
            newer.length === 0 &&
            translate('devnx.updates.upToDate', 'You are on the newest version.')}
          {installing &&
            translate(
              'devnx.updates.installing',
              'Installing. Enter the administrator password when asked; Orca-Pit restarts when it finishes.'
            )}
        </p>
        {installError ? <p className="text-xs text-destructive">{installError}</p> : null}

        {newer.length > 0 ? (
          <div className="space-y-3 rounded-md border border-border/60 p-3">
            {newer.map((release) => (
              <div key={release.version} className="space-y-1">
                <p className="text-xs font-semibold text-foreground">
                  {release.version}
                  {release.date ? (
                    <span className="ml-2 font-normal text-muted-foreground">{release.date}</span>
                  ) : null}
                </p>
                <ul className="list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
                  {release.notes.map((note) => (
                    <li key={note}>{plainNote(note)}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ) : null}
      </SearchableSetting>
    </section>
  )
}
