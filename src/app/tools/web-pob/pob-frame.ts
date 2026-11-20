/**
 * Path of Building (Rust/WebAssembly) in one same-origin frame that outlives
 * the `/web-pob` route.
 *
 * The application is not part of this build: it is static files served at
 * `/pob/` (the built `dist/` of pob-rust-wasm, kept in `pob/`), and `/pob/`
 * opens its newest version on its own. It cannot be embedded as a component:
 * it takes every key and the context menu on `window`, sets `document.title`
 * and reads `location.hash`, which would break the bar and the router.
 *
 * The frame is created on the first visit and then only hidden and shown, so
 * coming back is instant and the open build stays as it was. It is never moved
 * in the DOM: a moved iframe reloads. While hidden the application is told so
 * and stops drawing (otherwise it paints ~30 frames a second for nobody).
 *
 * Same-origin postMessage, both ends checked:
 *   app  -> page  { pob: 'ready', ms }        the application has started
 *   app  -> page  { pob: 'unsaved', value }   the build has unsaved changes
 *   page -> app   { pob: 'hidden', value }    the frame was hidden / shown
 */
import {
  Component,
  ElementRef,
  Injectable,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';

/** Where the application's files are served; never a pinned version. */
const POB_ROOT = '/pob/';

export function pobSrc(build: string | null): string {
  return build ? `${POB_ROOT}#build=${encodeURIComponent(build)}` : POB_ROOT;
}

@Injectable({ providedIn: 'root' })
export class PobFrame {
  private readonly sanitizer = inject(DomSanitizer);

  /** The frame is on screen (the `/web-pob` route is open). */
  readonly active = signal(false);
  /** What the frame was last pointed at; null until the first visit. */
  readonly src = signal<SafeResourceUrl | null>(null);
  /** The last `unsaved` the application reported. */
  readonly unsaved = signal(false);
  /** Milliseconds the application reported it took to start, once it has. */
  readonly readyMs = signal<number | null>(null);

  private srcText = '';
  private frame: HTMLIFrameElement | null = null;

  constructor() {
    // The service lives as long as the page, and so does this listener.
    window.addEventListener('message', (event) => this.onMessage(event));
  }

  attach(frame: HTMLIFrameElement | null): void {
    this.frame = frame;
  }

  /**
   * Show the frame. A build is loaded only when it differs from the one the
   * frame was last given; with no build, whatever is open stays open.
   */
  show(build: string | null): void {
    if (!this.srcText || (build && pobSrc(build) !== this.srcText)) {
      this.load(pobSrc(build));
    }
    this.active.set(true);
    this.post(false);
  }

  hide(): void {
    if (!this.active()) return;
    this.active.set(false);
    this.post(true);
    // A hidden frame must not keep the keyboard.
    if (this.frame && document.activeElement === this.frame) this.frame.blur();
  }

  /** Whether opening `build` would replace (and lose) unsaved work. */
  wouldDiscard(build: string | null): boolean {
    return !!build && !!this.srcText && pobSrc(build) !== this.srcText && this.unsaved();
  }

  private load(text: string): void {
    this.srcText = text;
    this.unsaved.set(false);
    this.readyMs.set(null);
    // Same-origin path built here, never a URL taken from input as is.
    this.src.set(this.sanitizer.bypassSecurityTrustResourceUrl(text));
  }

  private post(hidden: boolean): void {
    this.frame?.contentWindow?.postMessage({ pob: 'hidden', value: hidden }, location.origin);
  }

  private onMessage(event: MessageEvent): void {
    if (event.origin !== location.origin) return;
    const win = this.frame?.contentWindow;
    if (!win || event.source !== win) return;
    const data: unknown = event.data;
    if (!data || typeof data !== 'object') return;
    const msg = data as { pob?: unknown; value?: unknown; ms?: unknown };
    if (msg.pob === 'unsaved' && typeof msg.value === 'boolean') {
      this.unsaved.set(msg.value);
    } else if (msg.pob === 'ready') {
      this.readyMs.set(typeof msg.ms === 'number' ? msg.ms : 0);
      // Started while already hidden again (left before it finished loading).
      if (!this.active()) this.post(true);
    }
  }
}

/**
 * The frame's one place in the DOM: in the app shell next to the router
 * outlet, so leaving the route never destroys it. Empty until first used.
 */
@Component({
  selector: 'app-pob-host',
  template: `
    @if (pob.src(); as url) {
      <iframe
        #frame
        class="web-pob-frame"
        title="Path of Building"
        [src]="url"
        allow="clipboard-read; clipboard-write; fullscreen"
      ></iframe>
    }
  `,
  host: {
    class: 'web-pob',
    '[class.started]': '!!pob.src()',
    '[class.active]': 'pob.active()',
    '[attr.aria-hidden]': 'pob.active() ? null : "true"',
  },
})
export class PobHost {
  readonly pob = inject(PobFrame);
  private readonly frame = viewChild<ElementRef<HTMLIFrameElement>>('frame');

  constructor() {
    // viewChild is a signal: hand the element over whenever it appears.
    effect(() => this.pob.attach(this.frame()?.nativeElement ?? null));
  }
}
