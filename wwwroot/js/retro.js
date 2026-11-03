// ============================================================
// Feature 11 / P4 + R1–R8 — Retro Mode
// ------------------------------------------------------------
// The sticky-note retro the team currently runs in Miro, as a first-class room mode: four
// (or five, or three — see the format library) columns of notes, a phase-driven flow from
// Collect through Actions, dot voting, grouping, and an action list that survives into the
// next board.
//
// The single most important rule in this file: it renders ONLY what the server sends. During
// Collect the server withholds everybody else's notes (that's the anchoring fix — see
// RetroBoardPayload in Hubs/PokerHub.cs), during Vote it withholds tallies, and on an
// anonymous board it strips authorship outright. An optimistic local copy would quietly
// undo all three, so every mutation goes out over RetroNet and the board redraws when it
// comes back.
// ============================================================
(function () {
    'use strict';

    var _root = null, _built = false;
    var _headerEl = null, _sprintEl = null, _boardEl = null, _sideEl = null, _startEl = null, _mainEl = null;

    var _b = null;             // the RetroBoardPayload, verbatim
    var _archive = [];
    var _formats = ['default'];
    var _limits = { maxNoteLength: 500, maxNotes: 400, maxActions: 100, votesPerPerson: { min: 1, max: 10 } };
    var _sprintOpen = false;
    var _dragNoteId = null;
    var _editingNoteId = null;

    var PHASE_LABELS = {
        collect: '📝 Collect', reveal: '👀 Reveal', group: '🧩 Group',
        vote: '🗳️ Vote', discuss: '💬 Discuss', actions: '✅ Actions', closed: '📦 Closed'
    };
    var NOTE_COLOURS = ['#fff3bf', '#d3f9d8', '#d0ebff', '#ffd8a8', '#f3d9fa', '#ffe3e3'];

    function _esc(s) {
        return String(s === undefined || s === null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function _isHost() { return !!(window.roomState && roomState.isHost); }
    function _phaseIdx(p) { return (_b && _b.phases ? _b.phases : []).indexOf(p || (_b && _b.phase)); }
    function _atLeast(p) { return _phaseIdx(_b && _b.phase) >= _phaseIdx(p); }
    function _editable() { return !!_b && !_b.closedAtUtc && !_b.paused; }

    function _sprintContext() {
        if (!_b || !_b.sprintContext) return null;
        try { return JSON.parse(_b.sprintContext); } catch (e) { return null; }
    }

    // ---- header ------------------------------------------------------------------------

    function _renderHeader() {
        if (!_headerEl) return;
        if (!_b) { _headerEl.innerHTML = ''; return; }

        var phases = _b.phases || [];
        var stepper = phases.map(function (p) {
            var cur = p === _b.phase;
            var past = _phaseIdx(p) < _phaseIdx(_b.phase);
            var cls = 'retro-step' + (cur ? ' retro-step-current' : (past ? ' retro-step-past' : ''));
            var attr = _isHost() && _editable() ? ' data-phase="' + _esc(p) + '" role="button" tabindex="0"' : '';
            return '<span class="' + cls + '"' + attr + '>' + (PHASE_LABELS[p] || _esc(p)) + '</span>';
        }).join('<span class="retro-step-sep">›</span>');

        var votesLeft = Math.max(0, (_b.votesPerPerson || 0) - (_b.votesSpent || 0));

        _headerEl.innerHTML =
            '<div class="retro-head-top">' +
                '<div class="retro-head-title">' +
                    '<span class="retro-head-name">' + _esc(_b.title || 'Retro') + '</span>' +
                    (_b.sprintName ? '<span class="retro-head-sprint">' + _esc(_b.sprintName) + '</span>' : '') +
                    (_b.anonymous ? '<span class="retro-badge" title="Notes are anonymous — set when the board was created and fixed for its life">🕶️ Anonymous</span>' : '') +
                    (_b.paused ? '<span class="retro-badge retro-badge-warn" title="The board is frozen while the room talks">⏸️ Paused</span>' : '') +
                    (_b.closedAtUtc ? '<span class="retro-badge">📦 Archived</span>' : '') +
                '</div>' +
                '<div class="retro-head-actions">' +
                    (_atLeast('vote') && !_atLeast('discuss')
                        ? '<span class="retro-votes-left" title="Dots you have left">🗳️ ' + votesLeft + ' left</span>' : '') +
                    (_isHost() && !_b.closedAtUtc
                        ? '<button class="btn btn-sm btn-outline-secondary" id="rt-pause">' + (_b.paused ? '▶️ Resume' : '⏸️ Pause') + '</button>' +
                          '<button class="btn btn-sm btn-outline-secondary" id="rt-sprint">📥 Sprint…</button>' +
                          '<button class="btn btn-sm btn-outline-danger" id="rt-close-board">📦 Archive</button>'
                        : '') +
                    '<button class="btn btn-sm btn-outline-secondary" id="rt-export">⬇️ Export</button>' +
                '</div>' +
            '</div>' +
            '<div class="retro-steps">' + stepper + '</div>';

        if (_isHost() && _editable()) {
            Array.prototype.forEach.call(_headerEl.querySelectorAll('[data-phase]'), function (el) {
                el.addEventListener('click', function () { RetroNet.setPhase(el.getAttribute('data-phase')); });
            });
        }
        function wire(id, fn) { var el = _headerEl.querySelector(id); if (el) el.addEventListener('click', fn); }
        wire('#rt-pause', function () { RetroNet.setPaused(!_b.paused); });
        wire('#rt-close-board', function () {
            if (confirm('Archive this board? Open actions carry over to the next retro.')) RetroNet.close();
        });
        wire('#rt-sprint', _openSprintDialog);
        wire('#rt-export', exportMarkdown);
    }

    // ---- sprint context (R1) -----------------------------------------------------------

    function _renderSprint() {
        if (!_sprintEl) return;
        var ctx = _sprintContext();
        if (!ctx) { _sprintEl.style.display = 'none'; return; }
        _sprintEl.style.display = '';

        var pct = ctx.committedPoints ? Math.round(100 * (ctx.completedPoints || 0) / ctx.committedPoints) : 0;
        var head = '<button class="retro-sprint-toggle" id="rt-sprint-toggle">' +
            (_sprintOpen ? '▾' : '▸') + ' 📊 ' + _esc(ctx.name || 'Sprint') +
            ' <span class="retro-sprint-chips">' +
            '<span class="retro-chip">' + (ctx.completedPoints || 0) + '/' + (ctx.committedPoints || 0) + ' pts (' + pct + '%)</span>' +
            '<span class="retro-chip">' + (ctx.carriedOver || 0) + ' carried over</span>' +
            '<span class="retro-chip">' + ((ctx.issues || []).length) + ' issues</span>' +
            '</span></button>';

        var detail = '';
        if (_sprintOpen) {
            detail = '<div class="retro-sprint-detail">' +
                (ctx.goal ? '<div class="retro-sprint-goal">🎯 ' + _esc(ctx.goal) + '</div>' : '') +
                '<div class="retro-table-wrap"><table class="retro-table"><thead><tr>' +
                '<th>Key</th><th>Summary</th><th>Status</th><th>Pts</th><th title="Rounds it took us to estimate it">Rounds</th><th>Our estimate</th>' +
                '</tr></thead><tbody>' +
                (ctx.issues || []).map(function (i) {
                    return '<tr class="' + (i.statusCategory === 'done' ? '' : 'retro-row-carried') + '">' +
                        '<td>' + (i.url ? '<a href="' + _esc(i.url) + '" target="_blank" rel="noopener">' + _esc(i.key) + '</a>' : _esc(i.key)) + '</td>' +
                        '<td>' + _esc(i.summary) + '</td>' +
                        '<td>' + _esc(i.status) + '</td>' +
                        '<td>' + (i.storyPoints === null || i.storyPoints === undefined ? '—' : i.storyPoints) + '</td>' +
                        '<td>' + (i.ourRounds || 0) + (i.ourContested ? ' <span title="We did not agree first time">💥</span>' : '') + '</td>' +
                        '<td>' + (i.ourEstimate ? _esc(i.ourEstimate) : '—') + '</td>' +
                        '</tr>';
                }).join('') +
                '</tbody></table></div></div>';
        }

        _sprintEl.innerHTML = head + detail;
        var t = _sprintEl.querySelector('#rt-sprint-toggle');
        if (t) t.addEventListener('click', function () { _sprintOpen = !_sprintOpen; _renderSprint(); });
    }

    // ---- board -------------------------------------------------------------------------

    function _notesFor(columnKey) {
        return (_b.notes || []).filter(function (n) { return n.columnKey === columnKey; });
    }

    function _groupOf(id) {
        return (_b.groups || []).filter(function (g) { return g.id === id; })[0] || null;
    }

    function _noteHtml(n) {
        var votes = _atLeast('vote');
        var canVote = _b.phase === 'vote' && _editable();
        var group = n.groupId ? _groupOf(n.groupId) : null;
        return '<div class="retro-note' + (n.mine ? ' retro-note-mine' : '') +
                (n.discussed ? ' retro-note-discussed' : '') +
                (_b.currentTopicId === n.id ? ' retro-note-topic' : '') + '"' +
            ' data-note="' + _esc(n.id) + '"' +
            ' style="background:' + _esc(n.colour || '#fff3bf') + ';"' +
            (_editable() && n.mine ? ' draggable="true"' : (_editable() && _atLeast('group') ? ' draggable="true"' : '')) + '>' +
            (group ? '<div class="retro-note-group" title="Grouped">🧩 ' + _esc(group.title || 'Group') + '</div>' : '') +
            '<div class="retro-note-text">' + (n.text ? _esc(n.text) : '<span class="retro-note-frozen">— hidden —</span>') + '</div>' +
            '<div class="retro-note-foot">' +
                '<span class="retro-note-author">' + (n.author ? _esc(n.author) : (n.mine ? 'you' : '')) + '</span>' +
                ((n.linkedIssueKeys || []).length ? '<span class="retro-note-link" title="Linked issues">🔗 ' + _esc(n.linkedIssueKeys.join(', ')) + '</span>' : '') +
                (votes ? '<span class="retro-note-votes" title="' + (n.votesHidden ? 'Your dots' : 'Total dots') + '">' +
                    (n.votesHidden ? '🗳️ ' + (n.myVotes || 0) : '🗳️ ' + (n.votes || 0)) + '</span>' : '') +
                (canVote
                    ? '<span class="retro-vote-btns"><button class="retro-vote-btn" data-vote="-1" data-target="' + _esc(n.id) + '">−</button>' +
                      '<button class="retro-vote-btn" data-vote="1" data-target="' + _esc(n.id) + '">+</button></span>'
                    : '') +
                (_editable() && n.mine
                    ? '<span class="retro-note-tools">' +
                      '<button class="retro-icon-btn" data-edit="' + _esc(n.id) + '" title="Edit">✏️</button>' +
                      '<button class="retro-icon-btn" data-del="' + _esc(n.id) + '" title="Delete">🗑️</button></span>'
                    : '') +
                (_atLeast('discuss') && _editable()
                    ? '<button class="retro-icon-btn" data-action-from="' + _esc(n.id) + '" title="Turn into an action">➕✅</button>'
                    : '') +
            '</div>' +
            '</div>';
    }

    function _renderBoard() {
        if (!_boardEl) return;
        if (!_b) { _boardEl.innerHTML = ''; return; }

        var collecting = _b.phase === 'collect';
        var cols = (_b.columns || []).slice().sort(function (a, b) { return a.order - b.order; });
        _boardEl.style.gridTemplateColumns = 'repeat(' + Math.max(1, cols.length) + ', minmax(180px,1fr))';

        _boardEl.innerHTML = cols.map(function (c) {
            var notes = _notesFor(c.key);
            var count = (_b.columnCounts || {})[c.key];
            return '<section class="retro-col" data-col="' + _esc(c.key) + '" style="--retro-col:' + _esc(c.colour || '#6b7280') + ';">' +
                '<header class="retro-col-head">' +
                    '<span class="retro-col-emoji">' + _esc(c.emoji || '') + '</span>' +
                    '<span class="retro-col-label">' + _esc(c.label) + '</span>' +
                    '<span class="retro-col-count" title="' + (collecting ? 'Notes so far (bodies stay hidden until Reveal)' : 'Notes') + '">' +
                        (count === undefined ? notes.length : count) + '</span>' +
                '</header>' +
                (collecting && count > notes.length
                    ? '<div class="retro-col-hidden">' + (count - notes.length) + ' note' + ((count - notes.length) === 1 ? '' : 's') +
                      ' from others, hidden until Reveal</div>'
                    : '') +
                '<div class="retro-col-notes">' + notes.map(_noteHtml).join('') + '</div>' +
                (collecting && _editable()
                    ? '<div class="retro-add"><textarea class="form-control form-control-sm retro-add-input" rows="2" ' +
                      'maxlength="' + _limits.maxNoteLength + '" placeholder="Add a note…" data-add="' + _esc(c.key) + '"></textarea>' +
                      '<button class="btn btn-sm btn-primary retro-add-btn" data-addbtn="' + _esc(c.key) + '">Add</button></div>'
                    : '') +
                '</section>';
        }).join('');

        _wireBoard();
    }

    function _wireBoard() {
        var q = function (sel) { return Array.prototype.slice.call(_boardEl.querySelectorAll(sel)); };

        q('[data-addbtn]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var key = btn.getAttribute('data-addbtn');
                var ta = _boardEl.querySelector('[data-add="' + key + '"]');
                var text = (ta.value || '').trim();
                if (!text) return;
                RetroNet.addNote(key, text, null);
                ta.value = '';
                ta.focus();
            });
        });
        q('[data-add]').forEach(function (ta) {
            ta.addEventListener('keydown', function (e) {
                // Enter posts, Shift+Enter breaks the line — a retro note is usually one line.
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    var btn = _boardEl.querySelector('[data-addbtn="' + ta.getAttribute('data-add') + '"]');
                    if (btn) btn.click();
                }
            });
        });
        q('[data-vote]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                RetroNet.vote(btn.getAttribute('data-target'), parseInt(btn.getAttribute('data-vote'), 10));
            });
        });
        q('[data-del]').forEach(function (btn) {
            btn.addEventListener('click', function () { RetroNet.deleteNote(btn.getAttribute('data-del')); });
        });
        q('[data-edit]').forEach(function (btn) {
            btn.addEventListener('click', function () { _startEdit(btn.getAttribute('data-edit')); });
        });
        q('[data-action-from]').forEach(function (btn) {
            btn.addEventListener('click', function () { _openActionDialog(btn.getAttribute('data-action-from')); });
        });
        q('.retro-note').forEach(function (el) {
            var id = el.getAttribute('data-note');
            el.addEventListener('click', function (e) {
                if (e.target.closest('button')) return;
                if (_b.phase === 'discuss' && _isHost() && _editable()) RetroNet.setTopic(id, false);
            });
            el.addEventListener('dragstart', function (e) {
                _dragNoteId = id;
                try { e.dataTransfer.setData('text/plain', id); e.dataTransfer.effectAllowed = 'move'; } catch (err) {}
            });
            el.addEventListener('dragend', function () { _dragNoteId = null; });
            el.addEventListener('dragover', function (e) {
                if (_dragNoteId && _dragNoteId !== id && _atLeast('group')) { e.preventDefault(); el.classList.add('retro-note-droptarget'); }
            });
            el.addEventListener('dragleave', function () { el.classList.remove('retro-note-droptarget'); });
            el.addEventListener('drop', function (e) {
                el.classList.remove('retro-note-droptarget');
                if (!_dragNoteId || _dragNoteId === id) return;
                e.preventDefault();
                e.stopPropagation();
                // Dropping a note ONTO a note groups them (R3); dropping on the column moves it.
                RetroNet.groupNotes(_dragNoteId, id, null);
                _dragNoteId = null;
            });
        });
        q('.retro-col').forEach(function (col) {
            col.addEventListener('dragover', function (e) { if (_dragNoteId) { e.preventDefault(); col.classList.add('retro-col-drop'); } });
            col.addEventListener('dragleave', function () { col.classList.remove('retro-col-drop'); });
            col.addEventListener('drop', function (e) {
                col.classList.remove('retro-col-drop');
                if (!_dragNoteId) return;
                e.preventDefault();
                RetroNet.moveNote(_dragNoteId, col.getAttribute('data-col'), 0, 0);
                _dragNoteId = null;
            });
        });
    }

    function _startEdit(noteId) {
        var note = (_b.notes || []).filter(function (n) { return n.id === noteId; })[0];
        if (!note) return;
        var el = _boardEl.querySelector('.retro-note[data-note="' + noteId + '"]');
        if (!el) return;
        _editingNoteId = noteId;
        var textEl = el.querySelector('.retro-note-text');
        textEl.innerHTML = '<textarea class="form-control form-control-sm" rows="3" maxlength="' + _limits.maxNoteLength + '"></textarea>' +
            '<div class="retro-swatches">' + NOTE_COLOURS.map(function (c) {
                return '<button class="retro-swatch" data-colour="' + c + '" style="background:' + c + ';" title="Colour"></button>';
            }).join('') + '</div>' +
            '<div class="retro-edit-actions"><button class="btn btn-sm btn-primary" data-save="1">Save</button>' +
            '<button class="btn btn-sm btn-outline-secondary" data-cancel="1">Cancel</button></div>';
        var ta = textEl.querySelector('textarea');
        ta.value = note.text || '';
        ta.focus();
        var colour = note.colour;
        Array.prototype.forEach.call(textEl.querySelectorAll('[data-colour]'), function (sw) {
            sw.addEventListener('click', function () { colour = sw.getAttribute('data-colour'); });
        });
        textEl.querySelector('[data-save]').addEventListener('click', function () {
            _editingNoteId = null;
            RetroNet.editNote(noteId, ta.value, colour);
        });
        textEl.querySelector('[data-cancel]').addEventListener('click', function () {
            _editingNoteId = null;
            _renderBoard();
        });
    }

    // ---- side panel: topics + actions --------------------------------------------------

    function _renderSide() {
        if (!_sideEl) return;
        if (!_b) { _sideEl.innerHTML = ''; return; }

        var html = '';

        // Discuss (R4): everything with at least one dot, hottest first — the running order
        // the room votes for rather than the order the notes happened to be written in.
        if (_atLeast('discuss')) {
            var topics = [];
            (_b.groups || []).forEach(function (g) {
                topics.push({ id: g.id, label: g.title || 'Group', votes: g.votes || 0, discussed: g.discussed, group: true });
            });
            (_b.notes || []).forEach(function (n) {
                if (n.groupId) return;
                topics.push({ id: n.id, label: n.text || '(hidden)', votes: n.votes || 0, discussed: n.discussed, group: false });
            });
            topics.sort(function (a, b) { return b.votes - a.votes; });

            html += '<h6 class="retro-side-title">💬 Running order</h6><ol class="retro-topics">' +
                topics.map(function (t) {
                    return '<li class="retro-topic' + (t.discussed ? ' retro-topic-done' : '') +
                        (_b.currentTopicId === t.id ? ' retro-topic-current' : '') + '">' +
                        '<span class="retro-topic-votes">' + t.votes + '</span>' +
                        '<span class="retro-topic-label">' + (t.group ? '🧩 ' : '') + _esc(t.label) + '</span>' +
                        (_isHost() && _editable()
                            ? '<span class="retro-topic-tools">' +
                              '<button class="retro-icon-btn" data-topic="' + _esc(t.id) + '" title="Discuss this now">▶️</button>' +
                              '<button class="retro-icon-btn" data-done="' + _esc(t.id) + '" title="Mark discussed">✔️</button></span>'
                            : '') +
                        '</li>';
                }).join('') + '</ol>';
        }

        var carried = {};
        (_b.carriedActionIds || []).forEach(function (id) { carried[id] = true; });

        html += '<h6 class="retro-side-title">✅ Actions' +
            (_editable() ? ' <button class="btn btn-sm btn-outline-primary retro-side-add" id="rt-add-action">＋</button>' : '') +
            '</h6>';
        var actions = _b.actions || [];
        html += actions.length
            ? '<div class="retro-actions">' + actions.map(function (a) {
                return '<div class="retro-action retro-action-' + _esc(a.status || 'open') + '" data-act="' + _esc(a.id) + '">' +
                    '<div class="retro-action-text">' + _esc(a.text) +
                        (carried[a.id] || a.carryCount
                            ? '<span class="retro-badge retro-badge-warn" title="Carried over from an earlier retro">↩️ ×' + (a.carryCount || 1) + '</span>'
                            : '') +
                    '</div>' +
                    '<div class="retro-action-meta">' +
                        (a.owner ? '<span>👤 ' + _esc(a.owner) + '</span>' : '') +
                        (a.dueDateUtc ? '<span>📅 ' + _esc(String(a.dueDateUtc).slice(0, 10)) + '</span>' : '') +
                        (a.jiraKey
                            ? '<a href="' + _esc(a.jiraUrl || '#') + '" target="_blank" rel="noopener">🔗 ' + _esc(a.jiraKey) + '</a>'
                            : '') +
                    '</div>' +
                    (_editable()
                        ? '<div class="retro-action-tools">' +
                            '<select class="form-select form-select-sm" data-status="' + _esc(a.id) + '">' +
                              ['open', 'doing', 'done', 'dropped'].map(function (s) {
                                  return '<option value="' + s + '"' + ((a.status || 'open') === s ? ' selected' : '') + '>' + s + '</option>';
                              }).join('') +
                            '</select>' +
                            '<button class="retro-icon-btn" data-editact="' + _esc(a.id) + '" title="Edit">✏️</button>' +
                            (a.jiraKey ? '' : '<button class="retro-icon-btn" data-jira="' + _esc(a.id) + '" title="Create a Jira issue">📤</button>') +
                          '</div>'
                        : '') +
                    '</div>';
            }).join('') + '</div>'
            : '<div class="retro-empty">No actions yet. Anything the team agrees to change goes here — it carries into the next retro until it is done.</div>';

        // Archive (R5)
        html += '<h6 class="retro-side-title">📦 Past retros</h6>';
        html += _archive.length
            ? '<div class="retro-archive">' + _archive.map(function (a) {
                return '<button class="retro-archive-item' + (a.isActive ? ' retro-archive-current' : '') + '" data-board="' + _esc(a.id) + '">' +
                    '<span class="retro-archive-name">' + _esc(a.sprintName || a.title || 'Retro') + '</span>' +
                    '<span class="retro-archive-meta">' + _esc(String(a.startedAtUtc || '').slice(0, 10)) +
                    ' · ' + a.noteCount + ' notes · ' + a.openActionCount + ' open</span>' +
                    '</button>';
            }).join('') + '</div>'
            : '<div class="retro-empty">This is the first one.</div>';

        if (_isHost()) {
            html += '<button class="btn btn-sm btn-outline-primary w-100 mt-2" id="rt-new-board">➕ New retro board</button>';
        }

        _sideEl.innerHTML = html;
        _wireSide();
    }

    function _wireSide() {
        var q = function (sel) { return Array.prototype.slice.call(_sideEl.querySelectorAll(sel)); };
        q('[data-topic]').forEach(function (b) {
            b.addEventListener('click', function () { RetroNet.setTopic(b.getAttribute('data-topic'), false); });
        });
        q('[data-done]').forEach(function (b) {
            b.addEventListener('click', function () { RetroNet.setTopic(b.getAttribute('data-done'), true); });
        });
        q('[data-status]').forEach(function (sel) {
            sel.addEventListener('change', function () {
                RetroNet.updateAction(sel.getAttribute('data-status'), undefined, undefined, undefined, sel.value);
            });
        });
        q('[data-editact]').forEach(function (b) {
            b.addEventListener('click', function () { _openActionDialog(null, b.getAttribute('data-editact')); });
        });
        q('[data-jira]').forEach(function (b) {
            b.addEventListener('click', function () { _openJiraDialog(b.getAttribute('data-jira')); });
        });
        q('[data-board]').forEach(function (b) {
            b.addEventListener('click', function () { RetroNet.openBoard(b.getAttribute('data-board')); });
        });
        var add = _sideEl.querySelector('#rt-add-action');
        if (add) add.addEventListener('click', function () { _openActionDialog(null); });
        var nb = _sideEl.querySelector('#rt-new-board');
        if (nb) nb.addEventListener('click', function () { _b = null; _render(); });
    }

    // ---- dialogs -----------------------------------------------------------------------

    // room.js's shared Bootstrap-modal helper, lifted above this overlay. Bootstrap stacks
    // modals at z-index 1055, which is *under* the retro's 2000, so without this bump the
    // dialog opens invisibly behind the board. onClick returning false keeps it open — that
    // is _f11Modal's own convention, kept here so the two read the same.
    function _modal(title, bodyHtml, buttons) {
        var host = window._f11Modal(title, bodyHtml, buttons);
        try {
            host.style.zIndex = '2200';
            // The backdrop is appended by Bootstrap on show; it is always the last one.
            var backs = document.querySelectorAll('.modal-backdrop');
            if (backs.length) backs[backs.length - 1].style.zIndex = '2190';
        } catch (e) {}
        return host;
    }

    function _openActionDialog(sourceNoteId, existingId) {
        var existing = existingId
            ? (_b.actions || []).filter(function (a) { return a.id === existingId; })[0]
            : null;
        var seed = '';
        if (sourceNoteId) {
            var n = (_b.notes || []).filter(function (x) { return x.id === sourceNoteId; })[0];
            if (n) seed = n.text || '';
        }
        var names = ((window.roomState && roomState.participants) || []).map(function (p) { return p.name; });
        var body =
            '<label class="f11-field"><span>Action</span><textarea id="rt-a-text" class="form-control form-control-sm" rows="3">' +
                _esc(existing ? existing.text : seed) + '</textarea></label>' +
            '<label class="f11-field"><span>Owner</span><input id="rt-a-owner" class="form-control form-control-sm" list="rt-a-names" value="' +
                _esc(existing ? (existing.owner || '') : '') + '"></label>' +
            '<datalist id="rt-a-names">' + names.map(function (n) { return '<option value="' + _esc(n) + '">'; }).join('') + '</datalist>' +
            '<label class="f11-field"><span>Due</span><input id="rt-a-due" type="date" class="form-control form-control-sm" value="' +
                _esc(existing && existing.dueDateUtc ? String(existing.dueDateUtc).slice(0, 10) : '') + '"></label>';

        _modal(existing ? 'Edit action' : 'New action', body, [
            {
                label: 'Save', cls: 'btn-primary', onClick: function (m) {
                    var text = m.querySelector('#rt-a-text').value.trim();
                    if (!text) return false;
                    var owner = m.querySelector('#rt-a-owner').value.trim();
                    var due = m.querySelector('#rt-a-due').value || null;
                    if (existing) RetroNet.updateAction(existing.id, text, owner, due, null);
                    else RetroNet.addAction(text, owner, due, sourceNoteId ? [sourceNoteId] : null);
                }
            }
        ]);
    }

    // Jira credentials are typed per push and never stored: the retro board is shared state
    // and an API token parked in it would be readable by the whole room.
    function _jiraFields() {
        var saved = {};
        try { saved = JSON.parse(localStorage.getItem('es_jira_hint') || '{}') || {}; } catch (e) {}
        return '<label class="f11-field"><span>Jira domain</span><input id="rt-j-domain" class="form-control form-control-sm" placeholder="yourteam.atlassian.net" value="' + _esc(saved.domain || '') + '"></label>' +
            '<label class="f11-field"><span>Email</span><input id="rt-j-email" class="form-control form-control-sm" value="' + _esc(saved.email || '') + '"></label>' +
            '<label class="f11-field"><span>API token</span><input id="rt-j-token" type="password" class="form-control form-control-sm" autocomplete="off"></label>';
    }

    function _rememberJiraHint(m) {
        try {
            localStorage.setItem('es_jira_hint', JSON.stringify({
                domain: m.querySelector('#rt-j-domain').value.trim(),
                email: m.querySelector('#rt-j-email').value.trim()
            }));
        } catch (e) {}
    }

    function _openJiraDialog(actionId) {
        var body = _jiraFields() +
            '<label class="f11-field"><span>Project key</span><input id="rt-j-proj" class="form-control form-control-sm" placeholder="ABC"></label>' +
            '<label class="f11-field"><span>Issue type</span><input id="rt-j-type" class="form-control form-control-sm" value="Task"></label>' +
            '<div class="f11-hint">The token is used for this one request and is not stored.</div>';
        _modal('Push action to Jira', body, [
            {
                label: 'Create issue', cls: 'btn-primary', onClick: function (m) {
                    _rememberJiraHint(m);
                    RetroNet.pushActionToJira(
                        m.querySelector('#rt-j-domain').value.trim(),
                        m.querySelector('#rt-j-email').value.trim(),
                        m.querySelector('#rt-j-token').value,
                        m.querySelector('#rt-j-proj').value.trim(),
                        m.querySelector('#rt-j-type').value.trim() || 'Task',
                        actionId);
                }
            }
        ]);
    }

    function _openSprintDialog() {
        var body = _jiraFields() +
            '<label class="f11-field"><span>Sprint id</span><input id="rt-j-sprint" class="form-control form-control-sm" placeholder="1234"></label>' +
            '<label class="f11-field"><span>Story points field</span><input id="rt-j-pts" class="form-control form-control-sm" placeholder="customfield_10016"></label>' +
            '<div class="f11-hint">Pulls the sprint’s issues and cross-references them against what this room estimated.</div>';
        _modal('Load sprint from Jira', body, [
            {
                label: 'Load', cls: 'btn-primary', onClick: function (m) {
                    _rememberJiraHint(m);
                    RetroNet.fetchSprint(
                        m.querySelector('#rt-j-domain').value.trim(),
                        m.querySelector('#rt-j-email').value.trim(),
                        m.querySelector('#rt-j-token').value,
                        m.querySelector('#rt-j-sprint').value.trim(),
                        m.querySelector('#rt-j-pts').value.trim() || null);
                }
            }
        ]);
    }

    // ---- start form --------------------------------------------------------------------

    var FORMAT_LABELS = {
        'default': '✅ Went well / ⚠️ Didn’t / ❓ Questions / 🔄 Try next',
        'start-stop-continue': 'Start / Stop / Continue',
        'mad-sad-glad': 'Mad / Sad / Glad',
        '4ls': 'Liked / Learned / Lacked / Longed for',
        'sailboat': 'Sailboat',
        'starfish': 'Starfish'
    };

    function _renderStart() {
        if (!_startEl) return;
        var show = !_b;
        _startEl.style.display = show ? '' : 'none';
        if (!show) return;

        if (!_isHost()) {
            _startEl.innerHTML = '<div class="retro-empty">No retro board is open. The host can start one.</div>' +
                (_archive.length ? '<div class="retro-empty">Past boards are listed on the right.</div>' : '');
            return;
        }

        var lim = _limits.votesPerPerson || { min: 1, max: 10 };
        _startEl.innerHTML =
            '<div class="retro-start">' +
            '<h5>Start a retro</h5>' +
            '<label class="f11-field"><span>Title</span><input id="rt-s-title" class="form-control form-control-sm" placeholder="Sprint 42 retro"></label>' +
            '<label class="f11-field"><span>Sprint name</span><input id="rt-s-sprint" class="form-control form-control-sm"></label>' +
            '<label class="f11-field"><span>Sprint goal</span><input id="rt-s-goal" class="form-control form-control-sm"></label>' +
            '<label class="f11-field"><span>Format</span><select id="rt-s-format" class="form-select form-select-sm">' +
                _formats.map(function (f) {
                    return '<option value="' + _esc(f) + '">' + _esc(FORMAT_LABELS[f] || f) + '</option>';
                }).join('') + '</select></label>' +
            '<label class="f11-field"><span>Dots per person</span><input id="rt-s-votes" type="number" class="form-control form-control-sm" ' +
                'min="' + lim.min + '" max="' + lim.max + '" value="3"></label>' +
            '<label class="f11-check"><input id="rt-s-anon" type="checkbox"> <span>Anonymous notes ' +
                '<small>(fixed for the life of the board)</small></span></label>' +
            '<button class="btn btn-primary" id="rt-s-go">🔁 Start retro</button>' +
            '</div>';

        _startEl.querySelector('#rt-s-go').addEventListener('click', function () {
            RetroNet.start(
                _startEl.querySelector('#rt-s-title').value.trim(),
                _startEl.querySelector('#rt-s-sprint').value.trim(),
                _startEl.querySelector('#rt-s-goal').value.trim(),
                _startEl.querySelector('#rt-s-format').value,
                _startEl.querySelector('#rt-s-anon').checked,
                parseInt(_startEl.querySelector('#rt-s-votes').value, 10) || 3);
        });
    }

    // ---- export (R6) -------------------------------------------------------------------

    function exportMarkdown() {
        if (!_b) return;
        var lines = [];
        lines.push('# ' + (_b.title || 'Retro') + (_b.sprintName ? ' — ' + _b.sprintName : ''));
        if (_b.sprintGoal) lines.push('', '**Goal:** ' + _b.sprintGoal);
        var ctx = _sprintContext();
        if (ctx) {
            lines.push('', '**Sprint:** ' + (ctx.completedPoints || 0) + '/' + (ctx.committedPoints || 0) +
                ' points completed, ' + (ctx.carriedOver || 0) + ' carried over.');
        }
        (_b.columns || []).slice().sort(function (a, b) { return a.order - b.order; }).forEach(function (c) {
            lines.push('', '## ' + (c.emoji ? c.emoji + ' ' : '') + c.label);
            var notes = _notesFor(c.key);
            if (!notes.length) { lines.push('', '_nothing raised_'); return; }
            lines.push('');
            notes.slice().sort(function (a, b) { return (b.votes || 0) - (a.votes || 0); }).forEach(function (n) {
                lines.push('- ' + (n.text || '') +
                    (n.votes ? ' _(' + n.votes + (n.votes === 1 ? ' dot)_' : ' dots)_') : '') +
                    (n.author ? ' — ' + n.author : ''));
            });
        });
        var actions = _b.actions || [];
        lines.push('', '## ✅ Actions', '');
        if (!actions.length) lines.push('_none agreed_');
        actions.forEach(function (a) {
            lines.push('- [' + (a.status === 'done' ? 'x' : ' ') + '] ' + a.text +
                (a.owner ? ' — **' + a.owner + '**' : '') +
                (a.dueDateUtc ? ' (due ' + String(a.dueDateUtc).slice(0, 10) + ')' : '') +
                (a.jiraKey ? ' [' + a.jiraKey + '](' + (a.jiraUrl || '') + ')' : '') +
                (a.carryCount ? ' _(carried ×' + a.carryCount + ')_' : ''));
        });
        lines.push('');

        try {
            var blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
            var url = URL.createObjectURL(blob);
            var link = document.createElement('a');
            link.href = url;
            link.download = 'retro_' + (_b.sprintName || _b.title || 'board').replace(/[^\w.-]+/g, '_') + '.md';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
        } catch (e) {
            console.error('Retro export failed', e);
        }
    }

    // ---- shell -------------------------------------------------------------------------

    function _render() {
        _renderStart();
        if (_mainEl) _mainEl.style.display = _b ? '' : 'none';
        _renderHeader();
        _renderSprint();
        _renderBoard();
        _renderSide();
    }

    function _build() {
        if (_built) return;
        _built = true;

        _root = document.createElement('div');
        _root.id = 'retro-overlay';
        _root.style.cssText = 'position:fixed;inset:0;z-index:2000;display:none;' +
            'background:rgba(15,18,28,0.6);backdrop-filter:blur(2px);align-items:center;justify-content:center;';

        var panel = document.createElement('div');
        panel.className = 'retro-panel';
        panel.style.cssText = 'background:#fff;border-radius:14px;box-shadow:0 18px 50px rgba(0,0,0,0.4);' +
            'width:min(98vw,1240px);height:min(94vh,900px);display:flex;flex-direction:column;overflow:hidden;';

        var bar = document.createElement('div');
        bar.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px 14px;border-bottom:1px solid #e5e7eb;';
        bar.innerHTML = '<div style="font-weight:700;flex:1;">🔁 Retro</div>' +
            '<button type="button" class="btn btn-sm btn-secondary" id="rt-close">✕ Close</button>';
        panel.appendChild(bar);

        _startEl = document.createElement('div');
        _startEl.className = 'retro-startwrap';
        _startEl.style.cssText = 'padding:16px;overflow-y:auto;';
        panel.appendChild(_startEl);

        _mainEl = document.createElement('div');
        _mainEl.style.cssText = 'flex:1;display:flex;flex-direction:column;min-height:0;';

        _headerEl = document.createElement('div');
        _headerEl.className = 'retro-header';
        _mainEl.appendChild(_headerEl);

        _sprintEl = document.createElement('div');
        _sprintEl.className = 'retro-sprint';
        _sprintEl.style.display = 'none';
        _mainEl.appendChild(_sprintEl);

        var split = document.createElement('div');
        split.className = 'retro-split';
        split.style.cssText = 'flex:1;display:flex;min-height:0;';

        _boardEl = document.createElement('div');
        _boardEl.className = 'retro-board';
        _boardEl.style.cssText = 'flex:1;display:grid;gap:10px;padding:12px;overflow:auto;min-width:0;';
        split.appendChild(_boardEl);

        _sideEl = document.createElement('div');
        _sideEl.className = 'retro-side';
        _sideEl.style.cssText = 'width:280px;flex:0 0 280px;border-left:1px solid #e5e7eb;padding:12px;overflow-y:auto;';
        split.appendChild(_sideEl);

        _mainEl.appendChild(split);
        panel.appendChild(_mainEl);

        _root.appendChild(panel);
        document.body.appendChild(_root);

        bar.querySelector('#rt-close').addEventListener('click', close);
        _root.addEventListener('pointerdown', function (e) { if (e.target === _root) close(); });
    }

    function open() { _build(); _render(); _root.style.display = 'flex'; }
    function close() { if (_root) _root.style.display = 'none'; }
    function _isOpen() { return _root && _root.style.display === 'flex'; }

    // ---- incoming ----------------------------------------------------------------------

    function onUpdated(board, archive) {
        // The server sends `{}` for "no active board" rather than null on some paths.
        _b = (board && board.id) ? board : null;
        if (archive) _archive = archive;
        if (_isOpen()) _render();
    }

    function onPhaseChanged(phase) {
        if (!_b) return;
        _b.phase = phase;
        if (_isOpen()) _render();
        // A full RetroUpdated always follows (the visibility rules change with the phase),
        // so this is only to keep the stepper honest in the gap between the two.
    }

    function onNoteMoved(delta) {
        if (!_b || !delta) return;
        var n = (_b.notes || []).filter(function (x) { return x.id === delta.id; })[0];
        if (!n) return;
        if (delta.columnKey) n.columnKey = delta.columnKey;
        n.x = delta.x; n.y = delta.y;
        if (_isOpen() && !_editingNoteId) _renderBoard();
    }

    function onJiraResult(actionId, ok, message, key, url) {
        if (ok && _b) {
            var a = (_b.actions || []).filter(function (x) { return x.id === actionId; })[0];
            if (a) { a.jiraKey = key; a.jiraUrl = url; }
            if (_isOpen()) _renderSide();
        }
        if (typeof window._showToastAD === 'function') {
            window._showToastAD((ok ? '✅ ' : '❌ ') + (message || (ok ? 'Issue created' : 'Jira push failed')), ok ? 'success' : 'danger');
        }
    }

    function loadState(state) {
        state = state || {};
        _b = (state.retro && state.retro.id) ? state.retro : null;
        _archive = state.retroArchive || [];
        if (state.retroFormats && state.retroFormats.length) _formats = state.retroFormats;
        if (state.retroLimits) _limits = state.retroLimits;
        if (_isOpen()) _render();
    }

    window.Retro = {
        open: open, close: close, onUpdated: onUpdated, onPhaseChanged: onPhaseChanged,
        onNoteMoved: onNoteMoved, onJiraResult: onJiraResult, loadState: loadState,
        exportMarkdown: exportMarkdown
    };
}());
