import { useEffect, useState } from 'react'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { orcaPitAppApi } from '../orca-pit-login/orca-pit-app-session-store'
import { OrcaPitServerLoginForm } from './OrcaPitServerLoginForm'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog'
import { RuntimeHostAccessForm } from './RuntimeHostAccessForm'
import type { RuntimeHostAccessFailure } from './RuntimeHostAccessFailureAlert'

type RuntimeAddServerDialogProps = {
  open: boolean
  name: string
  accessLink: string
  busy: boolean
  failure: RuntimeHostAccessFailure | null
  onNameChange: (value: string) => void
  onAccessLinkChange: (value: string) => void
  onClose: () => void
  onSubmit: (allowLoopback: boolean) => void
  /** Orca-Pit: a pairing link obtained by DevNX Control login, verified and saved like a paste. */
  onSubmitPairingUrl: (pairingUrl: string, suggestedName: string) => void
}

export function RuntimeAddServerDialog({
  open,
  name,
  accessLink,
  busy,
  failure,
  onNameChange,
  onAccessLinkChange,
  onClose,
  onSubmit,
  onSubmitPairingUrl
}: RuntimeAddServerDialogProps): React.JSX.Element {
  const takenNames = useAppStore((state) => state.runtimeEnvironments)
  // Orca-Pit: the desktop signs in with the DevNX Control by default; the link stays one click away.
  const [mode, setMode] = useState<'login' | 'link'>('login')
  useEffect(() => {
    if (open) {
      setMode(orcaPitAppApi() ? 'login' : 'link')
    }
  }, [open])
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          onClose()
        }
      }}
    >
      <DialogContent scrollable>
        <DialogHeader>
          <DialogTitle>
            {translate('auto.components.settings.serverList.addTitle', 'Add server')}
          </DialogTitle>
          <DialogDescription>
            {mode === 'login'
              ? translate(
                  'devnx.serverLogin.description',
                  'Sign in to the other Orca-Pit with your DevNX Control login.'
                )
              : translate(
                  'auto.components.settings.serverList.addDescriptionShort',
                  'Paste the access link from Share this computer on the other machine.'
                )}
          </DialogDescription>
        </DialogHeader>
        {mode === 'login' ? (
          <OrcaPitServerLoginForm
            name={name}
            busy={busy}
            failure={failure}
            onNameChange={onNameChange}
            onCancel={onClose}
            onUseLink={() => setMode('link')}
            onPairingUrl={onSubmitPairingUrl}
          />
        ) : (
          <RuntimeHostAccessForm
            name={name}
            takenNames={takenNames}
            accessLink={accessLink}
            busy={busy}
            failure={failure}
            onNameChange={onNameChange}
            onAccessLinkChange={onAccessLinkChange}
            onCancel={onClose}
            onSubmit={onSubmit}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
