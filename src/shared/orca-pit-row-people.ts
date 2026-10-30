// Orca-Pit: the people on an agent's sidebar row — whoever is looking at it now and whoever sent
// its last command — each once, the last author first, with what each of them is doing there.
import type { OrcaPitPaneAuthor } from './orca-pit-agent-authors'
import { orcaPitAge, orcaPitAuthorKey } from './orca-pit-agent-authors'
import type { OrcaPitPerson } from './orca-pit-presence'

export type OrcaPitRowPerson = {
  key: string
  name: string
  viewing: boolean
  /** When this person sent the pane's last command, or null. */
  lastCommandAt: number | null
}

export function orcaPitRowPeople(
  viewers: readonly OrcaPitPerson[] | null | undefined,
  author: OrcaPitPaneAuthor | null | undefined
): OrcaPitRowPerson[] {
  const people: OrcaPitRowPerson[] = []
  if (author?.name.trim()) {
    people.push({
      key: orcaPitAuthorKey(author),
      name: author.name.trim(),
      viewing: false,
      lastCommandAt: author.at
    })
  }
  for (const viewer of viewers ?? []) {
    const known = people.find((person) => person.key === viewer.key)
    if (known) {
      known.viewing = true
    } else {
      people.push({ key: viewer.key, name: viewer.name, viewing: true, lastCommandAt: null })
    }
  }
  return people
}

export type OrcaPitRowPeopleWords = {
  viewing: (name: string) => string
  lastCommand: (name: string, age: string) => string
  lastCommandNow: (name: string) => string
  both: (name: string, age: string) => string
  bothNow: (name: string) => string
  nowWord: string
}

/** "Fabio (looking now) · Ana (last command 3m ago)". */
export function orcaPitRowPeopleTitle(
  people: readonly OrcaPitRowPerson[],
  now: number,
  words: OrcaPitRowPeopleWords
): string {
  return people
    .map((person) => {
      if (person.lastCommandAt === null) {
        return words.viewing(person.name)
      }
      const age = orcaPitAge(person.lastCommandAt, now, words.nowWord)
      const justNow = age === words.nowWord
      if (person.viewing) {
        return justNow ? words.bothNow(person.name) : words.both(person.name, age)
      }
      return justNow ? words.lastCommandNow(person.name) : words.lastCommand(person.name, age)
    })
    .join(' · ')
}
