// The page around the application: capability checks, the canvas, input as text lines for the Rust side (web/pob-gfx/window.rs).
(() => {
  const MIN_WIDTH = 1550;
  const MIN_HEIGHT = 800;
  const MAX_DIMENSION = 4096;

  const canvas = document.getElementById('canvas');
  const status = document.getElementById('status');
  const events = (globalThis.__pobEvents = []);
  const test = new URLSearchParams(location.search).has('test');
  globalThis.__POB_RS__ = test ? { frameSamples: [], started: false, readyMs: null, errors: [], send: (line) => events.push(line) } : undefined;

  globalThis.__pobFatal = (message) => {
    status.textContent = message;
    status.className = 'error';
    status.hidden = false;
    globalThis.__POB_RS__?.errors.push(message);
  };

  const missing = [];
  if (!globalThis.crossOriginIsolated || typeof SharedArrayBuffer !== 'function') missing.push('cross-origin isolation and SharedArrayBuffer: this page has to be served with the COOP and COEP headers');
  if (typeof WebAssembly !== 'object') missing.push('WebAssembly');
  if (typeof OffscreenCanvas !== 'function') missing.push('OffscreenCanvas');
  if (!document.createElement('canvas').getContext('webgl2')) missing.push('WebGL2');
  if (!navigator.storage?.getDirectory) missing.push('the browser\'s private file storage (OPFS)');
  if (missing.length) {
    __pobFatal('Path of Building cannot start in this browser. Missing:\n- ' + missing.join('\n- '));
    return;
  }

  // The drawing buffer: never below the minimum the UI is laid out for, never above what a canvas is allowed. A smaller window scrolls.
  let last = '';
  const layout = () => {
    const dpr = window.devicePixelRatio || 1;
    const cssW = Math.max(window.innerWidth, MIN_WIDTH);
    const cssH = Math.max(window.innerHeight, MIN_HEIGHT);
    const ratio = Math.min(dpr, MAX_DIMENSION / cssW, MAX_DIMENSION / cssH);
    const w = Math.round(cssW * ratio);
    const h = Math.round(cssH * ratio);
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
    const size = `s ${w} ${h} ${ratio}`;
    if (size !== last) {
      last = size;
      events.push(size);
      if (globalThis.__POB_RS__) __POB_RS__.bufferSize = [w, h];
    }
    return ratio;
  };
  let ratio = layout();
  addEventListener('resize', () => (ratio = layout()));

  const position = (e) => {
    const r = canvas.getBoundingClientRect();
    return `${(e.clientX - r.left) * ratio} ${(e.clientY - r.top) * ratio}`;
  };
  canvas.addEventListener('mousemove', (e) => events.push('m ' + position(e)));
  canvas.addEventListener('mousedown', (e) => {
    e.preventDefault();
    window.focus();
    events.push('m ' + position(e), `b ${({ 0: 0, 1: 1, 2: 2, 3: 3, 4: 4 })[e.button]} 1`);
  });
  addEventListener('mouseup', (e) => events.push(`b ${e.button} 0`));
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const lines = e.deltaMode === 1 ? e.deltaY : e.deltaY / 100;
    events.push(`w ${-lines}`);
  }, { passive: false });
  canvas.addEventListener('mouseenter', () => events.push('i 1'));
  canvas.addEventListener('mouseleave', () => events.push('i 0'));
  addEventListener('blur', () => events.push('f'));
  // Hidden: the tab is, or the page that embeds this one in an iframe says so (a route left but kept alive). A hidden iframe of a
  // visible tab would otherwise draw 60 frames a second nobody sees: document.hidden follows the tab only.
  let hostHidden = false;
  let wasHidden = document.hidden;
  const visibility = () => {
    const hidden = document.hidden || hostHidden;
    if (hidden === wasHidden) return;
    wasHidden = hidden;
    // Settings are written when the page goes away: a page has no moment of closing to rely on.
    if (hidden) events.push('h save-settings');
    events.push(`v ${hidden ? 0 : 1}`);
  };
  document.addEventListener('visibilitychange', visibility);

  // The bridge to a page that embeds this one in an iframe of the same site: it says {pob: 'hidden', value} and hears
  // {pob: 'ready'} and {pob: 'unsaved', value} (to ask before it leaves the route: an iframe's beforeunload does not run then).
  const embedded = window.parent !== window;
  const toHost = (msg) => { if (embedded) window.parent.postMessage({ pob: msg.type, ...msg }, location.origin); };
  addEventListener('message', (e) => {
    if (e.origin !== location.origin || e.source !== window.parent || e.data?.pob !== 'hidden') return;
    hostHidden = !!e.data.value;
    visibility();
  });
  globalThis.__pobOnUnsaved = (value) => toHost({ type: 'unsaved', value });

  // A key held with Ctrl types nothing; Ctrl+Alt is AltGr and does.
  const typed = (e) => e.key.length >= 1 && [...e.key].length === 1 && (!e.ctrlKey || e.altKey) && !e.metaKey;
  addEventListener('keydown', (e) => {
    const paste = (e.ctrlKey || e.metaKey) && e.code === 'KeyV';
    const copy = (e.ctrlKey || e.metaKey) && (e.code === 'KeyC' || e.code === 'KeyX');
    // The browser hands the clipboard out only in its `paste` event, which needs the default action: the key goes out from there.
    if (paste) return;
    if (!copy) e.preventDefault();
    events.push(`k ${e.code} 1`);
    if (typed(e)) events.push(`c ${e.key.codePointAt(0)}`);
    else if (e.code === 'Backspace') events.push('c 8');
    else if (e.code === 'Enter' || e.code === 'NumpadEnter') events.push('c 13');
  });
  addEventListener('keyup', (e) => events.push(`k ${e.code} 0`));
  addEventListener('paste', (e) => {
    e.preventDefault();
    globalThis.__pobPasted = e.clipboardData?.getData('text') ?? null;
    events.push('k KeyV 1');
  });
  // The application's text reaches the clipboard from `__pobCopy`, a moment after the key: the browser's own copy must not overwrite it with an empty selection.
  for (const type of ['copy', 'cut']) addEventListener(type, (e) => e.preventDefault());

  // One timer for the notice: an earlier notice's timer hid a newer one that came within its 6 s (KNOWLEDGE W36).
  let noticeTimer = 0;
  const notify = (text, ms = 6000) => {
    clearTimeout(noticeTimer);
    status.textContent = text;
    status.className = 'notice';
    status.hidden = false;
    noticeTimer = ms ? setTimeout(() => (status.hidden = true), ms) : 0;
  };
  globalThis.__pobNotice = (text) => notify(text);
  globalThis.__pobPasted = null;
  globalThis.__pobCopy = (text) => {
    if (!navigator.clipboard) return notify('The browser gives this page no access to the clipboard.');
    navigator.clipboard.writeText(text).catch((err) => notify('The browser refused access to the clipboard: ' + err.message));
  };
  globalThis.__pobOpenUrl = (url) => {
    if (!window.open(url, '_blank', 'noopener')) notify('The browser blocked a new tab. Open this link yourself: ' + url, 0);
  };
  globalThis.__pobDownload = (name, bytes) => {
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  };

  addEventListener('beforeunload', (e) => {
    if (globalThis.__pobUnsaved) e.preventDefault();
  });

  // Builds in the browser's storage can be evicted under disk pressure unless the page asks otherwise; the first click is the moment a browser accepts the question.
  addEventListener('mousedown', () => navigator.storage.persist?.().catch(() => {}), { once: true });

  // The panel of versions and Import/Export: on the build's Import/Export tab only, which the application reports as it changes
  // (the user's decision 2026-11-20). Dropping files on the page imports them on any tab.
  const panel = document.getElementById('files');
  globalThis.__pobSetView = (view) => {
    panel.hidden = view !== 'BUILD/IMPORT';
    if (globalThis.__POB_RS__) __POB_RS__.view = view;
  };

  // Builds to and from files.
  const base64 = (bytes) => {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  };
  const importFiles = async (files) => {
    for (const file of files) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const safe = file.name.replace(/[\r\n]/g, ' ');
      events.push('h import-begin');
      for (let at = 0; at < bytes.length; at += 768 * 1024) events.push('h import-part ' + base64(bytes.subarray(at, at + 768 * 1024)));
      events.push('h import-end ' + safe);
    }
  };
  const picker = document.getElementById('import-file');
  document.getElementById('import').addEventListener('click', () => picker.click());
  picker.addEventListener('change', () => {
    importFiles([...picker.files]);
    picker.value = '';
  });
  document.getElementById('export').addEventListener('click', () => events.push('h export'));
  addEventListener('dragover', (e) => e.preventDefault());
  addEventListener('drop', (e) => {
    e.preventDefault();
    importFiles([...e.dataTransfer.files]);
  });
  // Versions: the shell of each version lives in its own folder next to versions.json; switching keeps the link's #build=.
  const here = location.pathname.split('/').filter(Boolean).at(-1) ?? '';
  fetch('../versions.json', { cache: 'no-store' })
    .then((r) => r.json())
    .then((v) => {
      const select = document.getElementById('version');
      // A site's export puts each build in a folder of its own (`path`, tools/export-site.ps1); the build folder is the ref.
      const folder = (x) => x.path ?? x.ref;
      // A site's export: a build folder no longer listed is an old build still in a browser's cache (its files are cached for
      // good) or a link to one; the list is never cached, so it leads to the current build (KNOWLEDGE W41). In dist/ an
      // unlisted version stays open for checks.
      if (v.versions.some((x) => x.path) && v.latest && !v.versions.some((x) => folder(x) === here)) {
        location.replace(`../${v.latest}/${location.search}${location.hash}`);
        return;
      }
      for (const x of v.versions) select.add(new Option(x.ref + (folder(x) === v.latest ? ' (latest)' : ''), folder(x), false, folder(x) === here));
      if (!v.versions.some((x) => folder(x) === here)) select.add(new Option(here + ' (not listed)', here, false, true));
      // With one version there is nothing to switch to.
      select.hidden = select.options.length < 2;
      select.addEventListener('change', () => location.assign(`../${select.value}/${location.hash}`));
    })
    .catch(() => {});

  // #build=<code> or #build=<link of a build site>: the build opens without being saved, as on pob.cool. A link is downloaded by the
  // application, under the rules of its network (web/pob-net/ureq_transport.rs); a failure says why.
  const openFromHash = () => {
    const m = location.hash.match(/^#build=(.+)$/);
    if (!m) return;
    const value = decodeURIComponent(m[1]).trim();
    if (/^(https?:)?\/\/|^[\w.-]+\.\w{2,}\//.test(value)) {
      events.push('h build-link ' + value.replace(/^\/\//, 'https://').replace(/\s/g, ''));
      return;
    }
    if (!/^[A-Za-z0-9_\-+/=]+$/.test(value)) {
      notify('#build= holds no build code.', 0);
      return;
    }
    events.push('h build-code ' + value);
  };
  addEventListener('hashchange', openFromHash);

  globalThis.__pobReady = (ms) => {
    toHost({ type: 'ready', ms });
    started = true;
    status.hidden = true;
    // After the loading status is gone, or its notice would be hidden with it.
    openFromHash();
    if (globalThis.__POB_RS__) {
      __POB_RS__.readyMs = ms;
      __POB_RS__.started = true;
    }
  };

  // The start's progress in the loading status: the module, fetched here, and the startup pack's parts, fetched by the
  // application's worker (web/shell/library.js). Against the sizes the pack's manifest gives (tools/pack-startup.mjs): the module
  // as decoded, the parts as sent; a percent, since the two are not the same unit. Without a manifest the status stays as it is.
  const loaded = { wasm: 0, parts: {} };
  let sizes = null;
  let started = false;
  let shown = -1;
  const bar = document.createElement('div');
  bar.className = 'bar';
  bar.append(document.createElement('div'));
  const show = () => {
    if (!sizes || started || status.className) return;
    let total = sizes.wasm;
    let done = Math.min(loaded.wasm, sizes.wasm);
    for (const [name, packed] of Object.entries(sizes.parts)) {
      total += packed;
      // A host that decodes a part on its way sends more than its packed size: the part counts as whole.
      done += Math.min(loaded.parts[name] ?? 0, packed);
    }
    const percent = Math.floor((100 * done) / total);
    if (percent === shown) return;
    shown = percent;
    status.replaceChildren(percent < 100 ? `Loading... ${percent}%` : 'Starting...', bar);
    bar.firstChild.style.width = percent + '%';
    globalThis.__POB_RS__?.progress.push(percent);
  };
  globalThis.__pobProgress = ({ name, got }) => {
    loaded.parts[name] = got;
    show();
  };
  fetch('startup/manifest.json')
    .then((r) => (r.ok ? r.json() : null))
    .then((m) => {
      if (!m?.wasm || !m.parts.every((p) => p.packed)) return;
      sizes = { wasm: m.wasm, parts: Object.fromEntries(m.parts.map((p) => [p.name, p.packed])) };
      show();
    })
    .catch(() => {});
  // The worker's counts arrive as messages of its own: taken here, before Emscripten's handler, which would call them unknown.
  const NativeWorker = globalThis.Worker;
  globalThis.Worker = class extends NativeWorker {
    constructor(...args) {
      super(...args);
      this.addEventListener('message', (e) => {
        if (!e.data?.pobProgress) return;
        e.stopImmediatePropagation();
        __pobProgress(e.data.pobProgress);
      });
    }
  };
  if (globalThis.__POB_RS__) __POB_RS__.progress = [];

  globalThis.Module = {
    canvas,
    // The module fetched here, counted as it arrives, and compiled as it streams (Emscripten's hook for it).
    instantiateWasm: (imports, done) => {
      (async () => {
        const res = await fetch('pob_web.wasm', { credentials: 'same-origin' });
        if (!res.ok) throw new Error(`pob_web.wasm: ${res.status}`);
        const counted = res.body.pipeThrough(new TransformStream({
          transform(chunk, out) {
            loaded.wasm += chunk.byteLength;
            show();
            out.enqueue(chunk);
          },
        }));
        const { instance, module } = await WebAssembly.instantiateStreaming(new Response(counted, { headers: { 'Content-Type': 'application/wasm' } }), imports);
        done(instance, module);
      })().catch((e) => __pobFatal('The application could not be loaded: ' + (e?.message ?? e)));
      return {};
    },
    print: (t) => console.log(t),
    printErr: (t) => console.warn(t),
    onAbort: (what) => __pobFatal('The application stopped: ' + what),
  };
  const script = document.createElement('script');
  script.src = 'pob-web.js';
  script.onerror = () => __pobFatal('The application could not be loaded.');
  document.body.appendChild(script);
})();
