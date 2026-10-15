// Orca-Pit: Help → About opens our "About Orca-Pit" (Settings → General), since the native
// panel only fits a version line and ours lists the releases and installs updates.
import { translateMain } from '../i18n/main-i18n'
import { isForkUpdaterOff } from '../window/orca-pit-updater-gate'

/** The tail of the Windows/Linux Help menu: About, then Check for Updates. */
export function aboutMenuItems(
  checkForUpdatesItem: Electron.MenuItemConstructorOptions,
  openOrcaPitAbout: () => void
): Electron.MenuItemConstructorOptions[] {
  return [
    { type: 'separator' },
    isForkUpdaterOff()
      ? { label: translateMain('devnx.aboutMenu', 'About Orca-Pit'), click: openOrcaPitAbout }
      : { role: 'about' },
    checkForUpdatesItem
  ]
}
