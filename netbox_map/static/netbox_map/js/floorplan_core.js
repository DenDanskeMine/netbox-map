/**
 * FloorplanApp Core — EventBus, State, API client, and shared utilities.
 * Must be loaded before all other floorplan_*.js modules.
 */
window.FloorplanApp = (function() {
    'use strict';

    // ─── EventBus ────────────────────────────────────────────────
    function EventBus() {
        this._listeners = {};
    }
    EventBus.prototype.on = function(event, fn) {
        if (!this._listeners[event]) this._listeners[event] = [];
        this._listeners[event].push(fn);
    };
    EventBus.prototype.off = function(event, fn) {
        var list = this._listeners[event];
        if (!list) return;
        this._listeners[event] = list.filter(function(f) { return f !== fn; });
    };
    EventBus.prototype.emit = function(event, data) {
        var list = this._listeners[event];
        if (!list) return;
        for (var i = 0; i < list.length; i++) {
            try { list[i](data); } catch (e) { console.error('EventBus error on "' + event + '":', e); }
        }
    };

    // ─── History (undo/redo) ───────────────────────────────────────
    // Plain command-pattern stack: each entry is {undo, redo} — a pair of
    // functions that already close over whatever they need (tile refs, old/
    // new values) to reverse or reapply one editor action. Callers push an
    // entry right after an action's API call succeeds; push() clears the
    // redo stack, matching standard undo/redo semantics (a fresh action
    // invalidates any "future" you could have redone into).
    //
    // Only covers actions with a clear before/after PATCH-able state:
    // create, delete, move, resize, rotate, paste. Panel-driven changes
    // (link object, FOV, label, port assignments) aren't recorded here yet.
    var HISTORY_MAX = 50;

    function History(events) {
        this.events = events;
        this.undoStack = [];
        this.redoStack = [];
    }
    History.prototype.push = function(action) {
        this.undoStack.push(action);
        if (this.undoStack.length > HISTORY_MAX) this.undoStack.shift();
        this.redoStack.length = 0;
        if (this.events) this.events.emit('history:change');
    };
    History.prototype.undo = function() {
        var action = this.undoStack.pop();
        if (!action) return false;
        action.undo();
        this.redoStack.push(action);
        if (this.events) this.events.emit('history:change');
        return true;
    };
    History.prototype.redo = function() {
        var action = this.redoStack.pop();
        if (!action) return false;
        action.redo();
        this.undoStack.push(action);
        if (this.events) this.events.emit('history:change');
        return true;
    };

    // ─── State ───────────────────────────────────────────────────
    function State(config, tiles, events) {
        this.events = events;
        this.tiles = tiles || [];
        this.config = config;

        // View state
        this.zoom = 1;
        this.panX = 0;
        this.panY = 0;
        this.MIN_ZOOM = 0.15;
        this.MAX_ZOOM = 5;

        // Selection
        this.selectedTile = null;

        // Grid
        this.gridWidth = config.gridWidth;
        this.gridHeight = config.gridHeight;
        this.tileSize = config.tileSize;
        this.worldWidth = config.gridWidth * config.tileSize;
        this.worldHeight = config.gridHeight * config.tileSize;
        // Largest a tile's width/height (in grid cells) can be — mirrors
        // FloorPlanTile.width/height's MaxValueValidator server-side (see
        // TILE_MAX_SIZE in models.py, the actual source of truth). Passed
        // through so the create/resize forms and mouse-driven resize all
        // enforce the same limit instead of guessing a duplicated constant.
        this.tileMaxSize = config.tileMaxSize;
        // Purely architectural tile types (wall, aisle, ...) that can never
        // carry an assigned object — mirrors STRUCTURAL_TILE_TYPES in
        // choices.py, the source of truth (also enforced server-side in
        // FloorPlanTile.clean()). Used to hide the "Link Object" panel for
        // these types instead of offering a link that the API would reject.
        this.structuralTileTypes = new Set(config.structuralTileTypes || []);

        // Type configuration (from server — includes custom types)
        this.typeConfigs = config.typeConfigs || [];
        this.typeColorMap = {};
        this.typeNameMap = {};
        // Explicit per-type icon/text foreground from CustomMarkerType.icon_foreground.
        // Values: 'light' | 'dark' | 'auto' (or undefined → auto contrast).
        this.typeIconFgMap = {};
        this.allTypes = [];
        for (var i = 0; i < this.typeConfigs.length; i++) {
            var tc = this.typeConfigs[i];
            this.allTypes.push(tc.slug);
            this.typeColorMap[tc.slug] = tc.color;
            this.typeNameMap[tc.slug] = tc.name;
            if (tc.icon_fg) this.typeIconFgMap[tc.slug] = tc.icon_fg;
        }

        // Visibility toggles
        this.visibleTypes = new Set(this.allTypes);
        this.showFOV = true;

        // Mode
        this.editMode = config.editMode;

        // Popover config
        this.popoverConfig = config.popoverConfig || {};

        // Device-to-tile lookup (for "show on map" buttons)
        this.deviceTileMap = {};
        this._buildDeviceTileMap();

        // URLs
        this.detailBaseUrl = config.detailBaseUrl;
        this.apiUrl = config.apiUrl;
        this.backgroundImageUrl = config.backgroundImageUrl;
        this.floorplanId = config.floorplanId;
        this.siteId = config.siteId;
        this.csrfToken = config.csrfToken;
    }

    State.prototype._buildDeviceTileMap = function() {
        this.deviceTileMap = {};
        for (var i = 0; i < this.tiles.length; i++) {
            var t = this.tiles[i];
            if (t.object_type_model === 'device' && t.object_id) {
                this.deviceTileMap[t.object_id] = t;
            }
        }
    };

    State.prototype.selectTile = function(tile) {
        var prev = this.selectedTile;
        this.selectedTile = tile;
        if (prev) this.events.emit('tile:deselect', prev);
        if (tile) this.events.emit('tile:select', tile);
    };

    State.prototype.deselectTile = function() {
        var prev = this.selectedTile;
        this.selectedTile = null;
        if (prev) this.events.emit('tile:deselect', prev);
    };

    State.prototype.updateTile = function(tile, changes) {
        for (var key in changes) {
            if (changes.hasOwnProperty(key)) {
                tile[key] = changes[key];
            }
        }
        this.events.emit('tile:update', tile);
    };

    State.prototype.addTile = function(tile) {
        this.tiles.push(tile);
        this._buildDeviceTileMap();
        this.events.emit('tile:create', tile);
    };

    State.prototype.removeTile = function(tileId) {
        var removed = null;
        for (var i = 0; i < this.tiles.length; i++) {
            if (this.tiles[i].id === tileId) {
                removed = this.tiles.splice(i, 1)[0];
                break;
            }
        }
        if (removed) {
            if (this.selectedTile && this.selectedTile.id === tileId) {
                this.deselectTile();
            }
            this._buildDeviceTileMap();
            this.events.emit('tile:delete', removed);
        }
    };

    State.prototype.findTileById = function(id) {
        for (var i = 0; i < this.tiles.length; i++) {
            if (this.tiles[i].id === id) return this.tiles[i];
        }
        return null;
    };

    State.prototype.toggleType = function(slug) {
        if (this.visibleTypes.has(slug)) {
            this.visibleTypes.delete(slug);
        } else {
            this.visibleTypes.add(slug);
        }
        // Deselect if selected tile's type is now hidden
        if (this.selectedTile && !this.visibleTypes.has(this.selectedTile.type)) {
            this.deselectTile();
        }
        this.events.emit('type:toggle', slug);
    };

    State.prototype.toggleFOV = function() {
        this.showFOV = !this.showFOV;
        this.events.emit('render');
    };

    // ─── API Client ──────────────────────────────────────────────
    function API(state) {
        this.csrfToken = state.csrfToken;
    }

    API.prototype._request = function(url, method, data) {
        var opts = {
            method: method,
            credentials: 'same-origin',
            headers: { 'X-CSRFToken': this.csrfToken }
        };
        if (data !== undefined) {
            opts.headers['Content-Type'] = 'application/json';
            opts.body = JSON.stringify(data);
        }
        return fetch(url, opts).then(function(r) {
            if (method === 'DELETE' && r.status === 204) return null;
            if (!r.ok) {
                return r.json().then(function(err) {
                    var e = new Error('API error: ' + r.status);
                    e.detail = err;
                    throw e;
                });
            }
            return r.json();
        });
    };

    API.prototype.get = function(url) { return this._request(url, 'GET'); };
    API.prototype.post = function(url, data) { return this._request(url, 'POST', data); };
    API.prototype.patch = function(url, data) { return this._request(url, 'PATCH', data); };
    API.prototype.del = function(url) { return this._request(url, 'DELETE'); };

    // ─── Utilities ───────────────────────────────────────────────

    function escapeHtml(str) {
        if (!str) return '';
        var div = document.createElement('div');
        div.appendChild(document.createTextNode(str));
        return div.innerHTML;
    }

    /** HSL-based utilization color: green (0%) → red (100%) → gray (null) */
    function getUtilizationColor(pct) {
        if (pct === null || pct === undefined) return '#2a2a3e';
        pct = Math.max(0, Math.min(100, pct));
        var hue = 120 - (pct * 1.2);
        return 'hsl(' + hue + ', 70%, 45%)';
    }

    /** Lookup tile type color from config map */
    function getTileColor(slug, colorMap) {
        return colorMap[slug] || '#444';
    }

    /**
     * True if a gridX/gridY/width/height footprint overlaps any other tile
     * in state.tiles. Shared by the create/resize forms (floorplan_editor.js)
     * and mouse-driven move/resize (floorplan_interaction.js) so all of them
     * enforce the same rule.
     *
     * Deliberately does NOT exempt tiles whose type is currently toggled off
     * in the visibility filter — that toggle only controls what's drawn, not
     * what physically occupies the grid. Skipping hidden types here used to
     * let a resize or move silently overlap them with no warning at all.
     */
    function isPositionOccupied(state, gridX, gridY, newWidth, newHeight, excludeId) {
        for (var i = 0; i < state.tiles.length; i++) {
            var t = state.tiles[i];
            if (excludeId !== undefined && t.id === excludeId) continue;
            if (gridX < t.x + t.w && gridX + newWidth > t.x &&
                gridY < t.y + t.h && gridY + newHeight > t.y) {
                return true;
            }
        }
        return false;
    }

    // JS tile objects use short field names (x/y/w/h) that don't match the
    // API's (x_position/y_position/width/height). Everything that patches a
    // tile's spatial fields — the initial mouse action AND undo/redo
    // replaying it later — goes through this one translation + apply step
    // so the two can never drift out of sync with each other.
    var TILE_FIELD_API_NAMES = { x: 'x_position', y: 'y_position', w: 'width', h: 'height', orientation: 'orientation' };

    /**
     * PATCH a tile's x/y/w/h/orientation and, on success, update the local
     * tile object + emit 'tile:update'/'render' to match. `fields` uses the
     * short JS names (e.g. {x: 3, y: 4}). Returns the fetch promise.
     */
    function patchTileFields(state, events, tile, fields) {
        var apiData = {};
        for (var key in fields) {
            if (fields.hasOwnProperty(key)) apiData[TILE_FIELD_API_NAMES[key]] = fields[key];
        }
        var api = new API(state);
        return api.patch(state.apiUrl + tile.id + '/', apiData).then(function() {
            for (var k in fields) {
                if (fields.hasOwnProperty(k)) tile[k] = fields[k];
            }
            events.emit('tile:update', tile);
            events.emit('render');
        });
    }

    /**
     * Push an undo/redo history entry that PATCHes a tile's fields both ways.
     * Used by every mouse- and button-driven field edit (drag/resize/rotate)
     * so the undo/redo wiring can't drift between call sites.
     */
    function pushFieldHistory(state, events, tile, newFields, origFields) {
        state.history.push({
            undo: function() { patchTileFields(state, events, tile, origFields); },
            redo: function() { patchTileFields(state, events, tile, newFields); }
        });
    }

    /**
     * Push an undo/redo history entry for a tile that was just created via
     * App.createTileFromPayload. `holder.id` tracks the tile's CURRENT row
     * id across repeated undo/redo cycles — each redo re-creates the tile
     * as a genuinely new row, so a plain captured id would go stale after
     * one cycle.
     */
    function pushCreateHistory(state, holder, payload) {
        // window.FloorplanApp, not a local "App" — this module builds that
        // object and createTileFromPayload/deleteTileById are added to it
        // later by floorplan_editor.js, but only ever called long after
        // every module has finished loading.
        state.history.push({
            undo: function() { window.FloorplanApp.deleteTileById(holder.id); },
            redo: function() {
                window.FloorplanApp.createTileFromPayload(payload).then(function(t) { holder.id = t.id; });
            }
        });
    }

    /** Mirror of pushCreateHistory for a tile that was just deleted. */
    function pushDeleteHistory(state, holder, payload) {
        state.history.push({
            undo: function() {
                window.FloorplanApp.createTileFromPayload(payload).then(function(t) { holder.id = t.id; });
            },
            redo: function() { window.FloorplanApp.deleteTileById(holder.id); }
        });
    }

    /** Determine text color (white or dark) based on background luminance */
    function getTextColor(bgColor) {
        // Parse hex
        var hex = bgColor.replace('#', '');
        if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
        var r = parseInt(hex.substring(0,2), 16);
        var g = parseInt(hex.substring(2,4), 16);
        var b = parseInt(hex.substring(4,6), 16);
        // If we couldn't parse (e.g. hsl string), default to white
        if (isNaN(r)) return '#fff';
        var luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        return luminance > 0.5 ? '#1a1a2e' : '#fff';
    }

    /**
     * Calculate the largest font size (in px) for `text` to fit within
     * maxWidth x maxHeight on a 2d canvas context.
     * Returns { size, fits } — fits is false if text exceeds bounds even at minSize.
     */
    function autoFontSize(ctx, text, maxWidth, maxHeight, minSize, maxSize) {
        minSize = minSize || 8;
        maxSize = maxSize || 48;
        var lo = minSize, hi = Math.min(maxSize, maxHeight * 0.85);
        var best = lo;
        // Binary search for largest fitting size
        while (lo <= hi) {
            var mid = Math.floor((lo + hi) / 2);
            ctx.font = 'bold ' + mid + 'px sans-serif';
            var tw = ctx.measureText(text).width;
            if (tw <= maxWidth * 0.9) {
                best = mid;
                lo = mid + 1;
            } else {
                hi = mid - 1;
            }
        }
        ctx.font = 'bold ' + best + 'px sans-serif';
        var finalWidth = ctx.measureText(text).width;
        return { size: best, fits: finalWidth <= maxWidth * 0.9 };
    }

    /**
     * Truncate text with ellipsis to fit within maxWidth on a 2d canvas context.
     * Font must already be set on ctx.
     */
    function truncateText(ctx, text, maxWidth) {
        if (ctx.measureText(text).width <= maxWidth) return text;
        var ellipsis = '…';
        for (var i = text.length - 1; i > 0; i--) {
            var truncated = text.substring(0, i) + ellipsis;
            if (ctx.measureText(truncated).width <= maxWidth) return truncated;
        }
        return ellipsis;
    }

    // ─── Config Parser ───────────────────────────────────────────

    /** Parse all configuration from the floorplan container's data attributes */
    function parseConfig(container) {
        var typeConfigs = [];
        try { typeConfigs = JSON.parse(container.dataset.typeConfigs || '[]'); } catch(e) {}

        var defaultPopoverFields = ['label', 'object_info', 'primary_ip', 'utilization', 'position', 'size'];
        var popoverConfig = {};
        try {
            var pf = JSON.parse(container.dataset.popoverFields || '{}');
            if (Array.isArray(pf)) {
                popoverConfig = { 'default': pf.length > 0 ? pf : defaultPopoverFields };
            } else if (typeof pf === 'object' && pf !== null) {
                popoverConfig = pf;
            }
        } catch(e) {}
        if (!popoverConfig['default']) popoverConfig['default'] = defaultPopoverFields;

        return {
            gridWidth: parseInt(container.dataset.gridWidth, 10),
            gridHeight: parseInt(container.dataset.gridHeight, 10),
            tileSize: parseInt(container.dataset.tileSize, 10),
            tileMaxSize: parseInt(container.dataset.tileMaxSize, 10) || 10,
            structuralTileTypes: (function() {
                try { return JSON.parse(container.dataset.structuralTileTypes || '[]'); }
                catch (e) { return []; }
            })(),
            editMode: container.dataset.editMode === 'true',
            apiUrl: container.dataset.apiUrl || '',
            floorplanId: container.dataset.floorplanId || '',
            siteId: container.dataset.siteId || '',
            csrfToken: container.dataset.csrfToken || document.querySelector('[name=csrfmiddlewaretoken]')?.value || '',
            detailBaseUrl: container.dataset.detailBaseUrl || '/plugins/map/marker-detail/',
            backgroundImageUrl: container.dataset.backgroundImage || null,
            typeConfigs: typeConfigs,
            popoverConfig: popoverConfig,
        };
    }

    /** Parse tile data from container's data-tiles attribute */
    function parseTiles(container) {
        try { return JSON.parse(container.dataset.tiles || '[]'); } catch(e) { return []; }
    }

    // ─── Cable Trace Utilities ────────────────────────────────────

    /** Render a port type label for display. */
    function portTypeLabel(type) {
        switch (type) {
            case 'Interface': return 'Interface';
            case 'RearPort':
            case 'Rear Port':  return 'Rear Port';
            case 'FrontPort':
            case 'Front Port': return 'Front Port';
            case 'ConsolePort': return 'Console Port';
            case 'ConsoleServerPort': return 'Console Server Port';
            case 'PowerPort':  return 'Power Port';
            case 'PowerOutlet': return 'Power Outlet';
            default: return type || 'Port';
        }
    }

    /** Get MDI icon class for a port type. */
    function portTypeIcon(type) {
        switch (type) {
            case 'Interface':   return 'mdi-ethernet';
            case 'RearPort':
            case 'Rear Port':   return 'mdi-arrow-collapse-left';
            case 'FrontPort':
            case 'Front Port':  return 'mdi-arrow-collapse-right';
            default:            return 'mdi-connection';
        }
    }

    /**
     * Build a flat path array from trace hops for NetBox-style rendering.
     * Converts hop data into ordered sequence of: device, port, cable, port, device, ...
     */
    function buildTracePath(trace) {
        var path = [];
        var lastDeviceKey = null;

        for (var j = 0; j < trace.length; j++) {
            var hop = trace[j];

            if (hop.near_end) {
                var nearDev = hop.near_end.device || '';
                var nearDevKey = nearDev + '|' + (hop.near_end.device_url || '');
                if (j === 0) {
                    if (nearDev) {
                        path.push({kind: 'device', data: hop.near_end, role: 'source'});
                        lastDeviceKey = nearDevKey;
                    }
                } else if (nearDevKey !== lastDeviceKey && nearDev) {
                    path.push({kind: 'device', data: hop.near_end, role: 'middle'});
                    lastDeviceKey = nearDevKey;
                }
                path.push({kind: 'port', data: hop.near_end});
            }

            if (hop.cable) {
                path.push({kind: 'cable', data: hop.cable});
            }

            if (hop.far_end) {
                path.push({kind: 'port', data: hop.far_end});
                var farDev = hop.far_end.device || '';
                var farDevKey = farDev + '|' + (hop.far_end.device_url || '');
                if (farDevKey !== lastDeviceKey && farDev) {
                    var isLast = (j === trace.length - 1);
                    path.push({kind: 'device', data: hop.far_end, role: isLast ? 'endpoint' : 'middle'});
                    lastDeviceKey = farDevKey;
                }
            }
        }
        return path;
    }

    /**
     * Generate cable trace HTML for a list of interfaces.
     * @param {Array} interfaces - interface trace data from the API
     * @param {string} idPrefix - unique prefix for element IDs (e.g. 'main', 'rdt-42')
     * @param {Object} deviceTileMap - deviceId → tile lookup for "show on map" buttons
     * @returns {string} HTML string
     */
    function generateTraceHTML(interfaces, idPrefix, deviceTileMap) {
        if (!interfaces || interfaces.length === 0) return '';
        deviceTileMap = deviceTileMap || {};
        var html = '';

        for (var i = 0; i < interfaces.length; i++) {
            var iface = interfaces[i];
            html += '<div class="ct-interface" data-ct-idx="' + i + '">';
            html += '<div class="ct-interface-header" data-ct-toggle="' + idPrefix + '-' + i + '">';
            html += '<i class="mdi ' + portTypeIcon(iface.type) + ' ct-iface-icon"></i>';
            html += '<span class="ct-iface-name">' + escapeHtml(iface.name) + '</span>';
            html += '<span class="ct-iface-type">' + escapeHtml(iface.type) + '</span>';
            html += '<i class="mdi mdi-chevron-down ct-chevron"></i>';
            html += '</div>';

            if (iface.trace && iface.trace.length > 0) {
                var path = buildTracePath(iface.trace);
                html += '<div class="ct-trace-body" id="ct-body-' + idPrefix + '-' + i + '">';

                for (var p = 0; p < path.length; p++) {
                    var node = path[p];

                    if (node.kind === 'device') {
                        var roleClass = 'ct-dev-' + node.role;
                        html += '<div class="ct-device ' + roleClass + '">';
                        html += '<div class="ct-dev-name">';
                        if (node.data.device_url) {
                            html += '<a href="' + escapeHtml(node.data.device_url) + '">' + escapeHtml(node.data.device) + '</a>';
                        } else {
                            html += escapeHtml(node.data.device || node.data.name);
                        }
                        if (node.data.device_id && deviceTileMap[node.data.device_id]) {
                            html += '<span class="ct-dev-map-btn" data-tile-id="' + deviceTileMap[node.data.device_id].id + '" title="Show on map">';
                            html += '<i class="mdi mdi-map-marker"></i>';
                            html += '</span>';
                        }
                        html += '</div>';
                        var meta = [];
                        if (node.data.device_role) meta.push(escapeHtml(node.data.device_role));
                        if (node.data.device_type) meta.push(escapeHtml(node.data.device_type));
                        if (node.data.device_rack) {
                            if (node.data.device_rack_url) {
                                meta.push('<a href="' + escapeHtml(node.data.device_rack_url) + '">' + escapeHtml(node.data.device_rack) + '</a>');
                            } else {
                                meta.push(escapeHtml(node.data.device_rack));
                            }
                        }
                        if (node.data.device_site) meta.push(escapeHtml(node.data.device_site));
                        if (meta.length) {
                            html += '<div class="ct-dev-meta">' + meta.join(' &middot; ') + '</div>';
                        }
                        html += '</div>';

                    } else if (node.kind === 'port') {
                        html += '<div class="ct-port">';
                        html += '<i class="mdi ' + portTypeIcon(node.data.type) + ' ct-port-icon"></i>';
                        if (node.data.url) {
                            html += '<a href="' + escapeHtml(node.data.url) + '" class="ct-port-name">' + escapeHtml(node.data.name) + '</a>';
                        } else {
                            html += '<span class="ct-port-name">' + escapeHtml(node.data.name) + '</span>';
                        }
                        html += '<span class="ct-port-type">' + portTypeLabel(node.data.type) + '</span>';
                        html += '</div>';

                    } else if (node.kind === 'cable') {
                        html += '<div class="ct-cable">';
                        html += '<div class="ct-cable-line"></div>';
                        html += '<div class="ct-cable-label">';
                        html += '<a href="' + escapeHtml(node.data.url) + '">';
                        html += '<i class="mdi mdi-cable-data"></i> ' + escapeHtml(node.data.label);
                        html += '</a>';
                        var cableMeta = [];
                        if (node.data.type_display) cableMeta.push(escapeHtml(node.data.type_display));
                        if (node.data.length) {
                            var lenStr = node.data.length + (node.data.length_unit ? ' ' + escapeHtml(node.data.length_unit) : '');
                            cableMeta.push(lenStr);
                        }
                        if (node.data.status) {
                            var sColor = node.data.status_color || '';
                            var sStyle = sColor ? ' style="color:' + escapeHtml(sColor) + '"' : '';
                            cableMeta.push('<span class="ct-cable-status"' + sStyle + '>' + escapeHtml(node.data.status) + '</span>');
                        }
                        if (cableMeta.length) {
                            html += ' <span class="ct-cable-meta">' + cableMeta.join(' &middot; ') + '</span>';
                        }
                        html += '</div>';
                        html += '<div class="ct-cable-line"></div>';
                        html += '</div>';
                    }
                }

                html += '</div>'; // ct-trace-body
            }

            html += '</div>'; // ct-interface
        }
        return html;
    }

    /**
     * Attach expand/collapse click listeners to .ct-interface-header elements.
     * @param {Element} container - DOM element containing the trace HTML
     * @param {string} idPrefix - unused, kept for API compat
     * @param {boolean} startCollapsed - if true, auto-collapse all bodies
     */
    function attachTraceToggleListeners(container, idPrefix, startCollapsed) {
        var headers = container.querySelectorAll('.ct-interface-header');
        for (var h = 0; h < headers.length; h++) {
            headers[h].addEventListener('click', (function(hdr) {
                return function() {
                    var toggleId = hdr.getAttribute('data-ct-toggle');
                    var body = document.getElementById('ct-body-' + toggleId);
                    var ifaceEl = hdr.closest('.ct-interface');
                    if (body) {
                        var collapsed = body.classList.toggle('ct-collapsed');
                        ifaceEl.querySelector('.ct-chevron').classList.toggle('ct-chevron-collapsed', collapsed);
                    }
                };
            })(headers[h]));
        }
        if (startCollapsed) {
            for (var c = 0; c < headers.length; c++) {
                var toggleId = headers[c].getAttribute('data-ct-toggle');
                var b = document.getElementById('ct-body-' + toggleId);
                if (b) {
                    b.classList.add('ct-collapsed');
                    var ifaceEl = headers[c].closest('.ct-interface');
                    if (ifaceEl) {
                        var chevIcon = ifaceEl.querySelector('.ct-chevron');
                        if (chevIcon) chevIcon.classList.add('ct-chevron-collapsed');
                    }
                }
            }
        }
    }

    // ─── Public API ──────────────────────────────────────────────
    return {
        EventBus: EventBus,
        History: History,
        State: State,
        API: API,
        parseConfig: parseConfig,
        parseTiles: parseTiles,
        escapeHtml: escapeHtml,
        getUtilizationColor: getUtilizationColor,
        getTileColor: getTileColor,
        isPositionOccupied: isPositionOccupied,
        patchTileFields: patchTileFields,
        pushFieldHistory: pushFieldHistory,
        pushCreateHistory: pushCreateHistory,
        pushDeleteHistory: pushDeleteHistory,
        getTextColor: getTextColor,
        autoFontSize: autoFontSize,
        truncateText: truncateText,
        portTypeLabel: portTypeLabel,
        portTypeIcon: portTypeIcon,
        buildTracePath: buildTracePath,
        generateTraceHTML: generateTraceHTML,
        attachTraceToggleListeners: attachTraceToggleListeners,
    };
})();
