/**
 * Reading atlas trees made in other planners.
 *
 * poeplanner.com — `poeplanner.com/atlas-tree/<base64>`. Bytes, little-endian:
 *   u16 serialisation version, u16 poeplanner tree version, u8 "is PoE 2" (only
 *   from serialisation 5), u16 node count, u16 node id per node, then (from
 *   serialisation 4) u16 length + gzip of the notes. Tree versions are
 *   poeplanner's own numbering (their versions.json); Ruthless trees have their
 *   own numbers and are not ours to open. The format has no place for the
 *   effect picked on a multiple-choice notable, so those come in unpicked.
 *
 * hypostasis.faith — `#t=<code>` or the long `#s=id,id:choice,...`. The short
 * code walks the tree breadth-first from the start node (neighbours by
 * ascending id), one bit per node reached plus the picked effect for a
 * multiple-choice node, behind a 24-bit FNV-1a checksum of the plain
 * selection. Nothing says which tree it was made on; the checksum does, so each
 * tree we have is tried until one matches. Ported from their share.js.
 *
 * Neither site lists the free junction next to the Atlas centre (it is their
 * start node), while this tool keeps it in the allocated set, so it is added.
 */
import type { Tree } from './tree-types';
import { TREE_VERSIONS } from './tree-versions';

export class ExternalImportError extends Error {}

export interface ExternalPlan {
  source: 'poeplanner' | 'hypostasis';
  treeVersion: number;
  allocated: string[];
  choices: Record<string, number>;
  /** multiple-choice notables that came in without a pick */
  unpicked: number;
  /** allocated nodes with no allocated path to the centre on our tree */
  disconnected: number;
}

type Parsed =
  | { kind: 'poeplanner'; bytes: Uint8Array; poe2: boolean }
  | { kind: 'hypostasis-short'; code: string }
  | { kind: 'hypostasis-long'; items: [number, number | undefined][] };

/** poeplanner tree version -> ours. Gaps are Ruthless trees. */
const POEPLANNER_TREES: Record<number, number> = { 28: 1, 30: 2 };
const POEPLANNER_RUTHLESS = new Set([25, 27, 29]);

/** Whether the text is something this module should handle at all. */
export function looksExternal(text: string): boolean {
  return parse(text.trim()) !== null;
}

function parse(text: string): Parsed | null {
  const pp = /poeplanner\.com\/(atlas-tree2?)\/([A-Za-z0-9+/_\-=%]+)/.exec(text);
  if (pp) {
    return {
      kind: 'poeplanner',
      bytes: base64Bytes(decodeURIComponent(pp[2])),
      poe2: pp[1] === 'atlas-tree2',
    };
  }
  if (/hypostasis\.faith/.test(text) || /^#?[ts]=/.test(text)) {
    const short = /[#&]?t=([\w-]+)/.exec(text);
    if (short) return { kind: 'hypostasis-short', code: short[1] };
    const long = /[#&]?s=([\d,:]+)/.exec(text);
    if (long) {
      const items = long[1]
        .split(',')
        .filter(Boolean)
        .map((part): [number, number | undefined] => {
          const [id, choice] = part.split(':');
          return [Number(id), choice === undefined ? undefined : Number(choice)];
        });
      return { kind: 'hypostasis-long', items };
    }
    throw new ExternalImportError('That hypostasis link has no tree in it.');
  }
  return null;
}

/**
 * Turns a pasted link into a plan. `treeFor` hands out the tree for a version;
 * a hypostasis code may need several before its checksum matches.
 */
export async function readExternal(
  text: string,
  currentVersion: number,
  treeFor: (version: number) => Promise<Tree>,
): Promise<ExternalPlan> {
  const parsed = parse(text.trim());
  if (!parsed) throw new ExternalImportError('Not a poeplanner or hypostasis link.');

  if (parsed.kind === 'poeplanner') {
    const { treeVersion, ids } = readPoeplanner(parsed.bytes, parsed.poe2);
    return finish('poeplanner', await treeFor(treeVersion), treeVersion, ids, []);
  }

  // Current tree first: it is loaded already and almost always the right one.
  const order = [
    currentVersion,
    ...TREE_VERSIONS.map((v) => v.id)
      .filter((id) => id !== currentVersion)
      .sort((a, b) => b - a),
  ];
  for (const version of order) {
    const tree = await treeFor(version);
    const items =
      parsed.kind === 'hypostasis-short'
        ? decodeHypostasis(tree, parsed.code)
        : parsed.items.every(([id]) => tree.byId.has(String(id)))
          ? parsed.items
          : null;
    if (!items) continue;
    const ids = items.map(([id]) => id);
    const picks = items.filter((item): item is [number, number] => item[1] !== undefined);
    return finish('hypostasis', tree, version, ids, picks);
  }
  throw new ExternalImportError(
    parsed.kind === 'hypostasis-short'
      ? 'That hypostasis code does not match any atlas tree this tool has (or it was cut short).'
      : 'That hypostasis link names nodes no known atlas tree has.',
  );
}

function finish(
  source: ExternalPlan['source'],
  tree: Tree,
  treeVersion: number,
  ids: number[],
  picks: [number, number][],
): ExternalPlan {
  const allocated = new Set<number>();
  const unknown: number[] = [];
  for (const id of ids) {
    const node = tree.byId.get(String(id));
    if (!node) unknown.push(id);
    else if (node.allocatable) allocated.add(node.idx);
  }
  if (unknown.length > 0) {
    throw new ExternalImportError(
      `The ${source} tree has ${unknown.length} node(s) this atlas tree does not: ${unknown.slice(0, 5).join(', ')}.`,
    );
  }
  if (allocated.size > 0) {
    // The free junction(s) off the centre — the other planners' start node.
    for (let e = tree.offsets[tree.rootIdx]; e < tree.offsets[tree.rootIdx + 1]; e++) {
      const n = tree.nodes[tree.adjacency[e]];
      if (n.kind === 'structural' && n.allocatable) allocated.add(n.idx);
    }
  }
  const choices: Record<string, number> = {};
  for (const [id, choice] of picks) {
    const node = tree.byId.get(String(id));
    if (node && allocated.has(node.idx) && choice >= 0 && choice < node.variants.length) {
      choices[node.id] = choice;
    }
  }
  const unpicked = [...allocated].filter(
    (idx) => tree.nodes[idx].variants.length > 0 && choices[tree.nodes[idx].id] === undefined,
  ).length;
  return {
    source,
    treeVersion,
    allocated: [...allocated].map((idx) => tree.nodes[idx].id),
    choices,
    unpicked,
    disconnected: allocated.size - reachedFromCentre(tree, allocated),
  };
}

function reachedFromCentre(tree: Tree, allocated: Set<number>): number {
  const seen = new Set<number>([tree.rootIdx]);
  const queue = [tree.rootIdx];
  for (let head = 0; head < queue.length; head++) {
    const u = queue[head];
    for (let e = tree.offsets[u]; e < tree.offsets[u + 1]; e++) {
      const v = tree.adjacency[e];
      if (!seen.has(v) && allocated.has(v)) {
        seen.add(v);
        queue.push(v);
      }
    }
  }
  return seen.size - 1;
}

// --- poeplanner --------------------------------------------------------------

function base64Bytes(text: string): Uint8Array {
  const clean = text.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  let binary: string;
  try {
    binary = atob(clean + '='.repeat((4 - (clean.length % 4)) % 4));
  } catch {
    throw new ExternalImportError('That poeplanner link is damaged (not base64).');
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function readPoeplanner(
  bytes: Uint8Array,
  poe2Link = false,
): { treeVersion: number; ids: number[] } {
  if (poe2Link) throw new ExternalImportError('That is a Path of Exile 2 atlas tree.');
  let at = 0;
  const need = (n: number) => {
    if (at + n > bytes.length) throw new ExternalImportError('That poeplanner link is cut short.');
  };
  const u8 = () => (need(1), bytes[at++]);
  const u16 = () => (need(2), (at += 2), bytes[at - 2] | (bytes[at - 1] << 8));

  const serialisation = u16();
  if (serialisation < 1 || serialisation > 5) {
    throw new ExternalImportError(
      `poeplanner link format ${serialisation} is not one this tool reads.`,
    );
  }
  const theirVersion = u16();
  if (serialisation >= 5 && u8() !== 0) {
    throw new ExternalImportError('That is a Path of Exile 2 atlas tree.');
  }
  const count = u16();
  const ids: number[] = [];
  for (let i = 0; i < count; i++) ids.push(u16());

  const treeVersion = POEPLANNER_TREES[theirVersion];
  if (treeVersion === undefined) {
    throw new ExternalImportError(
      POEPLANNER_RUTHLESS.has(theirVersion)
        ? 'That is a Ruthless atlas tree; this tool only has the standard ones.'
        : `poeplanner atlas tree ${theirVersion} is not one this tool has (it knows ${TREE_VERSIONS.map((v) => v.label).join(', ')}).`,
    );
  }
  return { treeVersion, ids };
}

// --- hypostasis --------------------------------------------------------------

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const SUM = 4;
const width = (k: number) => Math.ceil(Math.log2(k + 1));

/** Their start node: the free junction next to our synthetic centre. */
function hypostasisStart(tree: Tree): number | null {
  for (let e = tree.offsets[tree.rootIdx]; e < tree.offsets[tree.rootIdx + 1]; e++) {
    const idx = tree.adjacency[e];
    if (tree.nodes[idx].kind === 'structural') return idx;
  }
  return null;
}

function checksum(items: [number, number | undefined][]): string {
  const s = items
    .slice()
    .sort((a, b) => a[0] - b[0])
    .map(([id, c]) => (c === undefined ? String(id) : `${id}:${c}`))
    .join(',');
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  h = ((h >>> 24) ^ h) & 0xffffff;
  let out = '';
  for (let i = 0; i < SUM; i++) out += B64[(h >>> (6 * (SUM - 1 - i))) & 63];
  return out;
}

/** [[id, choice or undefined], ...], or null if the code is not a tree of this graph. */
export function decodeHypostasis(tree: Tree, code: string): [number, number | undefined][] | null {
  if (code.length < SUM || /[^\w-]/.test(code)) return null;
  const start = hypostasisStart(tree);
  if (start === null) return null;

  const bits: number[] = [];
  for (const ch of code.slice(SUM)) {
    const x = B64.indexOf(ch);
    for (let b = 5; b >= 0; b--) bits.push((x >> b) & 1);
  }
  let pos = 0;
  let bad = false;
  const read = (n: number) => {
    let x = 0;
    while (n--) x = x * 2 + (bits[pos++] ?? 0);
    return x;
  };

  // Their graph is the export's edges without our synthetic centre.
  const neighbours = (idx: number) => {
    const out: number[] = [];
    for (let e = tree.offsets[idx]; e < tree.offsets[idx + 1]; e++) {
      const n = tree.adjacency[e];
      if (n !== tree.rootIdx) out.push(n);
    }
    return out.sort((a, b) => Number(tree.nodes[a].id) - Number(tree.nodes[b].id));
  };

  const items: [number, number | undefined][] = [];
  const seen = new Uint8Array(tree.nodes.length);
  seen[start] = 1;
  const queue = [start];
  for (let head = 0; head < queue.length; head++) {
    for (const idx of neighbours(queue[head])) {
      if (seen[idx]) continue;
      seen[idx] = 1;
      if (!read(1)) continue;
      const k = tree.nodes[idx].variants.length;
      const x = k ? read(width(k)) : 0;
      if (x > k) bad = true;
      items.push([Number(tree.nodes[idx].id), x ? x - 1 : undefined]);
      queue.push(idx);
    }
  }
  if (bad || items.length === 0 || bits.indexOf(1, pos) >= 0) return null;
  return checksum(items) === code.slice(0, SUM) ? items : null;
}
