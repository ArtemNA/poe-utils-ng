import { RouterStateSnapshot, Routes } from '@angular/router';

/**
 * One lazy route per tool. Paths match the old site's hash ids, so a link like
 * `.../#exp` maps onto `/exp` here.
 */
export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'defense' },
  {
    path: 'defense',
    title: 'Defense Calc · PoE Tools',
    loadComponent: () => import('./tools/defense/defense').then((m) => m.Defense),
  },
  {
    path: 'exchange',
    title: 'Currency · PoE Tools',
    loadComponent: () => import('./tools/exchange/exchange').then((m) => m.Exchange),
  },
  {
    path: 'lucky',
    title: 'Lucky Calc · PoE Tools',
    loadComponent: () => import('./tools/lucky/lucky').then((m) => m.Lucky),
  },
  {
    path: 'chromatic',
    title: 'Chromatic Calc · PoE Tools',
    loadComponent: () => import('./tools/chromatic/chromatic').then((m) => m.Chromatic),
  },
  {
    path: 'exp',
    title: 'EXP Penalty · PoE Tools',
    loadComponent: () => import('./tools/exp/exp').then((m) => m.Exp),
  },
  {
    // hidden from the sidebar (see tools.ts) but still reachable by URL
    path: 'trade',
    title: 'Bulk Trade Calc · PoE Tools',
    loadComponent: () => import('./tools/trade/trade').then((m) => m.Trade),
  },
  {
    path: 'kingsmarch',
    title: 'Kingsmarch Shipment · PoE Tools',
    loadComponent: () => import('./tools/kingsmarch/kingsmarch').then((m) => m.Kingsmarch),
  },
  {
    path: 'atlas',
    title: 'Atlas Selector · PoE Tools',
    loadComponent: () => import('./tools/atlas/atlas').then((m) => m.Atlas),
  },
  {
    path: 'strategy',
    title: 'Map Strategy · PoE Tools',
    loadComponent: () => import('./tools/strategy/strategy').then((m) => m.Strategy),
  },
  {
    path: 'voyage',
    title: 'Voyage Builder · PoE Tools',
    loadComponent: () => import('./tools/voyage/voyage').then((m) => m.Voyage),
  },
  {
    path: 'minesweeper',
    title: 'Minesweeper · PoE Tools',
    loadComponent: () => import('./tools/minesweeper/minesweeper').then((m) => m.Minesweeper),
  },
  // Path of Building in a same-origin frame of /pob-app/ (static files, not
  // part of this build) that the app shell keeps alive between visits: /pob
  // over the whole window, /web-pob under the bar. The address stays the
  // route's, so a shared link never names a build folder. A new build in the
  // query or the #fragment reuses the component, so the guard runs on those
  // changes too: the one case that reloads the frame and could lose work.
  ...(['pob', 'web-pob'] as const).map((path) => ({
    path,
    title: 'Path of Building � PoE Tools',
    data: { full: path === 'pob' },
    runGuardsAndResolvers: 'always' as const,
    loadComponent: () => import('./tools/web-pob/web-pob').then((m) => m.WebPob),
    // typed loosely so this file does not pull the component out of its chunk
    canDeactivate: [
      (
        page: { canLeave?: (next: RouterStateSnapshot) => boolean } | null,
        _route: unknown,
        _state: unknown,
        next: RouterStateSnapshot,
      ) => page?.canLeave?.(next) ?? true,
    ],
  })),
  {
    // not a tool, so it is not in TOOLS — reached from the sidebar footer
    path: 'account',
    title: 'Account · PoE Tools',
    loadComponent: () => import('./account/account').then((m) => m.Account),
  },
  {
    // unlinked on purpose: what version is running and what changed in it
    path: 'debug',
    title: 'Debug · PoE Tools',
    loadComponent: () => import('./debug/debug').then((m) => m.Debug),
  },
  {
    // the short-link landing: swaps the slug for a code and forwards
    path: 's/:slug',
    title: 'Opening link · PoE Tools',
    loadComponent: () => import('./shared/open-link').then((m) => m.OpenLink),
  },
  { path: '**', redirectTo: 'defense' },
];
