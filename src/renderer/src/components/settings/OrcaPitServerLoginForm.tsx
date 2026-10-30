// Orca-Pit: "Add server" by DevNX Control login. The person types the server's address (and, when
// nobody is signed in to this app, their e-mail and password); main signs in there and hands back
// the pairing link, which the pane verifies and saves like a pasted access link.
import { useState } from 'react'
import { Link2, Loader2, LogIn } from 'lucide-react'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { translate } from '@/i18n/i18n'
import type { OrcaPitServerLoginResult } from '../../../../shared/orca-pit-app-session'
import { OrcaPitPersonAvatar } from '../sidebar/OrcaPitPersonAvatar'
import { orcaPitAppApi, useOrcaPitAppSession } from '../orca-pit-login/orca-pit-app-session-store'
import {
  RuntimeHostAccessFailureAlert,
  type RuntimeHostAccessFailure
} from './RuntimeHostAccessFailureAlert'

type Failure = Extract<OrcaPitServerLoginResult, { ok: false }>

// Why untranslated: an address, the company's own server.
const EXAMPLE_ADDRESS = 'orca.devnx.com.br'

export function orcaPitServerLoginFailureText(failure: Failure): string {
  switch (failure.reason) {
    case 'invalid-address':
      return translate(
        'devnx.serverLogin.invalidAddress',
        'Enter the server address, like orca.devnx.com.br.'
      )
    case 'needs-credentials':
      return translate('devnx.serverLogin.needsCredentials', 'Enter your e-mail and password.')
    case 'unreachable':
      return translate(
        'devnx.serverLogin.unreachable',
        "Couldn't reach this server. Check the address and that Orca-Pit is open there."
      )
    case 'no-login':
      return translate(
        'devnx.serverLogin.noLogin',
        'This server has no DevNX Control login. Update Orca-Pit there, or use an access link.'
      )
    case 'bad-credentials':
      return translate(
        'devnx.serverLogin.badCredentials',
        'The server did not accept this login. Sign out and in again, or check e-mail and password.'
      )
    case 'wrong-tenant':
      return translate(
        'devnx.serverLogin.wrongTenant',
        "You do not share a company with this server's DevNX Control."
      )
    case 'too-many':
      return failure.retryAfterSeconds
        ? translate(
            'devnx.serverLogin.tooManyWait',
            'Too many attempts. Try again in {{minutes}} min.',
            { minutes: Math.max(1, Math.ceil(failure.retryAfterSeconds / 60)) }
          )
        : translate('devnx.serverLogin.tooMany', 'Too many attempts. Wait a few minutes.')
    default:
      return translate(
        'devnx.serverLogin.unavailable',
        "The server couldn't reach DevNX Control. Try again."
      )
  }
}

export function OrcaPitServerLoginForm({
  name,
  busy,
  failure,
  onNameChange,
  onCancel,
  onUseLink,
  onPairingUrl
}: {
  name: string
  /** The pane is verifying and saving the server. */
  busy: boolean
  failure: RuntimeHostAccessFailure | null
  onNameChange: (value: string) => void
  onCancel: () => void
  onUseLink: () => void
  onPairingUrl: (pairingUrl: string, suggestedName: string) => void
}): React.JSX.Element {
  const session = useOrcaPitAppSession()
  const person = session?.kind === 'signed-in' && !session.offline ? session.person : null
  const [address, setAddress] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [signingIn, setSigningIn] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const working = busy || signingIn
  const canSubmit = Boolean(address.trim()) && (person !== null || (email.trim() && password))

  const submit = async (): Promise<void> => {
    const api = orcaPitAppApi()
    if (!api || !canSubmit) {
      return
    }
    setError(null)
    setSigningIn(true)
    try {
      const result = await api.loginToServer(
        person ? { address } : { address, email: email.trim(), password }
      )
      if (!result.ok) {
        setError(orcaPitServerLoginFailureText(result))
        return
      }
      setPassword('')
      onPairingUrl(result.pairingUrl, result.suggestedName)
    } catch {
      setError(orcaPitServerLoginFailureText({ ok: false, reason: 'unreachable' }))
    } finally {
      setSigningIn(false)
    }
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="orca-pit-server-address">
          {translate('devnx.serverLogin.address', 'Server address')}
        </Label>
        <Input
          id="orca-pit-server-address"
          value={address}
          disabled={working}
          onChange={(event) => {
            setAddress(event.target.value)
            setError(null)
          }}
          placeholder={EXAMPLE_ADDRESS}
          className="min-w-0 font-mono"
          autoFocus
        />
      </div>

      {person ? (
        <div className="flex items-center gap-2 rounded-md border border-border/60 bg-background/60 px-3 py-2 text-sm">
          <OrcaPitPersonAvatar
            personKey={`u:${person.id}`}
            name={person.name || person.email}
            avatarUrl={person.avatarUrl}
            size="sm"
          />
          <span className="min-w-0 truncate">
            {translate('devnx.serverLogin.signedInAs', 'You enter as {{name}}', {
              name: person.name || person.email
            })}
          </span>
        </div>
      ) : (
        <>
          <div className="space-y-2">
            <Label htmlFor="orca-pit-server-email">
              {translate('devnx.webLogin.email', 'E-mail')}
            </Label>
            <Input
              id="orca-pit-server-email"
              type="email"
              value={email}
              disabled={working}
              autoComplete="username"
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="orca-pit-server-password">
              {translate('devnx.webLogin.password', 'Password')}
            </Label>
            <Input
              id="orca-pit-server-password"
              type="password"
              value={password}
              disabled={working}
              autoComplete="current-password"
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
        </>
      )}

      <div className="space-y-2">
        <Label htmlFor="orca-pit-server-name">
          {translate('auto.components.settings.RuntimeHostAccessForm.nameLabel', 'Name')}{' '}
          <span className="font-normal text-muted-foreground">
            {translate('auto.components.settings.RuntimeHostAccessForm.optional', '(optional)')}
          </span>
        </Label>
        <Input
          id="orca-pit-server-name"
          value={name}
          disabled={working}
          onChange={(event) => onNameChange(event.target.value)}
          placeholder={address.trim() || EXAMPLE_ADDRESS}
        />
      </div>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {failure ? (
        <RuntimeHostAccessFailureAlert
          id="orca-pit-server-verification-error"
          failure={failure}
          endpoint={address.trim() || null}
        />
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button type="button" variant="link" size="sm" className="px-0" onClick={onUseLink}>
          <Link2 />
          {translate('devnx.serverLogin.useLink', 'Use an access link instead')}
        </Button>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={working}>
            {translate('auto.components.settings.RuntimeHostAccessForm.cancel', 'Cancel')}
          </Button>
          <Button type="submit" size="sm" disabled={!canSubmit || working}>
            {working ? <Loader2 className="animate-spin" /> : <LogIn />}
            {translate('devnx.serverLogin.submit', 'Sign in and add')}
          </Button>
        </div>
      </div>
    </form>
  )
}
