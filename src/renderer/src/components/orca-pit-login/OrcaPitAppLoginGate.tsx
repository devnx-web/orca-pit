// Orca-Pit: on a machine paired with the DevNX Control the app opens behind this sign-in screen,
// so whoever uses it is named on everything they do. The app keeps running underneath (agents,
// terminals, the server other people reach); only the screen and the keys wait for the person.
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, LogIn, Server } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { translate } from '@/i18n/i18n'
import type { OrcaPitAppLoginFailure } from '../../../../shared/orca-pit-app-session'
import {
  loadOrcaPitAppSession,
  orcaPitAppApi,
  ORCA_PIT_LOGIN_ATTRIBUTE,
  setOrcaPitAppSession,
  useOrcaPitAppSession
} from './orca-pit-app-session-store'

export function orcaPitAppLoginFailureText(reason: OrcaPitAppLoginFailure): string {
  switch (reason) {
    case 'bad-credentials':
      return translate('devnx.appLogin.badCredentials', 'Wrong e-mail or password.')
    case 'wrong-tenant':
      return translate(
        'devnx.appLogin.wrongTenant',
        "This user does not share a company with this computer's DevNX Control."
      )
    default:
      return translate(
        'devnx.appLogin.unavailable',
        "Couldn't reach DevNX Control. Offline, only the last person who signed in here in the past 12 hours can enter."
      )
  }
}

export function OrcaPitAppLoginGate({ children }: { children: ReactNode }): React.JSX.Element {
  const state = useOrcaPitAppSession()
  useEffect(() => {
    void loadOrcaPitAppSession()
  }, [])
  return (
    <>
      {/* Why inert and not unmounted: the app's own work (sessions, automations) keeps going. */}
      <div className="contents" inert={state === null || state.kind === 'signed-out'}>
        {children}
      </div>
      {state === null ? (
        <div
          className="fixed inset-0 z-[1000] bg-background"
          {...{ [ORCA_PIT_LOGIN_ATTRIBUTE]: '' }}
        />
      ) : state.kind === 'signed-out' ? (
        <OrcaPitAppLoginScreen rememberedEmail={state.rememberedEmail} />
      ) : null}
    </>
  )
}

function OrcaPitAppLoginScreen({
  rememberedEmail
}: {
  rememberedEmail: string | null
}): React.JSX.Element {
  useTranslation()
  const [email, setEmail] = useState(rememberedEmail ?? '')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    const api = orcaPitAppApi()
    if (!api) {
      return
    }
    setError(null)
    setSubmitting(true)
    try {
      const result = await api.login(email.trim(), password)
      if (result.ok) {
        setPassword('')
        setOrcaPitAppSession(result.state)
      } else {
        setError(orcaPitAppLoginFailureText(result.reason))
      }
    } catch {
      setError(orcaPitAppLoginFailureText('unavailable'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      {...{ [ORCA_PIT_LOGIN_ATTRIBUTE]: '' }}
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-background px-4 py-6 text-foreground"
    >
      <form
        onSubmit={(event) => void submit(event)}
        className="flex w-full max-w-[420px] flex-col gap-5 rounded-lg border border-border bg-card p-5 shadow-sm"
      >
        <div className="flex items-start gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-muted">
            <Server size={18} aria-hidden />
          </div>
          <div className="min-w-0">
            <h1 className="text-base font-semibold leading-6">
              {translate('devnx.appLogin.title', 'Who is using Orca-Pit?')}
            </h1>
            <p className="mt-1 text-sm leading-5 text-muted-foreground">
              {translate(
                'devnx.appLogin.description',
                'Sign in with your DevNX Control e-mail and password. What you do here is signed with your name.'
              )}
            </p>
          </div>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="orca-pit-app-login-email">
            {translate('devnx.webLogin.email', 'E-mail')}
          </Label>
          <Input
            id="orca-pit-app-login-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="username"
            autoFocus={!rememberedEmail}
            required
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="orca-pit-app-login-password">
            {translate('devnx.webLogin.password', 'Password')}
          </Label>
          <Input
            id="orca-pit-app-login-password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            autoFocus={Boolean(rememberedEmail)}
            required
          />
        </div>
        {error ? (
          <div
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {error}
          </div>
        ) : null}
        <Button
          type="submit"
          disabled={submitting || !email.trim() || !password}
          className="gap-2 self-end"
        >
          {submitting ? (
            <Loader2 size={15} className="animate-spin" aria-hidden />
          ) : (
            <LogIn size={15} aria-hidden />
          )}
          {translate('devnx.webLogin.submit', 'Sign in')}
        </Button>
      </form>
    </div>
  )
}
