// Orca-Pit: one stable color per machine and per person, from a hash of their name or key, so
// "the green machine" means the same thing on every client and after every restart.

// Why literal class strings: Tailwind only emits classes it can read in the source.
const MACHINE_TONES = [
  'border-sky-500/35 bg-sky-500/12 text-sky-700 dark:text-sky-300',
  'border-emerald-500/35 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300',
  'border-amber-500/40 bg-amber-500/12 text-amber-800 dark:text-amber-300',
  'border-violet-500/35 bg-violet-500/12 text-violet-700 dark:text-violet-300',
  'border-rose-500/35 bg-rose-500/12 text-rose-700 dark:text-rose-300',
  'border-teal-500/35 bg-teal-500/12 text-teal-700 dark:text-teal-300',
  'border-orange-500/40 bg-orange-500/12 text-orange-800 dark:text-orange-300',
  'border-fuchsia-500/35 bg-fuchsia-500/12 text-fuchsia-700 dark:text-fuchsia-300'
] as const

const PERSON_TONES = [
  'bg-sky-600 text-white dark:bg-sky-500',
  'bg-emerald-600 text-white dark:bg-emerald-500',
  'bg-amber-600 text-white dark:bg-amber-500',
  'bg-violet-600 text-white dark:bg-violet-500',
  'bg-rose-600 text-white dark:bg-rose-500',
  'bg-teal-600 text-white dark:bg-teal-500',
  'bg-orange-600 text-white dark:bg-orange-500',
  'bg-fuchsia-600 text-white dark:bg-fuchsia-500'
] as const

/** FNV-1a: tiny, stable across runs and platforms, spreads short strings well. */
export function orcaPitHash(value: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

export function orcaPitToneIndex(value: string, size: number): number {
  return orcaPitHash(value.trim().toLowerCase()) % size
}

export function orcaPitMachineTone(machineName: string): string {
  return MACHINE_TONES[orcaPitToneIndex(machineName, MACHINE_TONES.length)]
}

export function orcaPitPersonTone(personKey: string): string {
  return PERSON_TONES[orcaPitToneIndex(personKey, PERSON_TONES.length)]
}
