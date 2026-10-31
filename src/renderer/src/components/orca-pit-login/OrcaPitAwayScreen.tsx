// Orca-Pit: the screen after 10 minutes without anyone touching the computer, in the app and in
// the browser. Continuing needs no password: the session is still there. It only tells the
// diary when the person stopped and came back, which the Control turns into hours worked.
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Clock, Loader2, LogOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { OrcaPitPersonAvatar } from '../sidebar/OrcaPitPersonAvatar'
import { ORCA_PIT_LOGIN_ATTRIBUTE } from './orca-pit-app-session-store'

function clock(atMs: number): string {
  return new Date(atMs).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

export function OrcaPitAwayScreen({
  name,
  avatarUrl,
  personKey,
  since,
  onContinue,
  onSignOut
}: {
  name: string
  avatarUrl: string | null
  personKey: string
  /** When the person stopped (epoch ms); null when unknown. */
  since: number | null
  onContinue: () => Promise<void>
  onSignOut: () => Promise<void>
}): React.JSX.Element {
  useTranslation()
  const [busy, setBusy] = useState<'continue' | 'sign-out' | null>(null)
  const firstName = name.trim().split(/\s+/)[0] || name
  const run = (kind: 'continue' | 'sign-out', action: () => Promise<void>): void => {
    setBusy(kind)
    void action().finally(() => setBusy(null))
  }

  return (
    <div
      {...{ [ORCA_PIT_LOGIN_ATTRIBUTE]: '' }}
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-background px-4 py-6 text-foreground"
      role="dialog"
      aria-modal="true"
      aria-labelledby="orca-pit-away-title"
    >
      <div className="flex w-full max-w-[400px] flex-col items-center gap-4 rounded-lg border border-border bg-card p-6 text-center shadow-sm">
        <OrcaPitPersonAvatar personKey={personKey} name={name} avatarUrl={avatarUrl} size="md" />
        <div>
          <h1 id="orca-pit-away-title" className="text-base font-semibold leading-6">
            {translate('devnx.away.title', 'Are you still there?')}
          </h1>
          <p className="mt-1 flex items-center justify-center gap-1.5 text-sm leading-5 text-muted-foreground">
            <Clock size={14} aria-hidden />
            {since !== null
              ? translate('devnx.away.since', 'No activity on this computer since {{time}}.', {
                  time: clock(since)
                })
              : translate('devnx.away.noActivity', 'No activity on this computer for 10 minutes.')}
          </p>
        </div>
        <Button
          autoFocus
          disabled={busy !== null}
          className="w-full gap-2"
          onClick={() => run('continue', onContinue)}
        >
          {busy === 'continue' ? <Loader2 size={15} className="animate-spin" aria-hidden /> : null}
          {translate('devnx.away.continue', 'Continue as {{name}}', { name: firstName })}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={busy !== null}
          className="gap-2 text-muted-foreground"
          onClick={() => run('sign-out', onSignOut)}
        >
          <LogOut size={14} aria-hidden />
          {translate('devnx.away.notMe', 'Not me / Sign out')}
        </Button>
      </div>
    </div>
  )
}
