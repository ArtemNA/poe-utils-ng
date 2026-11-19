/**
 * Every atlas tree dataset the tool knows about.
 *
 * The `id` is baked into share codes, so it is a permanent contract: never
 * renumber an entry and never point an existing id at different data. When GGG
 * ships a new tree, drop its export into a new folder under public/assets/atlas
 * named after the league and add an entry here — old codes keep resolving to the
 * tree they were made against, and the version selector appears by itself once
 * there is more than one entry.
 */
import type { ArtPlacement } from './tree-types';

export interface AtlasTreeVersion {
  id: number;
  /**
   * The game version, and nothing else: Strategy compares it numerically to
   * decide which scarabs and embers exist. Two exports of one league share it.
   */
  label: string;
  /**
   * GGG's tag in grindinggear/atlastree-export. Shown beside the label when two
   * trees share one, so a patched tree can be told from the one before it.
   */
  export: string;
  /**
   * Folder under public/assets/atlas/ holding this tree's data *and* its sprite
   * sheets. Icons and sheet layouts change between leagues, so the whole set has
   * to move together — versioning the folder rather than the json is what keeps
   * an old tree renderable.
   */
  dir: string;
  /**
   * Where the Atlas painting goes. Nothing in the export says, and it changed
   * shape in 3.30 (a square of rings round the centre instead of a picture the
   * tree grows up from), so each tree carries its own.
   */
  art: ArtPlacement;
}

export const TREE_VERSIONS: readonly AtlasTreeVersion[] = [
  { id: 1, label: '3.29', export: '3.29.1', dir: '3.29', art: { kind: 'hanging' } },
  // 15552 = three times the 5184 px sheet. Fitted against three in-game
  // screenshots at two zoom levels: with the scale taken from the keystones at
  // +-6910 units, edge correlation of the painting peaks at 15550 on each one
  // (step 50) and the centre needs no offset. The export's own zoom for the
  // sheet (0.5, so 10368) and the earlier by-eye 25920 both correlate at ~0.
  { id: 2, label: '3.30', export: '3.30.0', dir: '3.30', art: { kind: 'centred', size: 15552 } },
  // 3.30.0c: two new multiple-choice notables (Celestial Presence, Runic
  // Distortion) and their links, 13 nodes moved, 6 stats reworded, new icon
  // sheets. New nodes change the walk a code is read along, so this could not
  // replace id 2. The keystones the painting was fitted to did not move.
  { id: 3, label: '3.30', export: '3.30.0c', dir: '3.30c', art: { kind: 'centred', size: 15552 } },
];

/** What the version selector shows: the game version, or the export when that is ambiguous. */
export function versionTitle(version: AtlasTreeVersion): string {
  const shared = TREE_VERSIONS.filter((v) => v.label === version.label).length > 1;
  return shared ? `${version.label} (${version.export})` : version.label;
}

/** Newest known tree — what a fresh session and a code-less link get. */
export const DEFAULT_TREE_VERSION = TREE_VERSIONS[TREE_VERSIONS.length - 1].id;

export function findTreeVersion(id: number): AtlasTreeVersion | null {
  return TREE_VERSIONS.find((v) => v.id === id) ?? null;
}
