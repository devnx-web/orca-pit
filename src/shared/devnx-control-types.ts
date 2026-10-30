// DevNX Control: the team account broker (bcontrol) that picks the Claude,
// Codex and Antigravity session each terminal runs with.

export const DEVNX_CONTROL_PROVIDERS = ['claude', 'openai', 'gemini'] as const
export type DevnxControlProvider = (typeof DEVNX_CONTROL_PROVIDERS)[number]

export const DEVNX_CONTROL_DEFAULT_BASE_URL = 'https://bcontrol.devnx.com.br'
// The Control's own screens (the front), where a linked project opens.
export const DEVNX_CONTROL_WEB_URL = 'https://control.devnx.com.br'

export type DevnxControlUsageWindow = {
  percent: number | null
  resetsAt: string | null
}

export type DevnxControlAccount = {
  id: string
  provider: DevnxControlProvider
  label: string
  plan: string | null
  status: string
  selected: boolean
  fiveHour: DevnxControlUsageWindow
  weekly: DevnxControlUsageWindow
}

export type DevnxControlStatus = {
  connected: boolean
  baseUrl: string
  /** `cockpit` when borrowing the pairing the Cockpit already has on this machine. */
  source: 'orca' | 'cockpit' | null
  selected: Partial<Record<DevnxControlProvider, DevnxControlAccount>>
  lastSyncAt: string | null
  warnings: string[]
}

export type DevnxControlConnectInput = {
  baseUrl?: string
  email: string
  password: string
}

export type DevnxControlResult<T> = { ok: true; value: T } | { ok: false; error: string }

export type DevnxControlApi = {
  getStatus: () => Promise<DevnxControlStatus>
  connect: (input: DevnxControlConnectInput) => Promise<DevnxControlResult<DevnxControlStatus>>
  logout: () => Promise<DevnxControlResult<DevnxControlStatus>>
  refresh: (options?: { syncUsage?: boolean }) => Promise<DevnxControlResult<DevnxControlStatus>>
  listAccounts: () => Promise<DevnxControlResult<DevnxControlAccount[]>>
  selectAccount: (
    provider: DevnxControlProvider,
    accountId: string
  ) => Promise<DevnxControlResult<DevnxControlStatus>>
  /** The installed package version, `1.4.214-pit4`, or Orca's own outside the .deb. */
  getInstalledRelease: () => Promise<string>
  checkForUpdate: () => Promise<DevnxControlResult<OrcaPitUpdateCheck>>
  /** Installs the newest active release and restarts the app; resolves only on failure. */
  installUpdate: () => Promise<DevnxControlResult<null>>
  /** The menu's "Check for Updates…" asks the window to show the updater. */
  onOpenUpdates: (callback: () => void) => () => void
}

// Orca-Pit's own updater: Stably's is off in this fork, so new versions are announced by a
// manifest the release script publishes next to the packages.
export const ORCA_PIT_RELEASES_BASE_URL = 'https://arquivos.devnx.com.br/orca-pit'

export type OrcaPitRelease = {
  /** `1.4.214-pit4`: Orca's version plus the fork's build number. */
  version: string
  /** As written in ORCA-PIT-CHANGELOG.md, e.g. `15/10/2026`. */
  date: string
  notes: string[]
  /** False once withdrawn: no machine is offered it anymore. */
  active: boolean
}

export type OrcaPitUpdateCheck = {
  installed: string
  /** The newest active release, or null when the manifest lists none. */
  latest: string | null
  /** Active releases newer than the installed one, newest first. */
  newer: OrcaPitRelease[]
  /** Every published release, withdrawn included, newest first: the About history. */
  releases: OrcaPitRelease[]
}
