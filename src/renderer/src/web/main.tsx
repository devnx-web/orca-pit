import '../assets/main.css'

import { Suspense, useMemo, useState } from 'react'
import { lazyWithRetry as lazy } from '@/lib/lazy-with-retry'
import ReactDOM from 'react-dom/client'
import { useTranslation } from 'react-i18next'
import WebConnect from './WebConnect'
import { RecoverableRenderErrorBoundary } from '../components/error-boundaries/RecoverableRenderErrorBoundary'
import {
  clearPairingInputFromAddressBar,
  decideWebPairingStartup,
  readPairingInputFromLocation,
  type WebPairingOffer
} from './web-pairing'
import {
  createStoredWebRuntimeEnvironment,
  readStoredWebRuntimeEnvironment,
  saveStoredWebRuntimeEnvironment
} from './web-runtime-environment'
import { installWebPreloadApi } from './web-preload-api'
import { initWebDeviceKeySupport } from './web-device-key-support'
import { WebPairingSecurityNotice } from './WebPairingSecurityNotice'
import { OrcaPitWebLogin } from './OrcaPitWebLogin'
import { OrcaPitWebPresenceGate } from './OrcaPitWebPresenceGate'
import { I18nProvider } from '../i18n/I18nProvider'
import { translate } from '../i18n/i18n'
import { installOsFileDropCancellationGuard } from '../lib/os-file-drop-cancellation-guard'
import { installBodyOverlayAttributes } from '../lib/body-overlay-attributes'
import { installAppKeyboardRouter } from '../lib/app-keyboard-router'
import {
  installOrcaPitLoginKeyGuard,
  isOrcaPitWebAway
} from '../components/orca-pit-login/orca-pit-app-session-store'

const disposeOsFileDropGuard = installOsFileDropCancellationGuard()
import.meta.hot?.dispose(disposeOsFileDropGuard)
const disposeBodyOverlayAttributes = installBodyOverlayAttributes()
import.meta.hot?.dispose(disposeBodyOverlayAttributes)
// Orca-Pit: while "Are you still there?" covers the page, app shortcuts wait (before the router).
const disposeAwayKeyGuard = installOrcaPitLoginKeyGuard(window, isOrcaPitWebAway)
import.meta.hot?.dispose(disposeAwayKeyGuard)
installAppKeyboardRouter()
const App = lazy(() => import('../App'))

// Orca-Pit: shared by `#pairing=` links and the DevNX Control login (OrcaPitWebLogin).
function saveRuntimeOffer(offer: WebPairingOffer): void {
  saveStoredWebRuntimeEnvironment(
    createStoredWebRuntimeEnvironment({
      name: 'Orca Server',
      offer,
      previousEnvironment: readStoredWebRuntimeEnvironment()
    })
  )
}

function WebRoot(): React.JSX.Element {
  const initialPairingInput = useMemo(() => readPairingInputFromLocation(window.location), [])
  // Why: current runtime links carry scope metadata. Runtime-scope offers keep
  // the instant save path; mobile/legacy-unknown offers must be shown/probed.
  const startupDecision = useMemo(() => {
    const decision = decideWebPairingStartup({
      initialPairingInput,
      hasStoredEnvironment: readStoredWebRuntimeEnvironment() !== null
    })
    if (
      decision.kind === 'auto-save-runtime-offer' ||
      (decision.kind === 'show-connect' && decision.initialPairingInput !== null)
    ) {
      clearPairingInputFromAddressBar()
    }
    return decision
  }, [initialPairingInput])
  const [hasEnvironment, setHasEnvironment] = useState(() => {
    if (startupDecision.kind === 'auto-save-runtime-offer') {
      saveRuntimeOffer(startupDecision.offer)
      return true
    }
    return startupDecision.kind === 'use-stored-environment'
  })

  if (!hasEnvironment) {
    const initialInput =
      startupDecision.kind === 'show-connect' ? startupDecision.initialPairingInput : null
    const connect = (
      <WebConnect initialPairingInput={initialInput} onConnected={() => setHasEnvironment(true)} />
    )
    // Orca-Pit: a server with the DevNX Control login asks for e-mail and password; the offer it
    // returns takes the same path as a `#pairing=` link.
    return initialInput === null ? (
      <OrcaPitWebLogin
        fallback={connect}
        onOffer={(offer) => {
          saveRuntimeOffer(offer)
          setHasEnvironment(true)
        }}
      />
    ) : (
      connect
    )
  }

  installWebPreloadApi()
  return (
    <>
      {/* Orca-Pit: "Are you still there?" after 10 idle minutes, for a browser with a login. */}
      <OrcaPitWebPresenceGate>
        <Suspense fallback={<div className="min-h-dvh bg-background" />}>
          <App />
        </Suspense>
      </OrcaPitWebPresenceGate>
      <WebPairingSecurityNotice />
    </>
  )
}

function WebRootBoundary(): React.JSX.Element {
  useTranslation()
  return (
    <RecoverableRenderErrorBoundary
      boundaryId="web.root"
      surface="web-root"
      title={translate('app.recoverableError.webTitle', 'Orca web hit a renderer error.')}
      description={translate(
        'app.recoverableError.webDescription',
        'Retry the web client or reconnect to the paired runtime.'
      )}
    >
      <WebRoot />
    </RecoverableRenderErrorBoundary>
  )
}

// Why await: where a new pairing may be stored depends on what this browser can keep secret.
void initWebDeviceKeySupport()
  .catch((error: unknown) => console.warn('[web] Device key probe failed', error))
  .finally(() => {
    ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
      <I18nProvider>
        <WebRootBoundary />
      </I18nProvider>
    )
  })

// Prime WebGL here because web hosts terminals too; dynamic import keeps the App/pane-manager graph out of startup.
void import('../lib/pane-manager/pane-webgl-renderer').then((module) =>
  module.primeTerminalWebglAddon()
)
