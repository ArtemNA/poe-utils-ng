/**
 * The Codex — the trees, the scarabs, and what a night of running them paid.
 *
 * It started as an attempt to replace the spreadsheet a player keeps their
 * whole league in, and lost: a sheet is faster to type into, freer to lay out,
 * already open in another tab and already shared. That half — docs, pages,
 * blocks, arranging things by hand — is gone.
 *
 * What is left is the half a sheet cannot do at all. There, an atlas is a dead
 * imgur screenshot, the scarabs are a sentence, and the profit is a number
 * rendered as pixels in a picture of a loot tracker. Here the tree opens in the
 * planner, the scarabs are a set the app can count and search, and a run is
 * arithmetic that sorts. Links and notes belong in the sheet; measurements and
 * trees belong here.
 */
import { Component, computed, inject, signal } from '@angular/core';
import { PoeCard } from '../../shared/poe-card';
import { ToolPage } from '../../shared/tool-page';
import { CodexStore } from './codex-store';
import { CodexEntryCard } from './codex-entry-card';
import { CodexEntryEditor } from './codex-entry-editor';
import { CodexAssetImg } from './codex-asset-img';
import { CodexCompare } from './codex-compare';
import { capture, noteBody } from './codex-capture';
import { imageTitle, imagesIn } from './codex-image';
import { SAMPLES, sampleRuns } from './codex-sample';
import { newId } from './codex-schema';
import { parseQuery, runQuery, toggleTerm } from './codex-query';
import { count, mb, typeOf, when } from './codex-format';
import type { Entry, Layout } from './codex-types';

const LAYOUT_KEY = 'poe_codex_layout';
const GROUP_KEY = 'poe_codex_group';

export type GroupKey = 'none' | 'type' | 'tag' | 'league' | 'status';
const GROUPS: GroupKey[] = ['type', 'tag', 'league', 'status', 'none'];

/** The questions worth a button, now that the tool only answers a few. */
const QUICK: { label: string; query: string; title: string }[] = [
  { label: 'All', query: '', title: 'Everything that is not dead' },
  { label: 'Strategies', query: 'kind:strategy sort:perhour', title: 'Best measured first' },
  { label: 'Atlases', query: 'kind:atlas', title: 'Trees — ours, and everybody else’s' },
  { label: 'Measured', query: 'has:runs sort:perhour', title: 'Anything somebody timed' },
  { label: 'Unmeasured', query: 'kind:strategy -has:runs', title: 'Written down and never tested' },
  { label: 'Untagged', query: 'is:untagged', title: 'Kept in a hurry and never filed' },
  { label: 'Dead', query: 'status:dead', title: 'Kept, and out of the way' },
];

@Component({
  selector: 'app-codex',
  imports: [PoeCard, ToolPage, CodexEntryCard, CodexEntryEditor, CodexAssetImg, CodexCompare],
  templateUrl: './codex.html',
})
export class Codex {
  readonly store = inject(CodexStore);
  readonly quick = QUICK;
  readonly groupKeys = GROUPS;

  // --- keeping something -------------------------------------------------------
  readonly captureText = signal('');
  readonly captureMessage = signal('');
  readonly over = signal(false);
  readonly busy = signal(false);
  /** which example the button hands out next */
  private sampleAt = 0;

  // --- the library -------------------------------------------------------------
  readonly query = signal('');
  readonly layout = signal<Layout>(readLayout());
  readonly group = signal<GroupKey>(readGroup());
  readonly viewName = signal('');

  readonly results = computed(() => runQuery(this.store.entries(), parseQuery(this.query())));

  /**
   * The results, cut into sections.
   *
   * A flat list of everything is a pile. Grouping is what a sheet gets from
   * having rows in a deliberate order; here the order is a field, so the
   * sections come out of the data instead of out of somebody's dragging.
   */
  readonly groups = computed(() => {
    const key = this.group();
    const results = this.results();
    if (key === 'none') return [{ label: '', entries: results }];

    const buckets = new Map<string, Entry[]>();
    const push = (label: string, entry: Entry) => {
      const bucket = buckets.get(label);
      if (bucket) bucket.push(entry);
      else buckets.set(label, [entry]);
    };
    for (const entry of results) {
      if (key === 'tag') {
        // Under every tag it carries, not just the first. A strategy that is
        // both #legion and #day-1 is an answer to both questions, and hiding it
        // from one of them to avoid seeing it twice is the wrong trade.
        if (!entry.tags.length) push('untagged', entry);
        else for (const tag of entry.tags) push(tag, entry);
      } else if (key === 'type') push(typeOf(entry), entry);
      else if (key === 'league') push(entry.league || 'no league', entry);
      else push(entry.status ?? 'unmarked', entry);
    }
    return [...buckets]
      .map(([label, entries]) => ({ label, entries }))
      .sort((a, b) => b.entries.length - a.entries.length || a.label.localeCompare(b.label));
  });

  /** Tags of what is on screen, so clicking two in a row narrows rather than guesses. */
  readonly visibleTags = computed(() => {
    const counts = new Map<string, number>();
    for (const entry of this.results()) {
      for (const tag of entry.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 30);
  });

  /**
   * Picking things to set side by side.
   *
   * The document this answers is four scarab setups and eight screenshots, kept
   * apart in a spreadsheet of its own because there was nowhere to put the
   * numbers. Two ticks and they are columns of one table.
   */
  readonly comparing = signal(false);
  readonly picked = signal<ReadonlySet<string>>(new Set());

  readonly pickedEntries = computed(() => {
    const ids = this.picked();
    return this.store.entries().filter((entry) => ids.has(entry.id));
  });

  /** The open editor, and which section it was opened from — see `open`. */
  readonly openEntry = signal('');
  readonly openIn = signal('');

  constructor() {
    void this.store.load();
  }

  // --- keeping something -------------------------------------------------------

  onCapture(event: Event): void {
    this.captureText.set((event.target as HTMLTextAreaElement).value);
  }

  async keep(): Promise<void> {
    const text = this.captureText();
    const items = capture(text);
    if (!items.length) return;
    const body = items.length === 1 && items[0].kind === 'note' ? noteBody(text) : '';
    const written = await this.store.addEntries(
      items.map((item, index) => ({ ...item, body: index === 0 ? body : '' })),
    );
    if (!written.length) return;
    this.captureText.set('');
    this.captureMessage.set(
      written.length === 1 ? `Kept "${trim(written[0].title)}".` : `Kept ${written.length} entries.`,
    );
    if (written.length === 1) this.openNew(written[0]);
  }

  /**
   * A strategy written by hand, for the ones that never went through the map
   * device — "боссраш, любые т16, скарабы: 1 террор + 4 шрайна" is a strategy,
   * and refusing it until it has a code would be refusing most of them.
   */
  async blank(): Promise<void> {
    const written = await this.store.addEntries([
      { kind: 'strategy', title: 'New strategy', data: { k: 'strategy', src: {} } },
    ]);
    if (written.length) {
      this.captureMessage.set('');
      this.openNew(written[0]);
    }
  }

  /**
   * A tree written down before there is anything to paste into it — the
   * counterpart of `blank`, and the reason the Example button cannot make a
   * card you could not have made yourself.
   */
  async blankAtlas(): Promise<void> {
    const written = await this.store.addEntries([
      { kind: 'atlas', title: 'New atlas', data: { k: 'atlas', src: {} } },
    ]);
    if (written.length) {
      this.captureMessage.set('');
      this.openNew(written[0]);
    }
  }

  /**
   * An example, for a page that is otherwise empty.
   *
   * The cards are the explanation, so with none of them there is nothing to
   * read. Pressing it again brings the next one, which is how two of them end
   * up on screen and the compare view has something to compare.
   */
  async addSample(): Promise<void> {
    // The next one you do not already have, rather than the next one in the
    // list: saving by name replaces, so a counter that resets with the page
    // would keep handing out the first example and never reach the third.
    const have = new Set(this.store.entries().map((entry) => entry.title));
    const missing = SAMPLES.findIndex((sample) => !have.has(sample.title));
    const at = missing >= 0 ? missing : this.sampleAt;
    const sample = SAMPLES[at];
    this.sampleAt = (at + 1) % SAMPLES.length;
    const runs = sampleRuns(sample, Date.now(), newId);
    const entry = await this.store.keepNamed(sample.kind, sample.title, sample.data, {
      sample: true,
      body: sample.body,
      tags: sample.tags,
      ...(sample.league ? { league: sample.league } : {}),
      ...(sample.status ? { status: sample.status } : {}),
      ...(runs ? { runs } : {}),
    });
    if (!entry) return;
    this.captureMessage.set('Added an example. It is tagged #sample — delete it whenever.');
    this.openNew(entry);
  }

  /**
   * A screenshot on the clipboard: Print Screen, alt-tab, paste. That is how
   * the evidence actually arrives.
   */
  onPaste(event: ClipboardEvent): void {
    const images = imagesIn(event.clipboardData);
    if (!images.length) return;
    event.preventDefault();
    void this.keepImages(images);
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.over.set(true);
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.over.set(false);
    void this.keepImages(imagesIn(event.dataTransfer));
  }

  onFiles(event: Event): void {
    const input = event.target as HTMLInputElement;
    void this.keepImages([...(input.files ?? [])]);
    input.value = '';
  }

  private async keepImages(files: File[]): Promise<void> {
    if (!files.length || this.busy()) return;
    this.busy.set(true);
    let kept = 0;
    for (const file of files) {
      const image = await this.store.addImage(file);
      if (!image) break;
      const entry = await this.store.addEntries([
        {
          kind: 'image',
          title: imageTitle(file.name),
          data: {
            k: 'image',
            assetId: image.assetId,
            thumbId: image.thumbId,
            w: image.w,
            h: image.h,
          },
        },
      ]);
      if (!entry.length) break;
      kept++;
      if (files.length === 1) this.openNew(entry[0]);
    }
    this.busy.set(false);
    if (kept) this.captureMessage.set(kept === 1 ? 'Kept the picture.' : `Kept ${kept} pictures.`);
  }

  // --- the query ---------------------------------------------------------------

  onQuery(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
  }

  setQuery(value: string): void {
    this.query.set(value);
  }

  toggle(term: string): void {
    this.query.set(toggleTerm(this.query(), term));
  }

  active(term: string): boolean {
    return this.query().toLowerCase().split(/\s+/).includes(term.toLowerCase());
  }

  setLayout(layout: Layout): void {
    this.layout.set(layout);
    try {
      localStorage.setItem(LAYOUT_KEY, layout);
    } catch {
      // private mode: the list still works, it just forgets how you like it
    }
  }

  setGroup(key: GroupKey): void {
    this.group.set(key);
    try {
      localStorage.setItem(GROUP_KEY, key);
    } catch {
      // see setLayout
    }
  }

  onViewName(event: Event): void {
    this.viewName.set((event.target as HTMLInputElement).value);
  }

  async saveView(): Promise<void> {
    const view = await this.store.addView(this.viewName(), this.query(), this.layout());
    if (view) this.viewName.set('');
  }

  // --- comparing ---------------------------------------------------------------

  toggleComparing(): void {
    this.comparing.update((on) => !on);
    if (!this.comparing()) this.picked.set(new Set());
  }

  togglePicked(entry: Entry): void {
    this.picked.update((ids) => {
      const next = new Set(ids);
      if (!next.delete(entry.id)) next.add(entry.id);
      return next;
    });
  }

  isPicked(entry: Entry): boolean {
    return this.picked().has(entry.id);
  }

  /** Everything on screen at once — the usual way a comparison starts. */
  pickAll(): void {
    this.picked.set(new Set(this.results().map((entry) => entry.id)));
  }

  // --- editing -----------------------------------------------------------------

  /**
   * Grouping by tag lists an entry under each of its tags, so the editor is
   * pinned to the section it was opened from — otherwise one click would open
   * the same editor three times down the page.
   */
  open(entry: Entry, section: string): void {
    if (this.openEntry() === entry.id && this.openIn() === section) {
      this.close();
      return;
    }
    this.openEntry.set(entry.id);
    this.openIn.set(section);
  }

  close(): void {
    this.openEntry.set('');
  }

  /**
   * Open something that has just been created.
   *
   * The editor is pinned to a section, so opening one by id alone leaves it
   * pinned to a section that does not exist and the editor never appears. The
   * new entry is already in `groups()` by the time this runs, so the section it
   * landed in is simply looked up.
   */
  private openNew(entry: Entry): void {
    const section = this.groups().find((group) =>
      group.entries.some((other) => other.id === entry.id),
    );
    this.open(entry, section?.label ?? '');
  }

  async saveEntry(entry: Entry): Promise<void> {
    if (await this.store.saveEntry(entry)) this.close();
  }

  async removeEntry(entry: Entry): Promise<void> {
    if (await this.store.remove('entries', entry.id)) this.close();
  }

  // --- reading -----------------------------------------------------------------

  count(n: number, word: string): string {
    return count(n, word);
  }

  when(at: number): string {
    return when(at);
  }

  readonly storageLine = computed(() => {
    const usage = this.store.usage();
    if (!usage) return '';
    return `${mb(usage.used)} used of about ${mb(usage.quota)} this browser offers`;
  });
}

function trim(text: string): string {
  return text.length > 40 ? `${text.slice(0, 40)}…` : text;
}

function readGroup(): GroupKey {
  try {
    const saved = localStorage.getItem(GROUP_KEY) as GroupKey | null;
    if (saved && GROUPS.includes(saved)) return saved;
  } catch {
    // see setLayout
  }
  return 'type';
}

function readLayout(): Layout {
  try {
    const saved = localStorage.getItem(LAYOUT_KEY);
    if (saved === 'cards' || saved === 'table' || saved === 'list') return saved;
  } catch {
    // see setLayout
  }
  return 'list';
}
