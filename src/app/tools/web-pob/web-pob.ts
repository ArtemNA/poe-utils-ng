/**
 * `/pob` and `/web-pob` — Path of Building, over the whole window or under the
 * site's own bar (`data.full` on the route).
 *
 * The frame itself lives in the app shell (see pob-frame.ts) so it survives
 * leaving the route; this component only shows it while the route is open and
 * hands on a build — `?build=<code or link>` or `#build=<code or link>`, the
 * form Path of Building's own links use — as `/pob-app/#build=...`.
 *
 * Leaving the route loses nothing, so the guard asks only when a different
 * build would replace one with unsaved changes.
 */
import { Component, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  ActivatedRoute,
  type ActivatedRouteSnapshot,
  type RouterStateSnapshot,
} from '@angular/router';
import { combineLatest } from 'rxjs';
import { PobFrame } from './pob-frame';

/** The routes that show the frame (app.routes.ts). */
const POB_PATHS = ['pob', 'web-pob'];

/** The build a link asks for: `?build=` first, then `#build=`. */
export function buildFrom(query: string | null, fragment: string | null): string | null {
  if (query) return query;
  if (fragment?.startsWith('build=')) return fragment.slice('build='.length) || null;
  return null;
}

function buildOf(route: ActivatedRouteSnapshot): string | null {
  return buildFrom(route.queryParamMap.get('build'), route.fragment);
}

@Component({
  selector: 'app-web-pob',
  template: '',
  host: { style: 'display: none' },
})
export class WebPob {
  private readonly pob = inject(PobFrame);

  constructor() {
    const route = inject(ActivatedRoute);
    const full = route.snapshot.data['full'] === true;
    combineLatest([route.queryParamMap, route.fragment])
      .pipe(takeUntilDestroyed())
      .subscribe(([query, fragment]) => this.pob.show(buildFrom(query.get('build'), fragment), full));
  }

  ngOnDestroy(): void {
    this.pob.hide();
  }

  /** Called by the routes' canDeactivate guard in app.routes.ts. */
  canLeave(next: RouterStateSnapshot): boolean {
    const target = next.root.firstChild;
    if (!target || !POB_PATHS.includes(target.routeConfig?.path ?? '')) return true;
    if (!this.pob.wouldDiscard(buildOf(target))) return true;
    return confirm('The build in Path of Building has unsaved changes. Open the new one and lose them?');
  }
}
