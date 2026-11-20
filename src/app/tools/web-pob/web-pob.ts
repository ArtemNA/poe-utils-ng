/**
 * `/web-pob` — Path of Building under the site's own bar.
 *
 * The frame itself lives in the app shell (see pob-frame.ts) so it survives
 * leaving this route; this component only shows it while the route is open
 * and hands on `?build=<code or pobb.in link>` as `/pob/#build=...`.
 *
 * Leaving the route loses nothing, so the guard asks only when a different
 * `?build=` would replace a build with unsaved changes.
 */
import { Component, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, type RouterStateSnapshot } from '@angular/router';
import { PobFrame } from './pob-frame';

@Component({
  selector: 'app-web-pob',
  template: '',
  host: { style: 'display: none' },
})
export class WebPob {
  private readonly pob = inject(PobFrame);

  constructor() {
    inject(ActivatedRoute)
      .queryParamMap.pipe(takeUntilDestroyed())
      .subscribe((query) => this.pob.show(query.get('build')));
  }

  ngOnDestroy(): void {
    this.pob.hide();
  }

  /** Called by the route's canDeactivate guard in app.routes.ts. */
  canLeave(next: RouterStateSnapshot): boolean {
    const target = next.root.firstChild;
    if (target?.routeConfig?.path !== 'web-pob') return true;
    if (!this.pob.wouldDiscard(target.queryParamMap.get('build'))) return true;
    return confirm('The build in Path of Building has unsaved changes. Open the new one and lose them?');
  }
}
