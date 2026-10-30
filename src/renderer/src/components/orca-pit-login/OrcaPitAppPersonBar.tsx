// Orca-Pit: who is signed in to this app, over the sidebar's project list, with "Sign out" to
// hand the machine to someone else. Nothing shows when the app has no sign-in.
import type React from 'react'
import { LogOut } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { OrcaPitPersonAvatar } from '../sidebar/OrcaPitPersonAvatar'
import { signOutOrcaPitApp, useOrcaPitAppSession } from './orca-pit-app-session-store'

export function OrcaPitAppPersonBar(): React.JSX.Element | null {
  const state = useOrcaPitAppSession()
  if (state?.kind !== 'signed-in') {
    return null
  }
  const { person, offline } = state
  return (
    <div className="flex shrink-0 items-center gap-1.5 px-3 pb-1 pt-0.5 text-[11px] text-muted-foreground">
      <OrcaPitPersonAvatar
        personKey={`u:${person.id}`}
        name={person.name || person.email}
        avatarUrl={person.avatarUrl}
        size="sm"
        title={person.email}
      />
      <span className="min-w-0 truncate font-medium text-foreground">
        {person.name || person.email}
      </span>
      {offline ? (
        <span
          className="shrink-0 rounded-[4px] border border-amber-500/40 bg-amber-500/10 px-1 text-[10px] text-amber-800 dark:text-amber-300"
          title={translate(
            'devnx.appLogin.offlineHelp',
            'DevNX Control was unreachable at sign-in; you entered as the last person who signed in here.'
          )}
        >
          {translate('devnx.appLogin.offline', 'offline')}
        </span>
      ) : null}
      <button
        type="button"
        className="ml-auto inline-flex shrink-0 items-center gap-1 rounded px-1 py-0.5 hover:bg-accent hover:text-foreground"
        title={translate('devnx.appLogin.signOutHelp', 'Sign out so another person can sign in')}
        onClick={() => void signOutOrcaPitApp()}
      >
        <LogOut className="size-3" aria-hidden />
        {translate('devnx.appLogin.signOut', 'Sign out')}
      </button>
    </div>
  )
}
