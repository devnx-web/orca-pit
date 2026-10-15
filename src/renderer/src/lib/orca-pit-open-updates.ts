// Orca-Pit: the menu's "Check for Updates…" lands on our updater in Settings → General.
import { useAppStore } from '../store'

export const ORCA_PIT_ABOUT_SECTION_ID = 'orca-pit-about'

export function installOrcaPitOpenUpdatesBridge(): () => void {
  return (
    window.api?.devnxControl?.onOpenUpdates?.(() => {
      useAppStore
        .getState()
        .openSettingsTarget({ pane: 'general', repoId: null, sectionId: ORCA_PIT_ABOUT_SECTION_ID })
    }) ?? (() => {})
  )
}
