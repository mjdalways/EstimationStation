// ============================================================
// AQ5 — Shared collaborative whiteboard
// Freehand drawing on a fixed 1280×720 coordinate space (so strokes line up across
// every client regardless of screen size). Completed strokes are broadcast as deltas
// over SignalR; late joiners replay the full stroke list from RoomState.
// ============================================================
(function () {
    var BOARD_W = 1280, BOARD_H = 720;

    var _root = null, _canvas = null, _ctx = null;
    var _items = [];             // every drawn item: stroke | rect | ellipse | line | text | note
    var _cur = null;             // in-progress item
    var _color = '#1f2937', _width = 4, _tool = 'pen';
    var _built = false;
    var _version = 0;            // bumped on any committed change (so the in-room board can refresh)
    var _board = null;           // white-bg composite canvas for texturing the in-room whiteboard
    function _bump() { _version++; }

    function _build() {
        if (_built) return;
        _built = true;

        _root = document.createElement('div');
        _root.id = 'wb-overlay';
        _root.style.cssText = 'position:fixed;inset:0;z-index:2000;display:none;' +
            'background:rgba(15,18,28,0.55);backdrop-filter:blur(2px);align-items:center;justify-content:center;';

        var panel = document.createElement('div');
        panel.style.cssText = 'background:#fff;border-radius:12px;box-shadow:0 12px 48px rgba(0,0,0,0.4);' +
            'width:min(94vw,1040px);max-height:94vh;display:flex;flex-direction:column;overflow:hidden;';

        // Toolbar
        var bar = document.createElement('div');
        bar.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:8px 12px;' +
            'border-bottom:1px solid #e5e7eb;font-size:0.82rem;';
        bar.innerHTML =
            '<strong style="margin-right:4px;">🖊️ Whiteboard</strong>' +
            '<input type="color" id="wb-color" value="#1f2937" title="Colour" style="width:34px;height:28px;padding:0;border:1px solid #ccc;border-radius:5px;cursor:pointer;">' +
            '<label style="display:flex;align-items:center;gap:4px;">Size <input type="range" id="wb-size" min="1" max="40" value="4" style="width:80px;"></label>' +
            '<div class="btn-group btn-group-sm" role="group" id="wb-tools">' +
              '<button data-tool="pen"     class="btn btn-primary"           title="Pen">✏️</button>' +
              '<button data-tool="eraser"  class="btn btn-outline-secondary" title="Eraser">🧽</button>' +
              '<button data-tool="line"    class="btn btn-outline-secondary" title="Line">╱</button>' +
              '<button data-tool="rect"    class="btn btn-outline-secondary" title="Rectangle">▭</button>' +
              '<button data-tool="ellipse" class="btn btn-outline-secondary" title="Ellipse">◯</button>' +
              '<button data-tool="text"    class="btn btn-outline-secondary" title="Text">🅣</button>' +
              '<button data-tool="note"    class="btn btn-outline-secondary" title="Sticky note">🗒️</button>' +
            '</div>' +
            '<span style="flex:1 1 auto;"></span>' +
            '<button id="wb-clear" class="btn btn-sm btn-outline-danger">🗑️ Clear</button>' +
            '<button id="wb-png"   class="btn btn-sm btn-outline-secondary">⬇️ PNG</button>' +
            '<button id="wb-close" class="btn btn-sm btn-secondary">✕ Close</button>';
        panel.appendChild(bar);

        // Canvas (fixed internal resolution, CSS-scaled, white background)
        var wrap = document.createElement('div');
        wrap.style.cssText = 'background:#f3f4f6;padding:10px;display:flex;justify-content:center;';
        _canvas = document.createElement('canvas');
        _canvas.width = BOARD_W; _canvas.height = BOARD_H;
        _canvas.style.cssText = 'background:#fff;border:1px solid #d1d5db;border-radius:6px;' +
            'width:100%;height:auto;touch-action:none;cursor:crosshair;max-height:78vh;';
        wrap.appendChild(_canvas);
        panel.appendChild(wrap);

        _root.appendChild(panel);
        document.body.appendChild(_root);
        _ctx = _canvas.getContext('2d');

        // Toolbar wiring
        bar.querySelector('#wb-color').addEventListener('input', function (e) { _color = e.target.value; if (_tool === 'eraser') _setTool('pen'); });
        bar.querySelector('#wb-size').addEventListener('input', function (e) { _width = parseInt(e.target.value, 10) || 4; });
        bar.querySelectorAll('#wb-tools button').forEach(function (b) {
            b.addEventListener('click', function () { _setTool(b.getAttribute('data-tool')); });
        });
        bar.querySelector('#wb-clear').addEventListener('click', _clearClick);
        bar.querySelector('#wb-png').addEventListener('click', _exportPng);
        bar.querySelector('#wb-close').addEventListener('click', close);
        _root.addEventListener('pointerdown', function (e) { if (e.target === _root) close(); });

        // Drawing
        _canvas.addEventListener('pointerdown', _down);
        _canvas.addEventListener('pointermove', _move);
        window.addEventListener('pointerup', _up);

        _redraw();
    }

    function _setTool(tool) {
        _tool = tool || 'pen';
        var grp = document.getElementById('wb-tools');
        if (grp) grp.querySelectorAll('button').forEach(function (b) {
            var on = b.getAttribute('data-tool') === _tool;
            b.className = 'btn ' + (on ? 'btn-primary' : 'btn-outline-secondary');
        });
        _canvas.style.cursor = (_tool === 'text' || _tool === 'note') ? 'text' : 'crosshair';
    }

    function _pt(e) {
        var r = _canvas.getBoundingClientRect();
        return [Math.round((e.clientX - r.left) / r.width * BOARD_W),
                Math.round((e.clientY - r.top)  / r.height * BOARD_H)];
    }

    // ── pointer flow ──────────────────────────────────────────
    function _down(e) {
        e.preventDefault();
        var p = _pt(e);
        if (_tool === 'pen' || _tool === 'eraser') {
            _cur = { t: 'stroke', color: _color, width: _width, erase: _tool === 'eraser', pts: [p] };
        } else if (_tool === 'line' || _tool === 'rect' || _tool === 'ellipse') {
            _cur = { t: _tool, color: _color, width: _width, x0: p[0], y0: p[1], x1: p[0], y1: p[1] };
        } else if (_tool === 'text') {
            var txt = window.prompt('Text:'); if (txt) _commit({ t: 'text', color: _color, size: Math.max(14, _width * 4), x: p[0], y: p[1], text: txt });
            _cur = null; return;
        } else if (_tool === 'note') {
            var note = window.prompt('Sticky note:'); if (note !== null) _commit({ t: 'note', x: p[0], y: p[1], w: 250, h: 160, color: '#fff7a8', text: note });
            _cur = null; return;
        }
        try { _canvas.setPointerCapture(e.pointerId); } catch (x) {}
    }
    function _move(e) {
        if (!_cur) return;
        var p = _pt(e);
        if (_cur.t === 'stroke') {
            _cur.pts.push(p);
            var n = _cur.pts.length; _segment(_cur, _cur.pts[n - 2], _cur.pts[n - 1]);
        } else {
            _cur.x1 = p[0]; _cur.y1 = p[1];
            _redraw(); _drawItem(_cur);   // live preview
        }
    }
    function _up() {
        if (!_cur) return;
        var s = _cur; _cur = null;
        if (s.t === 'stroke') {
            if (!s.pts.length) return;
            if (s.pts.length === 1) _drawItem(s);            // a dot
            _items.push(s); _broadcast(s); _bump();          // already drawn incrementally
        } else {
            _commit(s);
        }
    }

    // Push an item, redraw, and broadcast it.
    function _commit(item) {
        _items.push(item);
        _redraw();
        _broadcast(item);
        _bump();
    }
    function _broadcast(item) {
        if (window.WhiteboardNet && WhiteboardNet.draw) {
            try { WhiteboardNet.draw(JSON.stringify(item)); } catch (x) {}
        }
    }

    // ── rendering ─────────────────────────────────────────────
    function _stylize(s) {
        _ctx.globalCompositeOperation = s.erase ? 'destination-out' : 'source-over';
        _ctx.strokeStyle = s.color || '#1f2937'; _ctx.fillStyle = s.color || '#1f2937';
        _ctx.lineWidth = s.width || 2; _ctx.lineCap = 'round'; _ctx.lineJoin = 'round';
    }
    function _segment(s, a, b) {
        _stylize(s);
        _ctx.beginPath(); _ctx.moveTo(a[0], a[1]); _ctx.lineTo(b[0], b[1]); _ctx.stroke();
        _ctx.globalCompositeOperation = 'source-over';
    }
    function _drawItem(s) {
        if (!s) return;
        var t = s.t || 'stroke';
        if (t === 'stroke') {
            if (!s.pts || !s.pts.length) return;
            _stylize(s);
            if (s.pts.length === 1) {
                _ctx.beginPath(); _ctx.arc(s.pts[0][0], s.pts[0][1], Math.max(0.5, (s.width || 2) / 2), 0, Math.PI * 2); _ctx.fill();
            } else {
                _ctx.beginPath(); _ctx.moveTo(s.pts[0][0], s.pts[0][1]);
                for (var i = 1; i < s.pts.length; i++) _ctx.lineTo(s.pts[i][0], s.pts[i][1]);
                _ctx.stroke();
            }
            _ctx.globalCompositeOperation = 'source-over';
        } else if (t === 'line') {
            _stylize(s); _ctx.beginPath(); _ctx.moveTo(s.x0, s.y0); _ctx.lineTo(s.x1, s.y1); _ctx.stroke();
        } else if (t === 'rect') {
            _stylize(s); _ctx.strokeRect(Math.min(s.x0, s.x1), Math.min(s.y0, s.y1), Math.abs(s.x1 - s.x0), Math.abs(s.y1 - s.y0));
        } else if (t === 'ellipse') {
            _stylize(s);
            var cx = (s.x0 + s.x1) / 2, cy = (s.y0 + s.y1) / 2, rx = Math.abs(s.x1 - s.x0) / 2, ry = Math.abs(s.y1 - s.y0) / 2;
            _ctx.beginPath(); _ctx.ellipse(cx, cy, Math.max(1, rx), Math.max(1, ry), 0, 0, Math.PI * 2); _ctx.stroke();
        } else if (t === 'text') {
            _ctx.fillStyle = s.color || '#1f2937';
            _ctx.font = (s.size || 22) + 'px sans-serif'; _ctx.textBaseline = 'top';
            _ctx.fillText(s.text || '', s.x, s.y);
        } else if (t === 'note') {
            _drawNote(s);
        }
    }
    function _drawNote(s) {
        var x = s.x, y = s.y, w = s.w || 250, h = s.h || 160;
        _ctx.save();
        _ctx.shadowColor = 'rgba(0,0,0,0.18)'; _ctx.shadowBlur = 8; _ctx.shadowOffsetY = 3;
        _ctx.fillStyle = s.color || '#fff7a8';
        _ctx.fillRect(x, y, w, h);
        _ctx.restore();
        _ctx.fillStyle = '#3a3320'; _ctx.font = '20px sans-serif'; _ctx.textBaseline = 'top';
        // naive word wrap
        var words = (s.text || '').split(/\s+/), line = '', ly = y + 12, maxW = w - 20;
        for (var i = 0; i < words.length; i++) {
            var test = line ? line + ' ' + words[i] : words[i];
            if (_ctx.measureText(test).width > maxW && line) { _ctx.fillText(line, x + 10, ly); line = words[i]; ly += 24; if (ly > y + h - 20) break; }
            else line = test;
        }
        if (line && ly <= y + h - 12) _ctx.fillText(line, x + 10, ly);
    }
    function _redraw() {
        if (!_ctx) return;
        _ctx.clearRect(0, 0, BOARD_W, BOARD_H);
        for (var i = 0; i < _items.length; i++) _drawItem(_items[i]);
    }

    function _clearClick() {
        if (!window.confirm('Clear the whiteboard for everyone?')) return;
        _items = []; _redraw(); _bump();
        if (window.WhiteboardNet && WhiteboardNet.clear) WhiteboardNet.clear();
    }

    function _exportPng() {
        // Composite onto white (the live canvas is transparent so the eraser works).
        var tmp = document.createElement('canvas'); tmp.width = BOARD_W; tmp.height = BOARD_H;
        var t = tmp.getContext('2d');
        t.fillStyle = '#ffffff'; t.fillRect(0, 0, BOARD_W, BOARD_H);
        t.drawImage(_canvas, 0, 0);
        var a = document.createElement('a');
        a.download = 'whiteboard.png'; a.href = tmp.toDataURL('image/png');
        document.body.appendChild(a); a.click(); a.remove();
    }

    // ── Public API ────────────────────────────────────────────
    function open()  { _build(); _redraw(); _root.style.display = 'flex'; }
    function close() { if (_root) _root.style.display = 'none'; }

    // Incoming from SignalR (wired in room.js)
    function onStroke(json) {
        var s; try { s = JSON.parse(json); } catch (e) { return; }
        _items.push(s);
        if (_ctx) _drawItem(s);
        _bump();
    }
    function onClear() { _items = []; if (_ctx) _redraw(); _bump(); }
    function loadStrokes(arr) {
        _items = [];
        (arr || []).forEach(function (j) { try { _items.push(JSON.parse(j)); } catch (e) {} });
        if (_ctx) _redraw();
        _bump();
    }

    // For the in-room whiteboard: a white-background composite of the board, re-painted
    // on each call (the live canvas is transparent so the eraser works). RS3D textures a
    // board mesh with this and refreshes when getVersion() changes.
    function getBoardCanvas() {
        _build();
        if (!_board) { _board = document.createElement('canvas'); _board.width = BOARD_W; _board.height = BOARD_H; }
        var b = _board.getContext('2d');
        b.fillStyle = '#ffffff'; b.fillRect(0, 0, BOARD_W, BOARD_H);
        if (_canvas) b.drawImage(_canvas, 0, 0);
        return _board;
    }
    function getVersion() { return _version; }
    function ensureBuilt() { _build(); }

    window.Whiteboard = {
        open: open, close: close, onStroke: onStroke, onClear: onClear, loadStrokes: loadStrokes,
        getBoardCanvas: getBoardCanvas, getVersion: getVersion, ensureBuilt: ensureBuilt
    };
}());
