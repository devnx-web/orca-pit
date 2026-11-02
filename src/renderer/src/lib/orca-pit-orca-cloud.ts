// Orca-Pit: the screens of Orca's own cloud (onorca.dev) that this fork hides. People sign in to
// the DevNX Control, never to an Orca account, so the account pane, artifact links, shared skills
// and feedback to Stably have nothing to do here; main refuses them too (orca-pit-orca-cloud).
// Hidden only in the built app, like main's gate: dev runs and Orca's tests keep its screens.
export const ORCA_PIT_ORCA_CLOUD_OFF: boolean = import.meta.env.PROD

const HIDDEN_SETTINGS_SECTIONS: ReadonlySet<string> = new Set([
  'orca-account',
  'artifacts',
  'share-skills'
])

export function isOrcaPitHiddenSettingsSection(id: string): boolean {
  return ORCA_PIT_ORCA_CLOUD_OFF && HIDDEN_SETTINGS_SECTIONS.has(id)
}
