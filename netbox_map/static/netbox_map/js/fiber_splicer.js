(function () {
    'use strict';

    /* ── Industry-standard tube colors (TIA-598) ──────────── */
    var TUBE_COLORS = [
        '#2196F3', '#FF9800', '#4CAF50', '#F5F5F5', '#9C27B0', '#FF5722',
        '#FFEB3B', '#795548', '#9E9E9E', '#E91E63', '#00BCD4', '#8BC34A',
    ];
    var FIBER_COLORS = [
        '#2196F3', '#FF9800', '#4CAF50', '#F5F5F5', '#9C27B0', '#FF5722',
        '#FFEB3B', '#795548', '#9E9E9E', '#E91E63', '#00BCD4', '#8BC34A',
    ];

    /* ── Parse data ────────────────────────────────────────── */
    var container = document.getElementById('splicer-container');
    if (!container) return;

    var trays = JSON.parse(container.getAttribute('data-trays') || '[]');
    var splices = JSON.parse(container.getAttribute('data-splices') || '[]');
    var fiberLabelsData = JSON.parse(container.getAttribute('data-fiber-labels') || '{}');
    var canEdit = container.getAttribute('data-can-edit') === 'true';
    var csrfToken = container.getAttribute('data-csrf-token') || '';
    var deviceId = container.getAttribute('data-device-id') || '';
    var spliceApiUrl = container.getAttribute('data-splice-api-url') || '/api/plugins/map/fiber-splices/';
    var trayLabelApiUrl = container.getAttribute('data-tray-label-api-url') || '/api/plugins/map/tray-labels/';
    var fiberLabelApiUrl = container.getAttribute('data-fiber-label-api-url') || '/api/plugins/map/fiber-labels/';

    var editMode = false;
    var svg = document.getElementById('splicer-svg');
    var statsEl = document.getElementById('splicer-stats');
    var leftList = document.getElementById('left-tray-list');
    var rightList = document.getElementById('right-tray-list');

    // State
    var leftTrays = [];
    var rightTrays = [];
    var fiberElements = {};
    var spliceLines = [];
    var dragState = null;
    var bulkLeft = null;
    var bulkRight = null;

    /* ── API helper ────────────────────────────────────────── */
    function apiRequest(url, method, body) {
        var headers = {
            'X-CSRFToken': csrfToken,
            'Accept': 'application/json',
        };
        if (method !== 'GET') headers['Content-Type'] = 'application/json';
        var opts = { method: method, headers: headers };
        if (body) opts.body = JSON.stringify(body);
        return fetch(url, opts).then(function (r) {
            if (!r.ok) {
                return r.text().then(function (t) { throw new Error('API ' + r.status + ': ' + t.substring(0, 200)); });
            }
            if (r.status === 204) return null;
            return r.json();
        });
    }

    /* ── Assign trays to left/right sides ──────────────────── */
    function assignTraySides() {
        // Smart side assignment based on existing splices.
        // Build a graph of which trays are connected, then assign sides
        // so connected trays are on opposite sides when possible.
        var trayIdToIdx = {};
        trays.forEach(function (t, i) { trayIdToIdx[t.id] = i; });

        // Build adjacency: which tray indices are spliced together
        var adj = {};
        splices.forEach(function (s) {
            var a = trayIdToIdx[s.port_a];
            var b = trayIdToIdx[s.port_b];
            if (a === undefined || b === undefined || a === b) return;
            if (!adj[a]) adj[a] = {};
            if (!adj[b]) adj[b] = {};
            adj[a][b] = true;
            adj[b][a] = true;
        });

        // Bipartite assignment via BFS
        var side = {}; // trayIdx -> 'L' or 'R'
        var visited = {};

        function bfs(start) {
            var queue = [start];
            side[start] = 'L';
            visited[start] = true;
            while (queue.length > 0) {
                var cur = queue.shift();
                var neighbors = adj[cur] || {};
                for (var n in neighbors) {
                    n = parseInt(n);
                    if (visited[n]) continue;
                    visited[n] = true;
                    side[n] = side[cur] === 'L' ? 'R' : 'L';
                    queue.push(n);
                }
            }
        }

        // Process connected components
        for (var i = 0; i < trays.length; i++) {
            if (!visited[i]) bfs(i);
        }

        // Fallback: unconnected trays split evenly
        leftTrays = [];
        rightTrays = [];
        for (var i = 0; i < trays.length; i++) {
            if (side[i] === 'R') rightTrays.push(i);
            else leftTrays.push(i);
        }

        // If all ended up on one side (no splices), split evenly
        if (leftTrays.length === 0 || rightTrays.length === 0) {
            var half = Math.ceil(trays.length / 2);
            leftTrays = [];
            rightTrays = [];
            for (var i = 0; i < trays.length; i++) {
                if (i < half) leftTrays.push(i);
                else rightTrays.push(i);
            }
        }
    }

    /* ── Get tube color ────────────────────────────────────── */
    function getTubeColor(trayIndex) {
        if (trays[trayIndex] && trays[trayIndex].color) return trays[trayIndex].color;
        return TUBE_COLORS[trayIndex % TUBE_COLORS.length];
    }

    /* ── Get fiber color ───────────────────────────────────── */
    function getFiberColor(trayId, position, trayIndex) {
        var labels = fiberLabelsData[String(trayId)];
        if (labels && labels[String(position)] && labels[String(position)].color) {
            return labels[String(position)].color;
        }
        return FIBER_COLORS[(position - 1) % FIBER_COLORS.length];
    }

    /* ── Get fiber label ───────────────────────────────────── */
    function getFiberLabel(trayId, position) {
        var labels = fiberLabelsData[String(trayId)];
        if (labels && labels[String(position)] && labels[String(position)].label) {
            return labels[String(position)].label;
        }
        return 'Fiber ' + position;
    }

    /* ── Get fiber label ID (for PATCH) ────────────────────── */
    function getFiberLabelId(trayId, position) {
        var labels = fiberLabelsData[String(trayId)];
        if (labels && labels[String(position)]) {
            return labels[String(position)].id;
        }
        return null;
    }

    /* ── Render tray panels ────────────────────────────────── */
    function renderTrayPanel(trayIndices, panelEl, side) {
        panelEl.innerHTML = '';
        trayIndices.forEach(function (trayIdx) {
            var tray = trays[trayIdx];
            var color = getTubeColor(trayIdx);
            var el = document.createElement('div');
            el.className = 'splicer-tray';
            el.setAttribute('data-tray-idx', trayIdx);

            // Header
            var header = document.createElement('div');
            header.className = 'splicer-tray-header';
            var cableInfo = tray.cable_label ? ' <span class="tray-cable-badge">' + escHtml(tray.cable_label) + '</span>' : '';
            header.innerHTML =
                '<span class="tray-color-dot" style="background:' + color + '"></span>' +
                '<span class="tray-name">' + escHtml(tray.label || tray.name) + '</span>' +
                cableInfo +
                '<span class="tray-count">' + tray.positions + 'F</span>' +
                '<i class="mdi mdi-chevron-right tray-expand-icon"></i>';

            // Edit tray label on double-click (in edit mode)
            if (editMode) {
                var editIcon = document.createElement('i');
                editIcon.className = 'mdi mdi-pencil tray-edit-icon';
                editIcon.title = 'Edit tray label & cable';
                editIcon.addEventListener('click', function (e) {
                    e.stopPropagation();
                    showTrayEditDialog(trayIdx);
                });
                header.insertBefore(editIcon, header.querySelector('.tray-expand-icon'));
            }

            header.addEventListener('click', function () {
                el.classList.toggle('expanded');
                updateSvg();
            });

            el.appendChild(header);

            // Fiber list
            var fiberList = document.createElement('div');
            fiberList.className = 'splicer-fiber-list';

            for (var pos = 1; pos <= tray.positions; pos++) {
                var key = side + '|' + trayIdx + '|' + pos;
                var isConnected = isFiberConnected(tray.id, pos);
                var fiberColor = getFiberColor(tray.id, pos, trayIdx);
                var fiberLbl = getFiberLabel(tray.id, pos);

                var fiberEl = document.createElement('div');
                fiberEl.className = 'splicer-fiber' + (editMode ? ' edit-mode' : '');
                fiberEl.setAttribute('data-key', key);

                var dot = document.createElement('span');
                dot.className = 'fiber-dot' + (isConnected ? ' connected' : '');
                dot.style.background = isConnected ? fiberColor : 'transparent';
                dot.style.borderColor = fiberColor;

                var label = document.createElement('span');
                label.className = 'fiber-label';
                label.textContent = fiberLbl;

                // Double-click to rename fiber (in edit mode)
                if (editMode) {
                    (function (tId, p, labelEl) {
                        labelEl.addEventListener('dblclick', function (e) {
                            e.stopPropagation();
                            startFiberLabelEdit(tId, p, labelEl);
                        });
                    })(tray.id, pos, label);
                }

                var status = document.createElement('span');
                status.className = 'fiber-status' + (isConnected ? ' spliced' : '');
                status.textContent = isConnected ? 'spliced' : '';

                fiberEl.appendChild(dot);
                fiberEl.appendChild(label);
                fiberEl.appendChild(status);

                // Store reference for SVG positioning
                fiberElements[key] = {
                    el: fiberEl,
                    dot: dot,
                    trayId: tray.id,
                    trayIdx: trayIdx,
                    position: pos,
                    side: side,
                };

                if (editMode) {
                    (function (k, ti, p, s) {
                        fiberEl.addEventListener('mousedown', function (e) {
                            if (e.target.tagName === 'INPUT') return;
                            e.preventDefault();
                            startDrag(s, ti, p, k);
                        });
                    })(key, trayIdx, pos, side);
                }

                fiberList.appendChild(fiberEl);
            }

            el.appendChild(fiberList);
            panelEl.appendChild(el);
        });
    }

    /* ── Inline fiber label editing ────────────────────────── */
    function startFiberLabelEdit(trayId, position, labelEl) {
        var currentText = labelEl.textContent;
        var input = document.createElement('input');
        input.type = 'text';
        input.className = 'fiber-label-input';
        input.value = currentText === ('Fiber ' + position) ? '' : currentText;
        input.placeholder = 'Fiber ' + position;

        labelEl.textContent = '';
        labelEl.appendChild(input);
        input.focus();
        input.select();

        function save() {
            var newLabel = input.value.trim();
            input.removeEventListener('blur', save);
            input.removeEventListener('keydown', onKey);

            if (!newLabel || newLabel === 'Fiber ' + position) {
                // Clear label — delete if exists
                var existingId = getFiberLabelId(trayId, position);
                if (existingId) {
                    apiRequest(fiberLabelApiUrl + existingId + '/', 'DELETE').then(function () {
                        var labels = fiberLabelsData[String(trayId)];
                        if (labels) delete labels[String(position)];
                        labelEl.textContent = 'Fiber ' + position;
                    }).catch(function (err) {
                        alert('Error: ' + err.message);
                        labelEl.textContent = currentText;
                    });
                } else {
                    labelEl.textContent = 'Fiber ' + position;
                }
            } else {
                // Create or update
                var existingId = getFiberLabelId(trayId, position);
                if (existingId) {
                    apiRequest(fiberLabelApiUrl + existingId + '/', 'PATCH', {
                        label: newLabel,
                    }).then(function (resp) {
                        fiberLabelsData[String(trayId)][String(position)].label = newLabel;
                        labelEl.textContent = newLabel;
                    }).catch(function (err) {
                        alert('Error: ' + err.message);
                        labelEl.textContent = currentText;
                    });
                } else {
                    apiRequest(fiberLabelApiUrl, 'POST', {
                        rear_port: trayId,
                        position: position,
                        label: newLabel,
                    }).then(function (resp) {
                        if (!fiberLabelsData[String(trayId)]) fiberLabelsData[String(trayId)] = {};
                        fiberLabelsData[String(trayId)][String(position)] = {
                            id: resp.id,
                            label: newLabel,
                            color: '',
                        };
                        labelEl.textContent = newLabel;
                    }).catch(function (err) {
                        alert('Error: ' + err.message);
                        labelEl.textContent = currentText;
                    });
                }
            }
        }

        function onKey(e) {
            if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
            if (e.key === 'Escape') { input.value = currentText; input.blur(); }
        }

        input.addEventListener('blur', save);
        input.addEventListener('keydown', onKey);
    }

    /* ── Tray edit dialog (label, cable, color) ───────────── */
    function showTrayEditDialog(trayIdx) {
        var tray = trays[trayIdx];

        // Remove any existing dialog
        var existing = document.getElementById('tray-edit-dialog');
        if (existing) existing.remove();

        var overlay = document.createElement('div');
        overlay.id = 'tray-edit-dialog';
        overlay.className = 'splicer-dialog-overlay';
        overlay.innerHTML =
            '<div class="splicer-dialog">' +
            '  <h4>Edit Tray: ' + escHtml(tray.name) + '</h4>' +
            '  <div class="splicer-dialog-field">' +
            '    <label>Tray Label</label>' +
            '    <input type="text" id="tray-edit-label" value="' + escAttr(tray.label || '') + '" placeholder="' + escAttr(tray.name) + '">' +
            '  </div>' +
            '  <div class="splicer-dialog-field">' +
            '    <label>Assigned Cable</label>' +
            '    <select id="tray-edit-cable" class="splicer-dialog-select">' +
            '      <option value="">— None —</option>' +
            '    </select>' +
            '    <div class="splicer-dialog-hint">Which cable\'s fibers are in this tray?</div>' +
            '  </div>' +
            '  <div class="splicer-dialog-field">' +
            '    <label>Buffer Tube Color</label>' +
            '    <input type="color" id="tray-edit-color" value="' + (tray.color || getTubeColor(trayIdx)) + '">' +
            '  </div>' +
            '  <div class="splicer-dialog-field">' +
            '    <label>Description</label>' +
            '    <input type="text" id="tray-edit-desc" value="' + escAttr(tray.description || '') + '" placeholder="e.g. Buffer tube from Site-B cable">' +
            '  </div>' +
            '  <div class="splicer-dialog-actions">' +
            '    <button class="btn btn-sm btn-primary" id="tray-edit-save">Save</button>' +
            '    <button class="btn btn-sm btn-outline-secondary" id="tray-edit-cancel">Cancel</button>' +
            '  </div>' +
            '</div>';

        document.body.appendChild(overlay);

        // Fetch cables and populate dropdown
        var cableSelect = document.getElementById('tray-edit-cable');
        apiRequest('/api/dcim/cables/?limit=200', 'GET').then(function (resp) {
            var cables = resp.results || [];
            cables.forEach(function (c) {
                var opt = document.createElement('option');
                opt.value = c.id;
                var label = c.label || ('Cable #' + c.id);
                // Add termination info
                var terms = [];
                if (c.a_terminations && c.a_terminations.length) {
                    terms.push(c.a_terminations.map(function(t) { return t.object ? (t.object.device ? t.object.device.display + '/' : '') + t.object.display : ''; }).join(', '));
                }
                if (c.b_terminations && c.b_terminations.length) {
                    terms.push(c.b_terminations.map(function(t) { return t.object ? (t.object.device ? t.object.device.display + '/' : '') + t.object.display : ''; }).join(', '));
                }
                if (terms.length) label += ' (' + terms.join(' \u2194 ') + ')';
                opt.textContent = label;
                if (tray.cable_id && tray.cable_id === c.id) opt.selected = true;
                cableSelect.appendChild(opt);
            });
        }).catch(function () {
            // Cable API might not be accessible, that's OK
        });

        overlay.addEventListener('click', function (e) {
            if (e.target === overlay) overlay.remove();
        });
        document.getElementById('tray-edit-cancel').addEventListener('click', function () {
            overlay.remove();
        });

        document.getElementById('tray-edit-save').addEventListener('click', function () {
            var newLabel = document.getElementById('tray-edit-label').value.trim();
            var newColor = document.getElementById('tray-edit-color').value;
            var newDesc = document.getElementById('tray-edit-desc').value.trim();
            var cableVal = document.getElementById('tray-edit-cable').value;
            var cableId = cableVal ? parseInt(cableVal) : null;

            var data = {
                rear_port: tray.id,
                label: newLabel,
                tube_color: newColor,
                description: newDesc,
                cable: cableId,
            };

            var trayLabelId = tray.tray_label_id;
            var req;
            if (trayLabelId) {
                req = apiRequest(trayLabelApiUrl + trayLabelId + '/', 'PATCH', data);
            } else {
                req = apiRequest(trayLabelApiUrl, 'POST', data);
            }

            req.then(function (resp) {
                tray.label = newLabel || tray.name;
                tray.color = newColor;
                tray.description = newDesc;
                tray.tray_label_id = resp.id;
                tray.cable_id = cableId;
                // Update cable label display
                var selectedOpt = cableSelect.selectedOptions[0];
                tray.cable_label = cableId ? (selectedOpt ? selectedOpt.textContent : 'Cable #' + cableId) : '';
                overlay.remove();
                renderAll();
            }).catch(function (err) {
                alert('Error saving tray: ' + err.message);
            });
        });
    }

    /* ── Check if a fiber is connected ─────────────────────── */
    function isFiberConnected(portId, position) {
        return splices.some(function (s) {
            return (s.port_a === portId && s.position_a === position) ||
                   (s.port_b === portId && s.position_b === position);
        });
    }

    /* ── Find the splice connecting two fibers ────────────── */
    function findSplice(portIdA, posA, portIdB, posB) {
        return splices.find(function (s) {
            return (s.port_a === portIdA && s.position_a === posA &&
                    s.port_b === portIdB && s.position_b === posB) ||
                   (s.port_a === portIdB && s.position_a === posB &&
                    s.port_b === portIdA && s.position_b === posA);
        });
    }

    /* ── SVG rendering ─────────────────────────────────────── */
    function updateSvg() {
        while (svg.firstChild) svg.removeChild(svg.firstChild);
        spliceLines = [];

        var svgRect = svg.getBoundingClientRect();
        if (svgRect.width === 0 || svgRect.height === 0) return;

        splices.forEach(function (s) {
            // Find both fibers on ANY side
            var keyA = findFiberKeyAnySide(s.port_a, s.position_a);
            var keyB = findFiberKeyAnySide(s.port_b, s.position_b);
            if (!keyA || !keyB) return;

            var infoA = fiberElements[keyA];
            var infoB = fiberElements[keyB];
            if (!infoA || !infoB) return;

            // Check both trays are expanded
            var trayElA = infoA.el.closest('.splicer-tray');
            var trayElB = infoB.el.closest('.splicer-tray');
            if (!trayElA || !trayElA.classList.contains('expanded')) return;
            if (!trayElB || !trayElB.classList.contains('expanded')) return;

            var rectA = infoA.dot.getBoundingClientRect();
            var rectB = infoB.dot.getBoundingClientRect();

            var sameSide = infoA.side === infoB.side;
            var x1, y1, x2, y2, d;

            if (!sameSide) {
                // Normal cross-panel connection (L to R)
                var leftInfo = infoA.side === 'L' ? infoA : infoB;
                var rightInfo = infoA.side === 'L' ? infoB : infoA;
                var leftRect = (leftInfo === infoA ? rectA : rectB);
                var rightRect = (rightInfo === infoA ? rectA : rectB);

                x1 = leftRect.right - svgRect.left;
                y1 = leftRect.top + leftRect.height / 2 - svgRect.top;
                x2 = rightRect.left - svgRect.left;
                y2 = rightRect.top + rightRect.height / 2 - svgRect.top;

                var cpx = (x2 - x1) * 0.4;
                d = 'M' + x1 + ',' + y1 + ' C' + (x1 + cpx) + ',' + y1 + ' ' + (x2 - cpx) + ',' + y2 + ' ' + x2 + ',' + y2;
            } else {
                // Same-side connection — draw a U-curve that goes out into the SVG area
                if (infoA.side === 'L') {
                    x1 = rectA.right - svgRect.left;
                    y1 = rectA.top + rectA.height / 2 - svgRect.top;
                    x2 = rectB.right - svgRect.left;
                    y2 = rectB.top + rectB.height / 2 - svgRect.top;
                    var bulge = Math.min(80, Math.abs(y2 - y1) * 0.6 + 30);
                    d = 'M' + x1 + ',' + y1 + ' C' + (x1 + bulge) + ',' + y1 + ' ' + (x2 + bulge) + ',' + y2 + ' ' + x2 + ',' + y2;
                } else {
                    x1 = rectA.left - svgRect.left;
                    y1 = rectA.top + rectA.height / 2 - svgRect.top;
                    x2 = rectB.left - svgRect.left;
                    y2 = rectB.top + rectB.height / 2 - svgRect.top;
                    var bulge = Math.min(80, Math.abs(y2 - y1) * 0.6 + 30);
                    d = 'M' + x1 + ',' + y1 + ' C' + (x1 - bulge) + ',' + y1 + ' ' + (x2 - bulge) + ',' + y2 + ' ' + x2 + ',' + y2;
                }
            }

            var fiberColor = getFiberColor(infoA.trayId, infoA.position, infoA.trayIdx);

            var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', d);
            path.setAttribute('class', 'splice-line');
            path.setAttribute('stroke', fiberColor);
            path.setAttribute('data-splice-id', s.id);

            path.addEventListener('mouseenter', function () { path.classList.add('highlight'); });
            path.addEventListener('mouseleave', function () { path.classList.remove('highlight'); });

            if (editMode) {
                path.addEventListener('contextmenu', function (e) {
                    e.preventDefault();
                    if (confirm('Remove this splice?')) {
                        deleteSplice(s.id);
                    }
                });
            }

            svg.appendChild(path);
            spliceLines.push({ line: path, splice: s });
        });
    }

    function findFiberKey(side, trayId, position) {
        for (var key in fiberElements) {
            var info = fiberElements[key];
            if (info.side === side && info.trayId === trayId && info.position === position) {
                return key;
            }
        }
        return null;
    }

    function findFiberKeyAnySide(trayId, position) {
        return findFiberKey('L', trayId, position) || findFiberKey('R', trayId, position);
    }

    /* ── Drag to splice ────────────────────────────────────── */
    function startDrag(side, trayIdx, position, key) {
        if (!editMode) return;

        var info = fiberElements[key];
        if (!info) return;

        info.dot.classList.add('drag-source');

        var svgRect = svg.getBoundingClientRect();
        var dotRect = info.dot.getBoundingClientRect();
        var startX = side === 'L' ? dotRect.right - svgRect.left : dotRect.left - svgRect.left;
        var startY = dotRect.top + dotRect.height / 2 - svgRect.top;

        var tempLine = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        tempLine.setAttribute('class', 'splice-line-temp');
        svg.appendChild(tempLine);

        dragState = {
            side: side,
            trayIdx: trayIdx,
            position: position,
            key: key,
            startX: startX,
            startY: startY,
            tempLine: tempLine,
        };

        function onMouseMove(e) {
            if (!dragState) return;
            var mx = e.clientX - svgRect.left;
            var my = e.clientY - svgRect.top;
            var cpx = Math.abs(mx - startX) * 0.4;
            tempLine.setAttribute('d',
                'M' + startX + ',' + startY +
                ' C' + (startX + (side === 'L' ? cpx : -cpx)) + ',' + startY +
                ' ' + (mx + (side === 'L' ? -cpx : cpx)) + ',' + my +
                ' ' + mx + ',' + my
            );
        }

        function onMouseUp(e) {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);

            if (dragState && dragState.tempLine) {
                svg.removeChild(dragState.tempLine);
            }

            info.dot.classList.remove('drag-source');

            var target = document.elementFromPoint(e.clientX, e.clientY);
            if (target) {
                var fiberEl = target.closest('.splicer-fiber');
                if (fiberEl) {
                    var targetKey = fiberEl.getAttribute('data-key');
                    var targetInfo = fiberElements[targetKey];
                    if (targetInfo && (targetInfo.trayId !== info.trayId || targetInfo.position !== info.position)) {
                        createSplice(info, targetInfo);
                    }
                }
            }

            dragState = null;
        }

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    }

    /* ── Create splice via API ─────────────────────────────── */
    function createSplice(fromInfo, toInfo) {
        var leftInfo = fromInfo.side === 'L' ? fromInfo : toInfo;
        var rightInfo = fromInfo.side === 'R' ? fromInfo : toInfo;

        var existing = findSplice(leftInfo.trayId, leftInfo.position, rightInfo.trayId, rightInfo.position);
        if (existing) return;

        apiRequest(spliceApiUrl, 'POST', {
            device: parseInt(deviceId),
            port_a: leftInfo.trayId,
            position_a: leftInfo.position,
            port_b: rightInfo.trayId,
            position_b: rightInfo.position,
        }).then(function (resp) {
            splices.push({
                id: resp.id,
                port_a: leftInfo.trayId,
                position_a: leftInfo.position,
                port_b: rightInfo.trayId,
                position_b: rightInfo.position,
            });
            renderAll();
        }).catch(function (err) {
            alert('Error creating splice: ' + err.message);
        });
    }

    /* ── Delete splice via API ─────────────────────────────── */
    function deleteSplice(spliceId) {
        apiRequest(spliceApiUrl + spliceId + '/', 'DELETE').then(function () {
            splices = splices.filter(function (s) { return s.id !== spliceId; });
            renderAll();
        }).catch(function (err) {
            alert('Error removing splice: ' + err.message);
        });
    }

    /* ── Bulk splice 1:1 ───────────────────────────────────── */
    function setupBulkSplice() {
        var btn = document.getElementById('bulk-splice-btn');
        if (!btn) return;

        btn.addEventListener('click', function () {
            if (bulkLeft === null) {
                alert('Double-click a tray on the left side first, then a tray on the right side, then click "Bulk Splice 1:1".');
                return;
            }
            if (bulkRight === null) {
                alert('Now double-click a tray on the right side.');
                return;
            }

            var leftTray = trays[bulkLeft];
            var rightTray = trays[bulkRight];
            var count = Math.min(leftTray.positions, rightTray.positions);

            if (!confirm('Splice ' + count + ' fibers 1:1 between "' + leftTray.name + '" and "' + rightTray.name + '"?')) {
                clearBulkSelection();
                return;
            }

            var i = 0;
            function nextSplice() {
                while (i < count) {
                    i++;
                    var existing = findSplice(leftTray.id, i, rightTray.id, i);
                    if (!existing) {
                        createBulkSplice(leftTray.id, i, rightTray.id, i).then(nextSplice).catch(function (err) {
                            alert('Bulk splice error: ' + err.message);
                            clearBulkSelection();
                            renderAll();
                        });
                        return;
                    }
                }
                clearBulkSelection();
                renderAll();
            }
            nextSplice();
        });
    }

    function createBulkSplice(portAId, posA, portBId, posB) {
        return apiRequest(spliceApiUrl, 'POST', {
            device: parseInt(deviceId),
            port_a: portAId,
            position_a: posA,
            port_b: portBId,
            position_b: posB,
        }).then(function (resp) {
            splices.push({
                id: resp.id,
                port_a: portAId,
                position_a: posA,
                port_b: portBId,
                position_b: posB,
            });
        });
    }

    function clearBulkSelection() {
        bulkLeft = null;
        bulkRight = null;
        document.querySelectorAll('.bulk-left, .bulk-right').forEach(function (el) {
            el.classList.remove('bulk-left', 'bulk-right');
        });
    }

    /* ── Tray header click for bulk selection ──────────────── */
    function setupTraySelection() {
        document.querySelectorAll('.splicer-tray-header').forEach(function (header) {
            header.addEventListener('dblclick', function (e) {
                if (!editMode) return;
                e.stopPropagation();

                var trayEl = header.closest('.splicer-tray');
                var trayIdx = parseInt(trayEl.getAttribute('data-tray-idx'));
                var side = trayEl.closest('.splicer-tray-panel--left') ? 'L' : 'R';

                if (side === 'L') {
                    document.querySelectorAll('.bulk-left').forEach(function (el) { el.classList.remove('bulk-left'); });
                    bulkLeft = trayIdx;
                    header.classList.add('bulk-left');
                } else {
                    document.querySelectorAll('.bulk-right').forEach(function (el) { el.classList.remove('bulk-right'); });
                    bulkRight = trayIdx;
                    header.classList.add('bulk-right');
                }
            });
        });
    }

    /* ── Edit mode toggle ──────────────────────────────────── */
    function setupEditToggle() {
        var btn = document.getElementById('edit-toggle-btn');
        if (!btn) return;

        btn.addEventListener('click', function () {
            editMode = !editMode;
            if (editMode) {
                btn.classList.remove('btn-outline-warning');
                btn.classList.add('btn-warning');
                btn.innerHTML = '<i class="mdi mdi-pencil"></i> Editing';
            } else {
                btn.classList.remove('btn-warning');
                btn.classList.add('btn-outline-warning');
                btn.innerHTML = '<i class="mdi mdi-pencil-lock-outline"></i> Edit Mode';
                clearBulkSelection();
            }
            renderAll();
        });
    }

    /* ── Stats ─────────────────────────────────────────────── */
    function updateStats() {
        if (!statsEl) return;
        var totalFibers = trays.reduce(function (sum, t) { return sum + t.positions; }, 0);
        var splicedCount = splices.length;
        statsEl.innerHTML =
            '<span class="stat-number">' + splicedCount + '</span> spliced' +
            ' &middot; <span class="stat-number">' + totalFibers + '</span> total fibers' +
            ' &middot; <span class="stat-number">' + trays.length + '</span> trays';
    }

    /* ── Expanded state tracking ──────────────────────────── */
    var expandedTrays = {};

    function saveExpandedState() {
        expandedTrays = {};
        document.querySelectorAll('.splicer-tray.expanded').forEach(function (el) {
            expandedTrays[el.getAttribute('data-tray-idx')] = true;
        });
    }

    function restoreExpandedState() {
        document.querySelectorAll('.splicer-tray').forEach(function (el) {
            if (expandedTrays[el.getAttribute('data-tray-idx')]) {
                el.classList.add('expanded');
            }
        });
    }

    /* ── Render all ────────────────────────────────────────── */
    function renderAll() {
        saveExpandedState();
        fiberElements = {};
        renderTrayPanel(leftTrays, leftList, 'L');
        renderTrayPanel(rightTrays, rightList, 'R');
        restoreExpandedState();
        setupTraySelection();
        updateStats();

        requestAnimationFrame(function () {
            updateSvg();
        });
    }

    /* ── Escape helpers ───────────────────────────────────── */
    function escHtml(s) {
        if (!s) return '';
        var div = document.createElement('div');
        div.textContent = String(s);
        return div.innerHTML;
    }

    function escAttr(s) {
        if (!s) return '';
        return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    /* ── Resize observer ──────────────────────────────────── */
    var resizeObserver = new ResizeObserver(function () {
        requestAnimationFrame(function () { updateSvg(); });
    });

    /* ── Init ──────────────────────────────────────────────── */
    function init() {
        assignTraySides();
        renderAll();
        setupEditToggle();
        setupBulkSplice();

        resizeObserver.observe(svg);

        document.querySelectorAll('.splicer-tray-panel').forEach(function (panel) {
            panel.addEventListener('scroll', function () {
                requestAnimationFrame(function () { updateSvg(); });
            });
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
