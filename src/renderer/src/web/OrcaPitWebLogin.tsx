// Orca-Pit: on a central Orca with the DevNX Control login, people sign in with e-mail and
// password instead of pasting a pairing link. The link screen stays one click away, and a server
// without the login shows it right away.
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, LogIn, Server } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { i18n, loadRendererUiLanguage, translate } from '@/i18n/i18n'
import { UI_LANGUAGE_PORTUGUESE } from '../../../shared/ui-language'
import { parseWebPairingInput, type WebPairingOffer } from './web-pairing'
import {
  browserPrefersPortuguese,
  probeOrcaPitLogin,
  submitOrcaPitLogin,
  type OrcaPitWebLoginResult
} from './orca-pit-web-login'

type OrcaPitWebLoginProps = {
  /** The upstream pairing-link screen. */
  fallback: ReactNode
  onOffer: (offer: WebPairingOffer) => void
}

function failureMessage(kind: Exclude<OrcaPitWebLoginResult['kind'], 'ok'>): string {
  switch (kind) {
    case 'bad-credentials':
      return translate('devnx.webLogin.badCredentials', 'Wrong e-mail or password.')
    case 'wrong-tenant':
      return translate(
        'devnx.webLogin.wrongTenant',
        "This user does not belong to this Orca's company."
      )
    case 'too-many':
      return translate(
        'devnx.webLogin.tooMany',
        'Too many attempts. Wait a few minutes and try again.'
      )
    default:
      return translate('devnx.webLogin.unavailable', "Couldn't reach DevNX Control. Try again.")
  }
}

export function OrcaPitWebLogin({ fallback, onOffer }: OrcaPitWebLoginProps): React.JSX.Element {
  const [probe, setProbe] = useState<'checking' | 'available' | 'absent'>('checking')
  const [showPairingLink, setShowPairingLink] = useState(false)

  useEffect(() => {
    let cancelled = false
    void probeOrcaPitLogin().then(async (available) => {
      if (available && browserPrefersPortuguese(navigator.languages ?? [navigator.language])) {
        // No settings exist before pairing; a failed catalog load just keeps English.
        await loadRendererUiLanguage(UI_LANGUAGE_PORTUGUESE)
          .then((locale) => i18n.changeLanguage(locale))
          .catch(() => {})
      }
      if (!cancelled) {
        setProbe(available ? 'available' : 'absent')
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  if (probe === 'checking') {
    return <div className="min-h-dvh bg-background" />
  }
  if (probe === 'absent' || showPairingLink) {
    return <>{fallback}</>
  }
  return <OrcaPitLoginForm onOffer={onOffer} onUsePairingLink={() => setShowPairingLink(true)} />
}

function OrcaPitLoginForm({
  onOffer,
  onUsePairingLink
}: {
  onOffer: (offer: WebPairingOffer) => void
  onUsePairingLink: () => void
}): React.JSX.Element {
  useTranslation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    const result = await submitOrcaPitLogin(email.trim(), password)
    setSubmitting(false)
    if (result.kind !== 'ok') {
      setError(failureMessage(result.kind))
      return
    }
    const offer = parseWebPairingInput(result.pairingUrl)
    if (offer?.scope !== 'runtime') {
      setError(failureMessage('unavailable'))
      return
    }
    setPassword('')
    onOffer(offer)
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4 py-6 text-foreground">
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
              {translate('devnx.webLogin.title', 'Sign in to Orca')}
            </h1>
            <p className="mt-1 text-sm leading-5 text-muted-foreground">
              {translate(
                'devnx.webLogin.description',
                'Use your DevNX Control e-mail and password.'
              )}
            </p>
          </div>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="orca-pit-login-email">
            {translate('devnx.webLogin.email', 'E-mail')}
          </Label>
          <Input
            id="orca-pit-login-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="username"
            required
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="orca-pit-login-password">
            {translate('devnx.webLogin.password', 'Password')}
          </Label>
          <Input
            id="orca-pit-login-password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            required
          />
        </div>
        {error && (
          <div
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {error}
          </div>
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          <Button type="button" variant="link" size="sm" onClick={onUsePairingLink}>
            {translate('devnx.webLogin.usePairingLink', 'Use a pairing link')}
          </Button>
          <Button
            type="submit"
            disabled={submitting || !email.trim() || !password}
            className="gap-2"
          >
            {submitting ? (
              <Loader2 size={15} className="animate-spin" aria-hidden />
            ) : (
              <LogIn size={15} aria-hidden />
            )}
            {translate('devnx.webLogin.submit', 'Sign in')}
          </Button>
        </div>
      </form>
    </div>
  )
}
