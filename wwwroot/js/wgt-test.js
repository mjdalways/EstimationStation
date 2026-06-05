// ============================================================
// Widget/Docking System — Full Combinatorial Test Suite
// Paste into browser console on /room/<any-room> page, or load via:
//   fetch('/js/wgt-test.js').then(r => r.text()).then(eval)
//
// Tests every panel in every state, then every pair of panels
// in every combination of states (2430 pairwise combinations).
// Expected runtime: ~2-3 minutes.
// ============================================================
(async function _wgtTest() {
    var DELAY_FAST   = 25;   // ms — simple DOM moves
    var DELAY_MEDIUM = 50;   // ms — float create/destroy, layout changes
    var DELAY_RESET  = 100;  // ms — full reset settle

    var pass = 0, fail = 0, log = [];

    function wait(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

    function check(label, expr) {
        var ok = !!expr;
        log.push((ok ? '✅' : '❌') + ' ' + label);
        if (ok) pass++; else fail++;
    }

    // ── State helpers ──────────────────────────────────────────

    function panelInDom(id) {
        var el = document.getElementById(id);
        if (el && document.contains(el)) return true;
        // Fallback: check registry _el reference (survives DOM detachment)
        var reg = (_wgtRegistry || []).find(function(w) { return w.id === id; });
        return !!(reg && reg._el && document.contains(reg._el));
    }
    function panelVisible(id) {
        var el = document.getElementById(id);
        if (!el || !document.contains(el) || el.style.display === 'none') return false;
        var r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
    }
    function panelIsFloat(id) {
        return !!document.getElementById('wft_' + id);
    }
    function panelIsInZone(id, zone) {
        var zoneIds = { 'L-top':'wgt-zone-L-top','L-bot':'wgt-zone-L-bot',
                        'C-top':'wgt-zone-C-top','C-bot':'wgt-zone-C-bot',
                        'R-top':'wgt-zone-R-top','R-bot':'wgt-zone-R-bot',
                        'Bot':  'wgt-zone-Bot' };
        var el     = document.getElementById(id);
        var zoneEl = document.getElementById(zoneIds[zone]);
        return !!(el && zoneEl && zoneEl.contains(el));
    }
    function panelAtHome(id) {
        var anchor = document.getElementById('wgh_' + id);
        var el     = document.getElementById(id);
        if (!anchor || !anchor.parentNode || !el) return false;
        // Panel should be the next non-hidden sibling of the anchor
        var sib = anchor.nextSibling;
        while (sib && sib.nodeType !== 1) sib = sib.nextSibling;
        return sib === el;
    }

    /**
     * Returns true if the panel is in the expected state.
     * strictVisibility=false relaxes the visibility check for zone states — use when another
     * large panel in the same zone may squeeze this one to 0px height (still correct structurally).
     */
    function checkState(id, state, strictVisibility) {
        if (strictVisibility === undefined) strictVisibility = true;
        switch (state) {
            case 'float':  return panelIsFloat(id) && panelInDom(id);
            case 'hidden': return panelInDom(id) && !panelVisible(id) && !panelIsFloat(id);
            case 'home':   return panelAtHome(id) && panelVisible(id);
            default:
                // Zone state: always check structure; only check visibility if strict
                return panelIsInZone(id, state) && (!strictVisibility || panelVisible(id));
        }
    }

    /** Put a panel into a given state. Always starts from a clean home-dock. */
    async function setState(id, state) {
        var reg = (_wgtRegistry || []).find(function(w) { return w.id === id; });
        var title = (reg && reg.title) || id;
        // Ensure panel is reachable (re-attach if orphaned via registry _el ref)
        if (!document.getElementById(id) && reg && reg._el && !document.contains(reg._el)) {
            var anchor = document.getElementById('wgh_' + id);
            if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(reg._el, anchor.nextSibling);
        }
        // Always bring to home first so subsequent ops start from a known state
        _widgetDockToZone(id, 'home');
        if (state === 'home') { await wait(DELAY_FAST); return; }
        if (state === 'float') {
            _widgetDetach(id, title);
            await wait(DELAY_MEDIUM);
            return;
        }
        if (state === 'hidden') {
            _widgetClose(id);
            await wait(DELAY_FAST);
            return;
        }
        // Zone
        _widgetDockToZone(id, state);
        await wait(DELAY_FAST);
    }

    // ── Panel / state catalogue ────────────────────────────────

    var PANELS = [
        { id: 'roomControlsPanel',  title: '🎮 Controls'       },
        { id: 'storiesPanel',       title: '📋 Stories'        },
        { id: 'votingSection',      title: '🃏 Your Vote'      },
        { id: 'participantsSection',title: '👥 Participants'   },
        { id: 'vibeCheckPanel',     title: '🌡️ Vibe Check'     },
        { id: 'session-tc-bar',     title: '⏱️ Timer/Clock'   },
        { id: 'currentStoryBar',    title: '📌 Current Story'  },
        { id: 'chatPanel',          title: '💬 Chat'           }
    ];
    var ZONES  = ['L-top','L-bot','C-top','C-bot','R-top','R-bot','Bot'];
    var STATES = ['home','float','hidden'].concat(ZONES); // 10 states

    // ── Phase 1 — Individual state tests ──────────────────────
    console.log('🧪 Phase 1: individual states (' + (PANELS.length * STATES.length) + ' checks)…');
    for (var p of PANELS) {
        for (var s of STATES) {
            _wgtResetAll();
            await wait(DELAY_RESET);
            await setState(p.id, s);
            check('Solo [' + p.id + '] state=' + s, checkState(p.id, s));
        }
    }

    // ── Phase 2 — Pairwise combinatorial tests ─────────────────
    // For each (panelA, stateA) fix A, then iterate every (panelB≠A, stateB).
    // Only reset between stateA changes to keep runtime reasonable.
    var pairCount = PANELS.length * STATES.length * (PANELS.length - 1) * STATES.length;
    console.log('🧪 Phase 2: pairwise combinations (' + pairCount + ' pairs, ~' + Math.round(pairCount * 35 / 1000) + 's)…');

    for (var pA of PANELS) {
        for (var sA of STATES) {
            // Full reset + set A once, then iterate all B×stateB without re-resetting
            _wgtResetAll();
            await wait(DELAY_RESET);
            await setState(pA.id, sA);

            for (var pB of PANELS) {
                if (pB.id === pA.id) continue;
                for (var sB of STATES) {
                    await setState(pB.id, sB);

                    // When A and B are both in the same dock zone, they share flex space and
                    // one may be squeezed to 0px height — still correct structurally.
                    // Relax the visibility check in that case so we test structure, not layout.
                    var sameZone = (sA === sB) && sA !== 'home' && sA !== 'float' && sA !== 'hidden';
                    var aOk = checkState(pA.id, sA, !sameZone);
                    var bOk = checkState(pB.id, sB, !sameZone);

                    if (!aOk || !bOk) {
                        // Only log failures to keep output manageable
                        if (!aOk) check('[' + pA.id + '=' + sA + '] + [' + pB.id + '=' + sB + ']: A still in ' + sA, false);
                        if (!bOk) check('[' + pA.id + '=' + sA + '] + [' + pB.id + '=' + sB + ']: B in '       + sB, false);
                    } else {
                        pass += 2; // count silently to keep log size manageable
                    }

                    // Return B to home before next iteration (keeps A's state intact)
                    await setState(pB.id, 'home');
                }
            }
        }
    }

    // ── Phase 3 — Reset restores everything ───────────────────
    console.log('🧪 Phase 3: reset-all restores all panels…');
    // Mess up every panel
    await setState('roomControlsPanel',  'float');
    await setState('storiesPanel',       'float');
    await setState('votingSection',      'hidden');
    await setState('participantsSection','R-top');
    await setState('vibeCheckPanel',     'C-bot');
    await wait(DELAY_MEDIUM);
    _wgtResetAll();
    await wait(DELAY_RESET * 2);
    for (var p of PANELS) {
        check('Reset: ' + p.id + ' visible at home', checkState(p.id, 'home'));
    }

    // ── Phase 4 — Collapse→Float→Home round-trip ──────────────
    console.log('🧪 Phase 4: collapse→float→home for controls…');
    _wgtResetAll();
    await wait(DELAY_RESET);
    var cpEl = document.getElementById('roomControlsPanel');
    if (cpEl && !cpEl.classList.contains('collapsed')) toggleControlsPanel();
    await wait(DELAY_FAST);
    check('Collapse setup: controls has .collapsed', cpEl && cpEl.classList.contains('collapsed'));
    await setState('roomControlsPanel', 'float');
    check('Collapse→Float: expanded in float', cpEl && !cpEl.classList.contains('collapsed'));
    check('Collapse→Float: float wrapper visible', panelVisible('roomControlsPanel'));
    _widgetDockToZone('roomControlsPanel', 'home');
    await wait(DELAY_MEDIUM);
    check('Collapse→Float→Home: collapsed restored', cpEl && cpEl.classList.contains('collapsed'));
    toggleControlsPanel(); // leave expanded

    // ── Report ─────────────────────────────────────────────────
    _wgtResetAll(); // clean up after tests
    await wait(DELAY_RESET);

    // Print only failures first, then summary
    var failures = log.filter(function(l) { return l.startsWith('❌'); });
    if (failures.length) {
        console.log('\n❌ Failed checks (' + failures.length + '):');
        failures.forEach(function(l) { console.log('  ' + l); });
    }
    // Print all phase-1/3/4 checks (phase 2 only logs failures to keep output small)
    var explicit = log.filter(function(l) { return !l.startsWith('❌'); });
    if (explicit.length <= 200) explicit.forEach(function(l) { console.log(l); });

    var totalChecks = pass + fail;
    console.log('\n' + (fail === 0 ? '🎉' : '⚠️') +
        ' Results: ' + pass + ' passed, ' + fail + ' failed out of ' + totalChecks + ' checks.');
    if (fail === 0) console.log('All widget combinations verified ✅');

    return { pass: pass, fail: fail, failures: failures };
})();
