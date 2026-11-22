/**
 * Checks reading atlas-blush-beta.vercel.app links.
 *
 * The site's own encoder is ported below as it ships (atlas.js, `encode`),
 * built on its own graph straight from the export, so a mismatch in how we
 * walk the tree shows up here rather than as a quietly different tree. Random
 * trees with random picks go through it and must come back node for node.
 *
 * Also: one real link with the set the site itself decodes it to, the legacy
 * `id,id.choice` form, and damaged codes refused instead of mis-read.
 *
 * Run: node scripts/external-import.mjs [simulations]
 */
import { build } from 'esbuild';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = path.join(root, 'node_modules', '.external-import-test');
const SIMULATIONS = Number(process.argv[2] ?? 300);

await mkdir(tmp, { recursive: true });
const entry = path.join(tmp, 'entry.ts');
await writeFile(
  entry,
  [
    `export * from ${JSON.stringify(path.join(root, 'src/app/tools/atlas/external-import.ts'))};`,
    `export { buildTree } from ${JSON.stringify(path.join(root, 'src/app/tools/atlas/tree-loader.ts'))};`,
  ].join('\n'),
);
await build({
  entryPoints: [entry],
  outfile: path.join(tmp, 'bundle.mjs'),
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  target: 'es2022',
  logLevel: 'warning',
});
const { readExternal, looksExternal, ExternalImportError, buildTree } = await import(
  pathToFileURL(path.join(tmp, 'bundle.mjs')).href
);

const dirs = { 1: '3.29', 2: '3.30', 3: '3.30c' };
const raws = {};
const trees = {};
for (const [v, dir] of Object.entries(dirs)) {
  raws[v] = JSON.parse(
    await readFile(path.join(root, 'public/assets/atlas', dir, 'tree.json'), 'utf8'),
  );
  trees[v] = buildTree(raws[v]);
}
const treeFor = async (v) => trees[v];

let failures = 0;
let checks = 0;
const check = (ok, message) => {
  checks++;
  if (!ok) {
    failures++;
    console.error('  ✗ ' + message);
  }
};

// --- the site's encoder, as it ships ------------------------------------------
function siteGraph(data) {
  const nodes = {};
  for (const [id, n] of Object.entries(data.nodes)) {
    if (id === 'root') continue;
    nodes[id] = { ...n, id, adj: new Set() };
  }
  for (const n of Object.values(nodes)) {
    for (const t of [...(n.out ?? []), ...(n.in ?? [])]) {
      const m = nodes[t];
      if (!m || n.isMastery || m.isMastery) continue;
      n.adj.add(t);
      m.adj.add(n.id);
    }
  }
  return { nodes, rootId: data.nodes.root.out[0] };
}
function walk(tree, taken) {
  const seen = new Set([tree.rootId]);
  const order = [tree.rootId];
  for (let i = 0; i < order.length; i++)
    for (const nb of [...tree.nodes[order[i]].adj].sort((a, b) => a - b)) {
      if (seen.has(nb)) continue;
      seen.add(nb);
      if (taken(nb)) order.push(nb);
    }
  return order;
}
function siteEncode(tree, alloc, variants) {
  const bits = [];
  const order = walk(tree, (id) => {
    bits.push(alloc.has(id));
    return alloc.has(id);
  });
  for (const id of order)
    if (tree.nodes[id].isMultipleChoiceVariant) {
      const v = variants[id] || 0;
      bits.push(v & 4, v & 2, v & 1);
    }
  const bytes = [0xa1];
  bits.forEach((b, i) => {
    if (i % 8 === 0) bytes.push(0);
    if (b) bytes[bytes.length - 1] |= 128 >> (i % 8);
  });
  while (bytes.length > 1 && bytes.at(-1) === 0) bytes.pop();
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

const site = siteGraph(raws[2]);
const URL_BASE = 'https://atlas-blush-beta.vercel.app/#';
// Our plans also hold the free junction next to the centre; the site's start node.
const ours = (alloc) => [...alloc].filter((id) => id !== site.rootId).sort();
const theirs = (plan) => plan.allocated.filter((id) => id !== site.rootId).sort();

// --- random trees round-trip ---------------------------------------------------
let seed = 12345;
const rand = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 2 ** 32;
for (let s = 0; s < SIMULATIONS; s++) {
  const size = 1 + Math.floor(rand() * 140);
  const alloc = new Set([site.rootId]);
  while (alloc.size <= size) {
    const frontier = [...alloc]
      .flatMap((id) => [...site.nodes[id].adj])
      .filter((id) => !alloc.has(id));
    if (!frontier.length) break;
    alloc.add(frontier[Math.floor(rand() * frontier.length)]);
  }
  const variants = {};
  for (const id of alloc) {
    const n = site.nodes[id];
    if (n.isMultipleChoiceVariant) variants[id] = Math.floor(rand() * n.variantEffects.length);
  }
  const link = URL_BASE + siteEncode(site, alloc, variants);
  let plan;
  try {
    plan = await readExternal(link, 3, treeFor);
  } catch (err) {
    check(false, `sim ${s}: ${err.message}`);
    continue;
  }
  check(plan.treeVersion === 2, `sim ${s}: read on tree ${plan.treeVersion}, not 3.30.0`);
  check(
    JSON.stringify(theirs(plan)) === JSON.stringify(ours(alloc)),
    `sim ${s}: ${alloc.size} nodes in, ${plan.allocated.length} out`,
  );
  const picks = Object.fromEntries(Object.entries(variants).sort());
  const got = Object.fromEntries(Object.entries(plan.choices).sort());
  check(JSON.stringify(picks) === JSON.stringify(got), `sim ${s}: picks differ`);
  check(plan.disconnected === 0, `sim ${s}: ${plan.disconnected} disconnected`);
}

// --- a real link, against the set the site decodes it to ------------------------
const REAL = 'oSC5qzXBl2kzj1FWNUCLymdtPnv7itO3dNc-SenkvnIQ';
const REAL_IDS =
  '206 712 866 1987 2111 2231 2730 2826 2929 3296 3795 3814 4439 5338 5908 6091 6340 6518 6530 7540 7771 8038 9959 10448 10944 11223 12291 12836 13284 13448 13833 13842 14369 14447 15961 15967 16298 16341 16735 17000 17151 17492 18383 19489 19675 19729 21096 22270 23371 23513 23539 24007 24106 24609 25259 25273 25923 26293 26601 26688 27028 28477 28873 28971 29045 29088 29231 29464 29605 29991 30266 30277 31171 31240 31498 32019 33008 33506 33868 34393 34502 34662 34850 35044 35176 37420 37913 38084 38465 38692 39147 39380 40369 40832 40852 41053 41591 41694 42156 44917 44993 45563 46214 46589 46850 46865 47095 48107 49338 50686 50700 50739 51626 52881 53540 54012 54407 54782 55454 56639 56860 57123 57566 58023 58167 58224 60645 62029 62796 63311 63460 63608 64178 64218 65535';
const REAL_PICKS = { 712: 2, 19729: 1, 28477: 0 };
{
  const plan = await readExternal(URL_BASE + REAL, 3, treeFor);
  check(plan.source === 'atlas-blush-beta', 'real link: wrong source');
  check(plan.treeVersion === 2, `real link: tree ${plan.treeVersion}`);
  check(
    JSON.stringify(theirs(plan)) === JSON.stringify(ours(new Set(REAL_IDS.split(' ')))),
    `real link: ${plan.allocated.length} nodes, site says ${REAL_IDS.split(' ').length}`,
  );
  check(
    JSON.stringify(Object.fromEntries(Object.entries(plan.choices).sort())) ===
      JSON.stringify(Object.fromEntries(Object.entries(REAL_PICKS).sort())),
    `real link: picks ${JSON.stringify(plan.choices)}`,
  );
}

// --- legacy list, detection, damage --------------------------------------------
{
  const plan = await readExternal(URL_BASE + '29045,9959,712.3', 3, treeFor);
  check(plan.allocated.includes('9959') && plan.allocated.includes('712'), 'legacy: nodes missing');
  check(plan.choices['712'] === 3, `legacy: pick ${plan.choices['712']}`);
}
check(looksExternal(URL_BASE + REAL), 'link not recognised');
check(!looksExternal(REAL), 'a bare hash is claimed');
for (const [name, link] of [
  ['no hash', 'https://atlas-blush-beta.vercel.app/'],
  ['not base64', URL_BASE + '!!!'],
  ['stray bits', URL_BASE + REAL.slice(0, -2) + '__'],
  ['unknown node', URL_BASE + '29045,99999'],
]) {
  let refused = false;
  try {
    await readExternal(link, 3, treeFor);
  } catch (err) {
    refused = err instanceof ExternalImportError;
  }
  check(refused, `${name}: not refused`);
}

console.log(`${checks - failures}/${checks} checks passed (${SIMULATIONS} simulated trees)`);
process.exit(failures ? 1 : 0);
