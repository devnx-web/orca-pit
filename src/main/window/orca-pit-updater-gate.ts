import { app } from 'electron'

// Orca-Pit: the packaged updater feeds from Stably's releases, which would replace this fork
// (DevNX Control, pt-BR) on the next check. An installed Orca-Pit never wires or runs it; new
// versions come from our own package. Unpackaged runs keep Orca's own (inert) dev behavior.
export function isForkUpdaterOff(): boolean {
  return app.isPackaged
}
