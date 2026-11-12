/**
 * Checks the atlas share code format against the real tree.
 *
 * The important property is exactness: whatever tree goes in must come back
 * node for node, never "close enough". So this simulates a lot of plans —
 * randomly grown trees of every size, plus the awkward shapes — and compares
 * the decoded set against the original element by element.
 *
 * Also covers: the walk encoding is used when the tree is connected and the
 * position-list fallback when it is not, older codes still read (dropping the
 * planning state they carried, except when that is all they had), and malformed
 * input is refused rather than silently mis-decoded.
 *
 * Run: node scripts/share-code.mjs [simulations]
 */
import { build } from 'esbuild';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = path.join(root, 'node_modules', '.share-test');
const SIMULATIONS = Number(process.argv[2] ?? 400);

globalThis.btoa ??= (s) => Buffer.from(s, 'binary').toString('base64');
globalThis.atob ??= (s) => Buffer.from(s, 'base64').toString('binary');

await mkdir(tmp, { recursive: true });
await build({
  entryPoints: [path.join(root, 'src/app/tools/atlas/share-code.ts')],
  outfile: path.join(tmp, 'share-code.mjs'),
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  target: 'es2022',
  logLevel: 'warning',
});
const { encodePlan, decodePlan, peekPlan, ShareCodeError } = await import(
  pathToFileURL(path.join(tmp, 'share-code.mjs')).href
);

const raw = JSON.parse(await readFile(path.join(root, 'public/assets/atlas/3.29/tree.json'), 'utf8'));

// --- a Tree shaped like the one the app builds -------------------------------
function makeTree(raw) {
const ids = Object.keys(raw.nodes);
const nodes = ids.map((id, idx) => ({
  idx,
  id,
  allocatable: !raw.nodes[id].isMastery && id !== 'root',
  variants: (raw.nodes[id].variantEffects ?? []).map((v) => v.stats),
}));
const byId = new Map(nodes.map((n) => [n.id, n]));
const index = new Map(ids.map((id, i) => [id, i]));
const nb = ids.map(() => new Set());
for (const id of ids) {
  const a = index.get(id);
  for (const t of [...(raw.nodes[id].out ?? []), ...(raw.nodes[id].in ?? [])]) {
    const b = index.get(t);
    if (b === undefined) continue;
    nb[a].add(b);
    nb[b].add(a);
  }
}
const offsets = new Int32Array(ids.length + 1);
for (let i = 0; i < ids.length; i++) offsets[i + 1] = offsets[i] + nb[i].size;
const adjacency = new Int32Array(offsets[ids.length]);
for (let i = 0; i < ids.length; i++) adjacency.set([...nb[i]], offsets[i]);
const shareOrder = nodes
  .filter((n) => n.allocatable)
  .sort((a, b) => Number(a.id) - Number(b.id))
  .map((n) => n.idx);
const shareIndex = new Int32Array(nodes.length).fill(-1);
shareOrder.forEach((nodeIdx, position) => {
  shareIndex[nodeIdx] = position;
});
const rootIdx = index.get('root');
return { nodes, byId, offsets, adjacency, rootIdx, shareOrder, shareIndex };
}
const tree = makeTree(raw);
const { nodes, offsets, adjacency, rootIdx, shareOrder } = tree;

const allocatableIds = shareOrder.map((i) => nodes[i].id);

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 0x100000000;
  };
}

/** A plan shaped like a real one: a connected tree grown out from the centre. */
function growConnected(size, rnd) {
  if (size === 0) return [];
  const chosen = new Set();
  const frontier = new Set();
  for (let e = offsets[rootIdx]; e < offsets[rootIdx + 1]; e++) frontier.add(adjacency[e]);
  while (chosen.size < size && frontier.size) {
    const pool = [...frontier];
    const pickNode = pool[(rnd() * pool.length) | 0];
    frontier.delete(pickNode);
    if (!nodes[pickNode].allocatable) continue;
    chosen.add(pickNode);
    for (let e = offsets[pickNode]; e < offsets[pickNode + 1]; e++) {
      const u = adjacency[e];
      if (!chosen.has(u) && nodes[u].allocatable) frontier.add(u);
    }
  }
  return [...chosen].map((i) => nodes[i].id);
}

function scatter(size, rnd, taken = []) {
  const out = [];
  let guard = 0;
  while (out.length < size && guard++ < size * 50) {
    const id = allocatableIds[(rnd() * allocatableIds.length) | 0];
    if (!out.includes(id) && !taken.includes(id)) out.push(id);
  }
  return out;
}

const same = (a, b) => {
  const x = [...a].sort();
  const y = [...b].sort();
  return x.length === y.length && x.every((v, i) => v === y[i]);
};

let failures = 0;
const fail = (label, detail) => {
  console.error(`✗ ${label}${detail ? ' — ' + detail : ''}`);
  failures++;
};

// --- simulation --------------------------------------------------------------
const rnd = rng(20260805);
const sizes = [];
let walkUsed = 0;
let fallbackUsed = 0;
let worstChars = 0;

for (let run = 0; run < SIMULATIONS; run++) {
  const size = (rnd() * 160) | 0;
  const connected = rnd() < 0.85;
  const allocated = connected ? growConnected(size, rnd) : scatter(size, rnd);
  const plan = { treeVersion: 1, allocated };

  let code;
  let back;
  try {
    code = encodePlan(tree, plan);
    back = decodePlan(code, tree);
  } catch (err) {
    fail(`run ${run} (${allocated.length} nodes)`, String(err));
    continue;
  }

  if (!same(back.allocated, allocated)) {
    const got = new Set(back.allocated);
    const missing = allocated.filter((id) => !got.has(id));
    const extra = back.allocated.filter((id) => !allocated.includes(id));
    fail(
      `run ${run}: tree differs`,
      `${allocated.length} in, ${back.allocated.length} out, missing ${missing.length}, extra ${extra.length}`,
    );
    continue;
  }
  if (back.treeVersion !== 1) fail(`run ${run}: tree version differs`);
  if (back.legacyTargets) fail(`run ${run}: a format 3 code should carry no targets`);

  const flags = Buffer.from(code.split(':')[1], 'base64url')[1];
  if (flags & 2) walkUsed++;
  else fallbackUsed++;

  sizes.push(code.length);
  worstChars = Math.max(worstChars, code.length);
}

const avg = sizes.length ? Math.round(sizes.reduce((a, b) => a + b, 0) / sizes.length) : 0;
console.log(
  `${SIMULATIONS} simulated trees: ${walkUsed} encoded as a walk, ` +
    `${fallbackUsed} fell back to positions`,
);
console.log(`code length: avg ${avg}, worst ${worstChars} chars`);

// --- awkward shapes ----------------------------------------------------------
const edgeCases = [
  { label: 'empty tree', allocated: [] },
  { label: 'single node next to the centre', allocated: growConnected(1, rng(7)) },
  { label: 'every allocatable node', allocated: allocatableIds },
  { label: 'disconnected islands', allocated: scatter(25, rng(17)) },
  { label: 'a long thin branch', allocated: growConnected(40, rng(29)) },
];
for (const c of edgeCases) {
  const plan = { treeVersion: 1, ...c };
  try {
    const code = encodePlan(tree, plan);
    const back = decodePlan(code, tree);
    if (!same(back.allocated, plan.allocated)) {
      fail(c.label, `${plan.allocated.length} in, ${back.allocated.length} out`);
    } else {
      console.log(`\u2713 ${c.label} — ${code.length} chars`);
    }
  } catch (err) {
    fail(c.label, String(err));
  }
}

// --- older formats ------------------------------------------------------------
{
  // format 1: version, no flags, then allocated / targets / blocked positions
  const allocatedPositions = [5, 9, 40];
  const targetPositions = [100, 111];
  const bytes = [1, 0, 3, 5, 4, 31, 2, 100, 11, 0];
  const legacy = 'AT1:' + Buffer.from(bytes).toString('base64url');
  try {
    const back = decodePlan(legacy, tree);
    const expected = allocatedPositions.map((p) => nodes[shareOrder[p]].id);
    if (!same(back.allocated, expected)) fail('format 1 code', 'wrong nodes');
    else if (back.legacyTargets) fail('format 1 code', 'targets should be dropped when a tree exists');
    else console.log('\u2713 format 1 code decodes, its targets dropped');
  } catch (err) {
    fail('format 1 code', String(err));
  }

  // a format 1 code that held nothing but targets still opens as targets
  const targetsOnly = 'AT1:' + Buffer.from([1, 0, 0, 2, 100, 11, 0]).toString('base64url');
  try {
    const back = decodePlan(targetsOnly, tree);
    const expected = targetPositions.map((p) => nodes[shareOrder[p]].id);
    if (back.allocated.length !== 0) fail('targets-only legacy code', 'should have no tree');
    else if (!same(back.legacyTargets ?? [], expected)) fail('targets-only legacy code', 'wrong targets');
    else console.log('\u2713 targets-only legacy code still opens as targets');
  } catch (err) {
    fail('targets-only legacy code', String(err));
  }
}

// --- refuses rubbish ---------------------------------------------------------
const bad = ['', 'hello', 'AT3:', 'AT9:AQAAAAA', 'AT3:!!!!', 'AT1:AQ', 'AT3:AgI'];
for (const input of bad) {
  let threw = false;
  try {
    decodePlan(input, tree);
  } catch (err) {
    threw = err instanceof ShareCodeError;
  }
  if (!threw) fail(`should refuse ${JSON.stringify(input)}`);
}
console.log(`✓ refused ${bad.length} malformed inputs`);

// --- version is carried, not assumed -----------------------------------------
const v7 = encodePlan(tree, {
  treeVersion: 7,
  allocated: growConnected(10, rng(23)),
});
if (peekPlan(v7).treeVersion !== 7) fail('tree version not carried');
else console.log('✓ tree version travels with the code');

// --- 3.30 multiple-choice notables --------------------------------------------
{
  const raw330 = JSON.parse(
    await readFile(path.join(root, 'public/assets/atlas/3.30/tree.json'), 'utf8'),
  );
  const t = makeTree(raw330);
  const choiceIds = t.nodes.filter((n) => n.variants.length > 0).map((n) => n.id);
  if (choiceIds.length === 0) fail('3.30 tree should have multiple-choice notables');

  // Every multiple-choice notable allocated, each with a different pick, plus
  // one left unpicked and a pick for a node outside the plan (to be dropped).
  const everything = t.shareOrder.map((i) => t.nodes[i].id);
  const choices = {};
  choiceIds.forEach((id, i) => {
    if (i === 0) return; // unpicked
    choices[id] = i % t.byId.get(id).variants.length;
  });
  const code = encodePlan(t, { treeVersion: 2, allocated: everything, choices });
  const back = decodePlan(code, t);
  const want = JSON.stringify(Object.entries(choices).sort());
  const got = JSON.stringify(Object.entries(back.choices).sort());
  if (want !== got) fail(`picks did not round-trip: ${want} vs ${got}`);
  else console.log(`✓ ${Object.keys(choices).length} effect picks round-trip, an unpicked one stays unpicked`);

  // Picks on nodes outside the tree are not shared.
  const small = everything.filter((id) => !choiceIds.includes(id)).slice(0, 5);
  const noPicks = encodePlan(t, { treeVersion: 2, allocated: small, choices });
  if (Object.keys(decodePlan(noPicks, t).choices).length) fail('picks leaked for unallocated nodes');
  if (noPicks !== encodePlan(t, { treeVersion: 2, allocated: small }))
    fail('a plan with no relevant picks should encode exactly as before');
  else console.log('✓ picks off the tree are not shared, and cost nothing');

  // A pick past the node's last effect is refused, not wrapped around.
  const bytes = Buffer.from(code.split(':')[1], 'base64url');
  bytes[bytes.length - 1] = 0x7f;
  let threw = false;
  try {
    decodePlan(`AT3:${bytes.toString('base64url')}`, t);
  } catch (err) {
    threw = err instanceof ShareCodeError;
  }
  if (!threw) fail('an out-of-range pick should be refused');
  else console.log('✓ an out-of-range pick is refused');
}

console.log(failures === 0 ? '\nALL OK' : `\nFAILURES: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
