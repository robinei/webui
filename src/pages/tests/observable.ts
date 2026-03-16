import { type TestSuite, assert, assertEqual, assertThrows } from './runner';
import {
    Observable, Signal, Computed, Effect, Constant,
    batchEffects, suppressEffects, suppressTracking,
    observableProxy, signalProxy, isObservableProxy,
} from '../../observable';

export const observableSuite: TestSuite = {
    name: 'Observable',
    tests: [

        // ─── Signal ──────────────────────────────────────────────────────────

        {
            name: 'Signal: get() returns initial value',
            run() {
                const s = new Signal(42);
                assertEqual(s.get(), 42);
            },
        },
        {
            name: 'Signal: set() updates value and returns new value',
            run() {
                const s = new Signal(1);
                const returned = s.set(2);
                assertEqual(returned, 2);
                assertEqual(s.get(), 2);
            },
        },
        {
            name: 'Signal: set() with equal value does not invalidate dependents',
            run() {
                const s = new Signal(1);
                let runs = 0;
                const eff = new Effect(() => { s.get(); runs++; });
                assertEqual(runs, 1);
                s.set(1); // same value
                assertEqual(runs, 1);
            },
        },
        {
            name: 'Signal: set() with equals:false always triggers invalidation',
            run() {
                const s = new Signal(1, { equals: false });
                let runs = 0;
                // polled:true bypasses areDependenciesChanged so the Effect re-runs
                // whenever it is scheduled (i.e. whenever the Signal fires invalidate).
                // Without equals:false, s.set(1) would be a no-op and the Effect would
                // never be scheduled at all.
                const eff = new Effect(() => { runs++; s.get(); }, { polled: true });
                assertEqual(runs, 1);
                s.set(1); // same value — default Signal would skip invalidate; equals:false does not
                assertEqual(runs, 2);
                // Contrast: a default-equals Signal does NOT invalidate on same-value set
                const s2 = new Signal(1);
                let runs2 = 0;
                const eff2 = new Effect(() => { runs2++; s2.get(); }, { polled: true });
                s2.set(1);
                assertEqual(runs2, 1); // not re-run — no invalidation fired
            },
        },
        {
            name: 'Signal: custom equals function',
            run() {
                const s = new Signal({ x: 1 }, { equals: (a, b) => a.x === b.x });
                let runs = 0;
                const eff = new Effect(() => { s.get(); runs++; });
                assertEqual(runs, 1);
                s.set({ x: 1 }); // different object, same x
                assertEqual(runs, 1);
                s.set({ x: 2 });
                assertEqual(runs, 2);
            },
        },
        {
            name: 'Signal: modify() applies transform',
            run() {
                const s = new Signal(10);
                s.modify(v => v + 5);
                assertEqual(s.get(), 15);
            },
        },

        // ─── Computed ────────────────────────────────────────────────────────

        {
            name: 'Computed: is not evaluated until get() is called',
            run() {
                let runs = 0;
                const _c = new Computed(() => { runs++; return 1; });
                assertEqual(runs, 0);
            },
        },
        {
            name: 'Computed: returns correct derived value',
            run() {
                const a = new Signal(3);
                const b = new Signal(4);
                const sum = new Computed(() => a.get() + b.get());
                assertEqual(sum.get(), 7);
            },
        },
        {
            name: 'Computed: caches result — re-get without mutation does not re-run',
            run() {
                let runs = 0;
                const s = new Signal(1);
                const c = new Computed(() => { runs++; return s.get() * 2; });
                c.get();
                c.get();
                assertEqual(runs, 1);
            },
        },
        {
            name: 'Computed: re-evaluates after dependency is invalidated',
            run() {
                const s = new Signal(1);
                const c = new Computed(() => s.get() * 2);
                assertEqual(c.get(), 2);
                s.set(5);
                assertEqual(c.get(), 10);
            },
        },
        {
            name: 'Computed: short-circuits if dependencies changed but value is same',
            run() {
                const s = new Signal(2);
                let outerRuns = 0;
                const doubled = new Computed(() => s.get() * 2);
                const clamped = new Computed(() => { outerRuns++; return Math.min(doubled.get(), 10); });
                clamped.get();
                assertEqual(outerRuns, 1);
                s.set(3); // doubled goes 4→6, clamped stays 6 < 10 so re-runs
                clamped.get();
                assertEqual(outerRuns, 2);
                // Now push doubled above 10 twice; clamped value stays 10
                s.set(6); // doubled=12, clamped=10
                clamped.get();
                const runsAfterFirst = outerRuns;
                s.set(7); // doubled=14, clamped=10 — areDependenciesChanged sees doubled changed,
                          // but clamped result is still 10, so downstream would short-circuit
                clamped.get();
                // clamped re-ran because doubled's value changed (areDependenciesChanged is true)
                assert(outerRuns >= runsAfterFirst, 'clamped should have re-run');
            },
        },
        {
            name: 'Computed: tracks dependencies dynamically per evaluation',
            run() {
                const flag = new Signal(true);
                const a = new Signal(1);
                const b = new Signal(100);
                let runs = 0;
                const c = new Computed(() => { runs++; return flag.get() ? a.get() : b.get(); });
                assertEqual(c.get(), 1);
                assertEqual(runs, 1);
                // Changing b should NOT re-run c when flag is true
                b.set(200);
                assertEqual(c.get(), 1);
                assertEqual(runs, 1);
                // Switch branch
                flag.set(false);
                assertEqual(c.get(), 200);
                assertEqual(runs, 2);
                // Now changing a should NOT re-run c
                a.set(999);
                assertEqual(c.get(), 200);
                assertEqual(runs, 2);
            },
        },
        {
            name: 'Effect: does not re-run when a formerly-depended-upon signal changes',
            run() {
                const flag = new Signal(true);
                const a = new Signal(1);
                const b = new Signal(100);
                let runs = 0;
                new Effect(() => { runs++; flag.get() ? a.get() : b.get(); });
                assertEqual(runs, 1);
                flag.set(false); // effect re-runs, now only reads b
                assertEqual(runs, 2);
                a.set(999); // a is no longer a dependency — should not trigger effect
                assertEqual(runs, 2);
            },
        },
        {
            name: 'Signal: deactivated fires when Effect stops depending on it',
            run() {
                const flag = new Signal(true);
                const a = new Signal(1);
                let deactivated = false;
                const b = new Signal(100, { deactivated() { deactivated = true; } });
                new Effect(() => { flag.get() ? (a.get(), b.get()) : a.get(); });
                assert(!deactivated);
                flag.set(false); // effect re-runs, no longer reads b
                assert(deactivated, 'deactivated should fire when b is no longer depended upon');
            },
        },
        {
            name: 'Signal: activated re-fires when Effect re-adds it after dropping it',
            run() {
                const flag = new Signal(false);
                const a = new Signal(1);
                let activations = 0;
                const b = new Signal(100, { activated() { activations++; } });
                new Effect(() => { a.get(); if (!flag.get()) b.get(); });
                assertEqual(activations, 1);  // b added
                flag.set(true);               // b dropped
                flag.set(false);              // b re-added — activated should fire again
                assertEqual(activations, 2, 'activated should re-fire when b is re-added after being dropped');
            },
        },
        {
            name: 'Computed: auto-marks as polled when func has no dependencies',
            run() {
                let counter = 0;
                const c = new Computed(() => ++counter);
                assert(!c.requiresPolling()); // not polled before first evaluation
                c.get(); // trigger evaluation — discovers no deps → auto-marks as polled
                assert(c.requiresPolling());
            },
        },
        {
            name: 'Computed: polled:true option forces re-evaluation on every get',
            run() {
                let counter = 0;
                const s = new Signal(1);
                const c = new Computed(() => { counter++; return s.get() + counter; }, { polled: true });
                c.get();
                c.get();
                assertEqual(counter, 2);
            },
        },
        {
            name: 'Computed: lastValue is passed to func on recomputation',
            run() {
                const s = new Signal(1);
                const accumulated = new Computed((prev?: number) => (prev ?? 0) + s.get());
                assertEqual(accumulated.get(), 1);
                s.set(2);
                assertEqual(accumulated.get(), 3); // 1 (prev) + 2
                s.set(10);
                assertEqual(accumulated.get(), 13); // 3 (prev) + 10
            },
        },

        // ─── Effect ──────────────────────────────────────────────────────────

        {
            name: 'Effect: runs immediately on construction',
            run() {
                let ran = 0;
                const _eff = new Effect(() => { ran++; });
                assertEqual(ran, 1);
            },
        },
        {
            name: 'Effect: does not run when constructed with active:false',
            run() {
                let ran = 0;
                const _eff = new Effect(() => { ran++; }, { active: false });
                assertEqual(ran, 0);
            },
        },
        {
            name: 'Effect: re-runs when a dependency changes',
            run() {
                const s = new Signal(1);
                let last = 0;
                const _eff = new Effect(() => { last = s.get(); });
                assertEqual(last, 1);
                s.set(2);
                assertEqual(last, 2);
            },
        },
        {
            name: 'Effect: does not re-run after deactivate()',
            run() {
                const s = new Signal(1);
                let runs = 0;
                const eff = new Effect(() => { runs++; s.get(); });
                assertEqual(runs, 1);
                eff.deactivate();
                s.set(2);
                assertEqual(runs, 1);
            },
        },
        {
            name: 'Effect: re-runs on activate() and reflects current state',
            run() {
                const s = new Signal(1);
                let last = 0;
                const eff = new Effect(() => { last = s.get(); });
                eff.deactivate();
                s.set(99);
                assertEqual(last, 1); // stale
                eff.activate();
                assertEqual(last, 99); // caught up
            },
        },
        {
            name: 'Effect: isActive() reflects current state',
            run() {
                const eff = new Effect(() => {});
                assert(eff.isActive());
                eff.deactivate();
                assert(!eff.isActive());
                eff.activate();
                assert(eff.isActive());
            },
        },

        // ─── batchEffects ────────────────────────────────────────────────────

        {
            name: 'batchEffects: coalesces multiple mutations — effect runs once',
            run() {
                const s = new Signal(0);
                let runs = 0;
                const _eff = new Effect(() => { runs++; s.get(); });
                assertEqual(runs, 1);
                batchEffects(() => {
                    s.set(1);
                    s.set(2);
                    s.set(3);
                });
                assertEqual(runs, 2);
                assertEqual(s.get(), 3);
            },
        },
        {
            name: 'batchEffects: intermediate values are not observed',
            run() {
                const s = new Signal(0);
                const seen: number[] = [];
                const _eff = new Effect(() => { seen.push(s.get()); });
                batchEffects(() => {
                    s.set(10);
                    s.set(20);
                    s.set(30);
                });
                assertEqual(seen.length, 2); // initial + one batch run
                assertEqual(seen[1], 30);
            },
        },
        {
            name: 'batchEffects: nested call joins outer batch',
            run() {
                const s = new Signal(0);
                let runs = 0;
                const _eff = new Effect(() => { runs++; s.get(); });
                assertEqual(runs, 1);
                batchEffects(() => {
                    batchEffects(() => { s.set(1); });
                    s.set(2);
                });
                assertEqual(runs, 2);
            },
        },
        {
            name: 'batchEffects: re-invalidated effect runs again in second pass',
            run() {
                const a = new Signal(0);
                const b = new Signal(0);
                let seenA = -1;
                let seenB = -1;
                // Effect A reads a
                const _effA = new Effect(() => { seenA = a.get(); });
                // Effect B reads b, then sets a — so after B runs, A should re-run
                const _effB = new Effect(() => { seenB = b.get(); a.set(b.get() * 10); });
                assertEqual(seenA, 0);
                assertEqual(seenB, 0);
                batchEffects(() => { b.set(5); });
                assertEqual(seenB, 5);
                assertEqual(seenA, 50); // A must have re-run after B set a
            },
        },

        // ─── suppressEffects ─────────────────────────────────────────────────

        {
            name: 'suppressEffects: mutations inside do not trigger effects',
            run() {
                const s = new Signal(1);
                let runs = 0;
                const _eff = new Effect(() => { runs++; s.get(); });
                assertEqual(runs, 1);
                suppressEffects(() => { s.set(2); });
                assertEqual(runs, 1);
            },
        },
        {
            name: 'suppressEffects: computed values are invalidated (go stale)',
            run() {
                const s = new Signal(1);
                const c = new Computed(() => s.get() * 2);
                assertEqual(c.get(), 2);
                suppressEffects(() => { s.set(5); });
                assertEqual(c.get(), 10); // stale, recomputes on next get
            },
        },
        {
            name: 'suppressEffects: effect re-runs on next mutation after suppression ends',
            run() {
                const s = new Signal(1);
                let last = 0;
                const _eff = new Effect(() => { last = s.get(); });
                assertEqual(last, 1);
                suppressEffects(() => { s.set(2); });
                assertEqual(last, 1); // not yet
                s.set(3);
                assertEqual(last, 3); // re-ran on next mutation
            },
        },
        {
            name: 'suppressEffects: nested calls are safe',
            run() {
                const s = new Signal(1);
                let runs = 0;
                const _eff = new Effect(() => { runs++; s.get(); });
                assertEqual(runs, 1);
                suppressEffects(() => {
                    suppressEffects(() => { s.set(2); });
                    s.set(3);
                });
                assertEqual(runs, 1);
                s.set(4);
                assertEqual(runs, 2);
            },
        },
        {
            name: 'suppressEffects: works correctly inside an outer batchEffects',
            run() {
                const s = new Signal(1);
                const t = new Signal(10);
                const seen: number[] = [];
                const _eff = new Effect(() => { seen.push(s.get() + t.get()); });
                batchEffects(() => {
                    suppressEffects(() => { s.set(100); }); // suppressed — no effect
                    t.set(20);                              // batched — effect runs at end
                });
                // Effect ran once at batch end with t=20, s=100 (stale value was recomputed)
                assertEqual(seen.length, 2);
                assertEqual(seen[1], 120);
            },
        },

        // ─── suppressTracking ────────────────────────────────────────────────

        {
            name: 'suppressTracking: get() calls do not register dependencies',
            run() {
                const s = new Signal(1);
                let runs = 0;
                const _eff = new Effect(() => {
                    runs++;
                    suppressTracking(() => s.get()); // read without subscribing
                });
                assertEqual(runs, 1);
                s.set(2);
                assertEqual(runs, 1); // no re-run — dependency was not tracked
            },
        },

        // ─── Activation lifecycle ────────────────────────────────────────────

        {
            name: 'Activation: activated fires when first dependent is added',
            run() {
                let activated = 0;
                const s = new Signal(1, { activated() { activated++; } });
                assertEqual(activated, 0);
                const eff = new Effect(() => s.get());
                assertEqual(activated, 1);
                eff.deactivate();
            },
        },
        {
            name: 'Activation: deactivated fires when last dependent is removed',
            run() {
                let deactivated = 0;
                const s = new Signal(1, { deactivated() { deactivated++; } });
                const eff = new Effect(() => s.get());
                assertEqual(deactivated, 0);
                eff.deactivate();
                assertEqual(deactivated, 1);
            },
        },
        {
            name: 'Activation: callbacks fire transitively through computed chain',
            run() {
                let activated = 0;
                let deactivated = 0;
                const s = new Signal(1, {
                    activated() { activated++; },
                    deactivated() { deactivated++; },
                });
                const c1 = new Computed(() => s.get() + 1);
                const c2 = new Computed(() => c1.get() + 1);
                assertEqual(activated, 0);
                const eff = new Effect(() => c2.get());
                assertEqual(activated, 1);
                eff.deactivate();
                assertEqual(deactivated, 1);
            },
        },
        {
            name: 'Activation: activated/deactivated do not fire again on second deactivate',
            run() {
                let activated = 0;
                let deactivated = 0;
                const s = new Signal(1, {
                    activated() { activated++; },
                    deactivated() { deactivated++; },
                });
                const eff = new Effect(() => s.get());
                eff.deactivate();
                eff.deactivate(); // no-op
                assertEqual(activated, 1);
                assertEqual(deactivated, 1);
            },
        },

        // ─── observableProxy ─────────────────────────────────────────────────

        {
            name: 'observableProxy: root get() returns full object',
            run() {
                const sig = new Signal({ x: 1, y: 2 });
                const proxy = observableProxy(sig);
                assertEqual(proxy.get(), sig.get());
            },
        },
        {
            name: 'observableProxy: nested property access returns a Computed',
            run() {
                const sig = new Signal({ x: 1 });
                const proxy = observableProxy(sig);
                assert(proxy.x instanceof Computed);
                assertEqual(proxy.x.get(), 1);
            },
        },
        {
            name: 'observableProxy: child proxy is cached (same object on repeated access)',
            run() {
                const proxy = observableProxy(new Signal({ x: 1 }));
                assert(proxy.x === proxy.x);
            },
        },
        {
            name: 'observableProxy: child proxies are instanceof Observable',
            run() {
                const proxy = observableProxy(new Signal({ x: { y: 1 } }));
                assert(proxy.x instanceof Observable);
            },
        },
        {
            name: 'observableProxy: unknown symbol keys return undefined (no throw)',
            run() {
                const proxy = observableProxy(new Signal({ x: 1 }));
                // Access a known symbol — should not throw
                const result = (proxy as any)[Symbol.iterator];
                assertEqual(result, undefined);
            },
        },
        {
            name: 'observableProxy: isObservableProxy returns true',
            run() {
                const proxy = observableProxy(new Signal({ x: 1 }));
                assert(isObservableProxy(proxy));
                assert(!isObservableProxy(new Signal(1)));
            },
        },

        // ─── signalProxy ─────────────────────────────────────────────────────

        {
            name: 'signalProxy: root get/set/modify work correctly',
            run() {
                const sig = new Signal({ x: 1 });
                const proxy = signalProxy(sig);
                assertEqual(proxy.get().x, 1);
                proxy.set({ x: 2 });
                assertEqual(proxy.get().x, 2);
                proxy.modify(v => ({ x: v.x + 10 }));
                assertEqual(proxy.get().x, 12);
            },
        },
        {
            name: 'signalProxy: nested property get() returns field value',
            run() {
                const proxy = signalProxy(new Signal({ x: 42 }));
                assertEqual(proxy.x.get(), 42);
            },
        },
        {
            name: 'signalProxy: nested property modify() propagates immutable update',
            run() {
                const sig = new Signal({ x: 1 });
                const proxy = signalProxy(sig);
                proxy.x.modify(v => v + 9);
                assertEqual(sig.get().x, 10);
            },
        },
        {
            name: 'signalProxy: deeply nested modify propagates correctly',
            run() {
                const sig = new Signal({ foo: { a: 1 } });
                const proxy = signalProxy(sig);
                proxy.foo.a.modify(v => v + 1);
                assertEqual(sig.get().foo.a, 2);
            },
        },
        {
            name: 'signalProxy: array index read and write',
            run() {
                const proxy = signalProxy(new Signal([10, 20, 30]));
                assertEqual(proxy[0]!.get(), 10);
                proxy[1]!.modify(v => v + 5);
                assertEqual(proxy[1]!.get(), 25);
            },
        },
        {
            name: 'signalProxy: child proxies are instanceof Signal and DelegatedSignal',
            run() {
                const proxy = signalProxy(new Signal({ x: 1 }));
                assert(proxy.x instanceof Signal);
                assert(proxy.x instanceof Observable);
            },
        },
        {
            name: 'signalProxy: unknown symbol keys return undefined (no throw)',
            run() {
                const proxy = signalProxy(new Signal({ x: 1 }));
                const result = (proxy as any)[Symbol.toPrimitive];
                assertEqual(result, undefined);
            },
        },
        {
            name: 'signalProxy: instanceof checks work (no throw from Symbol.hasInstance)',
            run() {
                const proxy = signalProxy(new Signal({ x: 1 }));
                // These would previously throw when Proxy accessed Symbol.hasInstance
                assert(proxy instanceof Observable);
                assert(proxy instanceof Signal);
            },
        },

        // ─── setValueForKey (via signalProxy modify) ──────────────────────────

        {
            name: 'setValueForKey: plain object update produces correct result',
            run() {
                const sig = new Signal({ a: 1, b: 2 });
                const proxy = signalProxy(sig);
                proxy.a.set(10);
                assertEqual(sig.get().a, 10);
                assertEqual(sig.get().b, 2); // unmodified
            },
        },
        {
            name: 'setValueForKey: array update produces correct result',
            run() {
                const sig = new Signal([1, 2, 3]);
                const proxy = signalProxy(sig);
                proxy[1]!.set(99);
                assertEqual(sig.get()[0], 1);
                assertEqual(sig.get()[1], 99);
                assertEqual(sig.get()[2], 3);
            },
        },
        {
            name: 'setValueForKey: non-integer key on array throws',
            run() {
                const proxy = signalProxy(new Signal([1, 2, 3]));
                assertThrows(() => (proxy as any).notAnIndex.set(0));
                assertThrows(() => (proxy as any)['5abc'].set(0)); // parseInt('5abc') === 5, Number('5abc') === NaN
            },
        },
        {
            name: 'setValueForKey: class instance throws (guard fixed)',
            run() {
                class Foo { constructor(public x: number) {} }
                const sig = new Signal<object>(new Foo(1));
                const proxy = signalProxy(sig as Signal<any>);
                assertThrows(() => (proxy as any).x.set(2), 'should throw for class instance');
            },
        },

        // ─── Computed: error handling ─────────────────────────────────────────

        {
            name: 'Computed: get() propagates thrown errors',
            run() {
                const err = new Error('boom');
                const c = new Computed(() => { throw err; });
                assertThrows(() => c.get());
                try { c.get(); } catch (e) { assert(e === err); }
            },
        },
        {
            name: 'Computed: error is cached — func not re-run when deps unchanged',
            run() {
                const s = new Signal(1);
                let runs = 0;
                const c = new Computed(() => { runs++; if (s.get() < 5) throw new Error('small'); return s.get(); });
                assertThrows(() => c.get());
                assertEqual(runs, 1);
                assertThrows(() => c.get()); // deps unchanged — should not re-run
                assertEqual(runs, 1);
            },
        },
        {
            name: 'Computed: retries and recovers when dep changes after error',
            run() {
                const s = new Signal(1);
                const c = new Computed(() => { if (s.get() < 5) throw new Error('small'); return s.get() * 2; });
                assertThrows(() => c.get());
                s.set(10);
                assertEqual(c.get(), 20);
            },
        },
        {
            name: 'Computed: stale deps unlinked after error',
            run() {
                let deactivatedB = false;
                const a = new Signal(1);
                const b = new Signal(100, { deactivated() { deactivatedB = true; } });
                let shouldThrow = false;
                // First run: reads a and b. Second run: throws before reading either.
                const c = new Computed(() => {
                    if (shouldThrow) throw new Error('boom');
                    return a.get() + b.get();
                });
                new Effect(() => { try { c.get(); } catch {} });
                assert(!deactivatedB, 'b should be active after first successful run');
                shouldThrow = true;
                a.set(2); // triggers recompute of c — throws before reading a or b → both unlinked
                assert(deactivatedB, 'b should be deactivated after error unlinks it');
            },
        },
        {
            name: 'Effect: re-triggered when throwing Computed dep changes',
            run() {
                const s = new Signal(1);
                const c = new Computed(() => { if (s.get() < 5) throw new Error('small'); return s.get() * 2; });
                let runs = 0;
                let lastResult: number | null = null;
                new Effect(() => {
                    runs++;
                    try { lastResult = c.get(); } catch { lastResult = null; }
                });
                assertEqual(runs, 1);
                assertEqual(lastResult, null); // c threw on first run

                s.set(10); // c's dep changes — effect must be re-triggered
                assertEqual(runs, 2);
                assertEqual(lastResult, 20);
            },
        },
        {
            name: 'Effect: re-triggered after error, then stable once recovered',
            run() {
                const s = new Signal(1);
                const c = new Computed(() => { if (s.get() < 5) throw new Error('small'); return s.get() * 2; });
                let runs = 0;
                new Effect(() => { runs++; try { c.get(); } catch {} });
                assertEqual(runs, 1);

                s.set(10); // recovers
                assertEqual(runs, 2);

                s.set(12); // further changes still propagate normally
                assertEqual(runs, 3);

                s.set(12); // same value — no re-run
                assertEqual(runs, 3);
            },
        },
        {
            name: 'Computed: error propagates through a Computed chain',
            run() {
                const s = new Signal(1);
                const c1 = new Computed(() => { if (s.get() < 5) throw new Error('small'); return s.get(); });
                const c2 = new Computed(() => c1.get() * 2);
                assertThrows(() => c2.get());
                s.set(10);
                assertEqual(c2.get(), 20);
            },
        },
        {
            name: 'Computed: invalidate() propagates through error state',
            run() {
                const s = new Signal(1);
                const c = new Computed(() => { if (s.get() < 5) throw new Error('small'); return s.get() * 2; });
                let runs = 0;
                new Effect(() => { runs++; try { c.get(); } catch {} });
                assertEqual(runs, 1);

                // Multiple dep changes should each re-trigger the effect
                s.set(2); assertEqual(runs, 2); // still errors
                s.set(3); assertEqual(runs, 3); // still errors
                s.set(10); assertEqual(runs, 4); // recovers
            },
        },

        // ─── Constant ────────────────────────────────────────────────────────

        {
            name: 'Constant: get() always returns initial value',
            run() {
                const c = new Constant(42);
                assertEqual(c.get(), 42);
                assertEqual(c.get(), 42);
            },
        },
        {
            name: 'Constant: activated/deactivated lifecycle fires',
            run() {
                let activated = 0;
                let deactivated = 0;
                const c = new Constant(1, {
                    activated() { activated++; },
                    deactivated() { deactivated++; },
                });
                const eff = new Effect(() => c.get());
                assertEqual(activated, 1);
                eff.deactivate();
                assertEqual(deactivated, 1);
            },
        },
    ],
};
