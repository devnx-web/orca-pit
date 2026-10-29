import { createCodexRuntimeHomeLaunchPreparation } from '../codex/codex-runtime-home-launch-preparation'
import { mainProcessState as state } from './main-process-state'
import { resolveDevnxControlCodexHome } from '../devnx-control/devnx-control-terminal-env'

export const prepareCodexRuntimeHomeForLaunch = createCodexRuntimeHomeLaunchPreparation({
  getRuntimeHome: () => state.codexRuntimeHome,
  getSettings: () => state.store?.getSettings(),
  // Orca-Pit: while DevNX Control is connected it owns the Codex account, and Orca's
  // resolver is skipped so it never syncs auth into ~/.codex behind the panel's back.
  resolveOverrideHome: resolveDevnxControlCodexHome
})

/** Launch preparation and side-effect-free catalog reads must resolve one account-home key. */
export const codexStructuredLaunchHomeResolvers = {
  prepareCodexStructuredLaunch: ({ launchEnv }: { launchEnv: NodeJS.ProcessEnv }) =>
    prepareCodexRuntimeHomeForLaunch(undefined, launchEnv),
  // Throw like preparation: null would silently key the catalog to the system home instead of the account.
  resolveCodexStructuredLaunchHome: ({ launchEnv }: { launchEnv: NodeJS.ProcessEnv }) => {
    const runtimeHome = state.codexRuntimeHome
    if (!runtimeHome) {
      throw new Error('Codex runtime home service is not initialized')
    }
    return runtimeHome.resolveHostCodexHomePathForLaunchReadOnly(launchEnv)
  }
}
