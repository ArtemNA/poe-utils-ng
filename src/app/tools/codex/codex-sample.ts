/**
 * Examples, for a page that is otherwise empty.
 *
 * An empty Codex explains itself badly: the cards are the explanation, and
 * there are none. So one button fills in a strategy that looks like the ones
 * people actually write — scarabs from the real catalogue, a map roll, an
 * astrolabe, a couple of timed runs — and the page suddenly says what it is
 * for.
 *
 * Everything here is invented, and says so: each one is tagged `sample`, so
 * `tag:sample` finds all of them and they can be deleted in a few clicks. The
 * numbers are plausible rather than measured, and the scarab codes, names and
 * icons are the real ones out of `items.json`, so search and the icons on the
 * card behave exactly as they will with your own.
 *
 * None of them carries an `AT…`/`ST…` code. A made-up code would refuse to
 * open, and a card whose ⌖ leads nowhere would teach the wrong thing about the
 * one feature that matters — the real ones arrive from the Codex button in the
 * Atlas and in Map Strategy.
 */
import { ICON_BASE } from '../strategy/strategy-items';
import type { Entry, EntryData, Run } from './codex-types';

interface Sample {
  kind: Entry['kind'];
  title: string;
  data: EntryData;
  body: string;
  tags: string[];
  league?: string;
  status?: Entry['status'];
  runs?: Omit<Run, 'id' | 'at'>[];
}

const pick = (code: number, count: number, name: string, icon: string) => ({
  code,
  count,
  name,
  icon: `${ICON_BASE}${icon}`,
});

export const SAMPLES: Sample[] = [
  {
    kind: 'strategy',
    title: 'Legion + wisps (example)',
    league: '3.29',
    tags: ['sample', 'legion', 'day-4'],
    body:
      'Ran it for two evenings. The officers scarab is the whole strategy — without it the ' +
      'generals do not show up often enough to pay for the rest. Astrolabe slows the map down, ' +
      'so it only pays on the bigger layouts.',
    data: {
      k: 'strategy',
      src: {
        map: '8-mod Dunes, 41%+ pack size',
        astrolabe: 'Legion',
        picks: [
          { code: 38, count: 2 },
          { code: 39, count: 1 },
          { code: 108, count: 1 },
          { code: 101, count: 1 },
        ],
        snapshot: {
          treeVersion: 1,
          slots: 5,
          picks: [
            pick(38, 2, 'Legion Scarab', 'LesserScarabLegion.webp'),
            pick(39, 1, 'Legion Scarab of Officers', 'NormalScarabLegion.webp'),
            pick(108, 1, 'Scarab of Wisps', 'GreaterScarabMisc1.webp'),
            pick(101, 1, 'Scarab of Monstrous Lineage', 'LesserScarabMisc.webp'),
          ],
          points: 118,
          keystones: ['Wandering Path'],
          issues: [],
        },
      },
    },
    runs: [
      { minutes: 55, maps: 10, investDiv: 3, revenueDiv: 16, note: 'first evening' },
      { minutes: 62, maps: 11, investDiv: 2.5, revenueDiv: 15.5, note: 'same setup, better maps' },
    ],
  },
  {
    kind: 'strategy',
    title: 'Abyss ×5 (example)',
    league: '3.29',
    tags: ['sample', 'abyss', 'test'],
    body:
      'The cheap version: five plain abyss scarabs and nothing else. Pays less per hour than ' +
      'legion but costs almost nothing to set up, so it is the one to run while the scarabs ' +
      'for something better are still expensive.',
    data: {
      k: 'strategy',
      src: {
        map: 'T16.5, 90%+ quantity, currency chisel',
        astrolabe: 'Abyss',
        picks: [{ code: 42, count: 5 }],
        snapshot: {
          treeVersion: 1,
          slots: 5,
          picks: [pick(42, 5, 'Abyss Scarab', 'LesserScarabAbyss.webp')],
          points: 104,
          keystones: [],
          issues: [],
        },
      },
    },
    runs: [{ minutes: 60, maps: 11, investDiv: 3.17, revenueDiv: 12 }],
  },
  {
    kind: 'atlas',
    title: 'Cloister farm, somebody else’s tree (example)',
    league: '3.29',
    tags: ['sample', 'cloister'],
    body:
      'A tree off a stream, kept as the link it arrived as. Scarabs: 5× Divination Scarab of ' +
      'The Cloister, 8-mod maps. Nothing here is ours, so the card can only show the link — ' +
      'plan the same tree in the Atlas and press Codex there and it gains its points, its ' +
      'keystones and a picture of its shape.',
    data: { k: 'atlas', src: { url: 'https://poeplanner.com/a/6gTh' } },
  },
];

/** Runs need an id and a day; the samples are dated backwards from now. */
export function sampleRuns(sample: Sample, now: number, id: () => string): Run[] | undefined {
  if (!sample.runs) return undefined;
  return sample.runs.map((run, index) => ({
    ...run,
    id: id(),
    at: now - (sample.runs!.length - index) * 86_400_000,
  }));
}

export type { Sample };
