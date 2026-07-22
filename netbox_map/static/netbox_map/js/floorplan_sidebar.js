/**
 * FloorplanApp Sidebar — Tile list, search, type toggles, rack expansion, divider.
 * Depends on: floorplan_core.js
 */
(function(App) {
    'use strict';

    function Sidebar(state, events, interaction) {
        this.state = state;
        this.events = events;
        this.interaction = interaction;

        // DOM references
        this.tileListEl = document.getElementById('tile-list');
        this.tileSearchInput = document.getElementById('tile-search-input');
        this.tileCountEl = document.getElementById('tile-count');

        // Panel-swap DOM references
        this.panelList = document.getElementById('sidebar-panel-list');
        this.panelDetail = document.getElementById('sidebar-panel-detail');
        this.detailBackBtn = document.getElementById('sidebar-detail-back');

        // Rack device expansion
        this.rackDevicesMap = {};
        this.rackDevicesLoaded = false;
        this.expandedRacks = new Set();

        // Device trace expansion (inside racks)
        this.expandedDeviceTraces = new Set();
        this.deviceTraceCache = {};
        this.deviceTracePending = {};

        // Wire up events
        var self = this;
        events.on('tile:select', function() {
            self._highlightSelected();
            self.showDetailPanel();
        });
        events.on('tile:deselect', function() {
            self._highlightSelected();
            self.showListPanel();
        });
        events.on('tile:create', function() { self.build(); });
        events.on('tile:delete', function() { self.build(); });
        events.on('tile:update', function() { self.build(); });
        events.on('sidebar:rebuild', function() { self.build(); });
        events.on('ports:change', function() { self.build(); });
        events.on('type:toggle', function() { self.build(); });

        this._bindSearch();
        this._bindTypeToggles();
        this._bindFOVToggle();
        this._bindFloorplanSelector();
        this._bindBackButton();
        this._bindEscKey();
    }

    // ─── Public ───────────────────────────────────────────────────

    /** Build/rebuild the sidebar tile list from current state. */
    Sidebar.prototype.build = function() {
        if (!this.tileListEl) return;

        // Lazy-load rack devices on first call
        if (!this.rackDevicesLoaded) {
            var self = this;
            this._loadAllRackDevices(function() { self.build(); });
            return;
        }

        var s = this.state;
        var query = this.tileSearchInput ? this.tileSearchInput.value.toLowerCase().trim() : '';
        var self = this;

        var filtered = s.tiles.filter(function(t) {
            if (!s.visibleTypes.has(t.type)) return false;
            if (query) {
                var text = (t.label || '').toLowerCase() + ' ' + (t.type || '').toLowerCase() + ' ' + (t.object_name || '').toLowerCase();
                if (text.indexOf(query) !== -1) return true;
                // Also match devices inside rack
                if (t.object_type_model === 'rack' && t.object_id && self.rackDevicesMap[t.object_id]) {
                    var devs = self.rackDevicesMap[t.object_id];
                    for (var d = 0; d < devs.length; d++) {
                        var dText = (devs[d].name || '').toLowerCase() + ' ' + (devs[d].ip || '').toLowerCase();
                        if (dText.indexOf(query) !== -1) return true;
                    }
                }
                return false;
            }
            return true;
        });

        // Sort: by label, then by position
        filtered.sort(function(a, b) {
            var la = (a.label || '').toLowerCase();
            var lb = (b.label || '').toLowerCase();
            if (la < lb) return -1;
            if (la > lb) return 1;
            return (a.y * 10000 + a.x) - (b.y * 10000 + b.x);
        });

        if (this.tileCountEl) {
            this.tileCountEl.textContent = filtered.length + ' / ' + s.tiles.length;
        }

        var html = '';
        for (var i = 0; i < filtered.length; i++) {
            html += this._renderTileItem(filtered[i], query);
        }

        this.tileListEl.innerHTML = html;
        this._attachListeners();
    };

    /** Highlight the currently selected tile in the sidebar. */
    Sidebar.prototype._highlightSelected = function() {
        if (!this.tileListEl) return;
        var sel = this.state.selectedTile;
        var selId = sel ? sel.id : -1;
        var items = this.tileListEl.querySelectorAll('.sidebar-tile-item');
        for (var i = 0; i < items.length; i++) {
            if (parseInt(items[i].dataset.tileId) === selId) {
                items[i].classList.add('active');
                items[i].scrollIntoView({ block: 'nearest' });
            } else {
                items[i].classList.remove('active');
            }
        }
    };

    // ─── Tile Item Rendering ──────────────────────────────────────

    Sidebar.prototype._renderTileItem = function(t, query) {
        var s = this.state;
        var color = t.type === 'rack' ? App.getUtilizationColor(t.utilization) : (s.typeColorMap[t.type] || '#6b6b80');
        var isActive = s.selectedTile && s.selectedTile.id === t.id;
        var rackDevices = (t.object_type_model === 'rack' && t.object_id) ? (this.rackDevicesMap[t.object_id] || []) : [];
        var hasDevices = rackDevices.length > 0;
        var isExpanded = this.expandedRacks.has(t.id);

        // Auto-expand if search matches a device inside this rack
        if (query && hasDevices) {
            for (var d = 0; d < rackDevices.length; d++) {
                var dText = (rackDevices[d].name || '').toLowerCase() + ' ' + (rackDevices[d].ip || '').toLowerCase();
                if (dText.indexOf(query) !== -1) { isExpanded = true; break; }
            }
        }

        var html = '<div class="sidebar-tile-item' + (isActive ? ' active' : '') + '" data-tile-id="' + t.id + '">';
        if (hasDevices) {
            html += '<span class="rack-expand-toggle" data-tile-id="' + t.id + '">' +
                (isExpanded ? '&#9662;' : '&#9656;') + '</span>';
        }
        html += '<div class="sidebar-tile-dot" style="background:' + color + '"></div>';
        html += '<div class="sidebar-tile-names">';
        html += '<span class="sidebar-tile-label" title="' + App.escapeHtml(t.label || t.type) + '">' +
            (t.label ? App.escapeHtml(t.label) : '<em>' + App.escapeHtml(t.type) + '</em>') + '</span>';
        if (t.object_name && t.object_name !== t.label) {
            html += '<span class="sidebar-tile-object" title="' + App.escapeHtml(t.object_name) + '">' + App.escapeHtml(t.object_name) + '</span>';
        }
        html += '</div>';
        if (hasDevices) {
            html += '<span class="rack-device-count">' + rackDevices.length + 'd</span>';
        }
        if (t.primary_ip) {
            html += '<span class="sidebar-tile-ip">' + App.escapeHtml(t.primary_ip) + '</span>';
        }
        html += '<span class="sidebar-tile-type">' + App.escapeHtml(t.type) + '</span>';
        html += '<span class="sidebar-tile-pos">' + t.x + ',' + t.y + '</span>';
        html += '</div>';

        // Expanded device sub-list
        if (hasDevices && isExpanded) {
            html += this._renderRackDeviceList(rackDevices, query);
        }

        return html;
    };

    Sidebar.prototype._renderRackDeviceList = function(rackDevices, query) {
        var html = '<div class="rack-devices-list">';
        for (var di = 0; di < rackDevices.length; di++) {
            var dev = rackDevices[di];
            // When searching, only show matching devices
            if (query) {
                var devMatch = (dev.name || '').toLowerCase().indexOf(query) !== -1 ||
                               (dev.ip || '').toLowerCase().indexOf(query) !== -1;
                if (!devMatch) continue;
            }
            var devTraceOpen = this.expandedDeviceTraces.has(dev.id);
            var hasNoTraces = this.deviceTraceCache[dev.id] && this.deviceTraceCache[dev.id].length === 0;

            html += '<div class="rack-device-wrapper">';
            html += '<div class="rack-device-item' + (query ? ' search-match' : '') + '">';
            if (hasNoTraces) {
                html += '<span class="rack-device-icon"><i class="mdi mdi-server"></i></span>';
            } else {
                html += '<span class="rack-dev-trace-toggle" data-device-id="' + dev.id + '" title="Show cable traces">';
                html += '<i class="mdi ' + (devTraceOpen ? 'mdi-chevron-down' : 'mdi-cable-data') + '"></i>';
                html += '</span>';
            }
            html += '<span class="rack-device-name">';
            if (dev.url) {
                html += '<a href="' + App.escapeHtml(dev.url) + '" title="' + App.escapeHtml(dev.name) + '">' + App.escapeHtml(dev.name) + '</a>';
            } else {
                html += App.escapeHtml(dev.name);
            }
            html += '</span>';
            if (dev.ip) html += '<span class="rack-device-ip">' + App.escapeHtml(dev.ip) + '</span>';
            if (dev.position) html += '<span class="rack-device-pos">U' + dev.position + '</span>';
            html += '</div>';

            if (devTraceOpen && !hasNoTraces) {
                html += '<div class="rack-dev-traces">';
                if (this.deviceTracePending[dev.id]) {
                    html += '<div class="rack-dev-trace-loading"><i class="mdi mdi-loading mdi-spin"></i> Loading&hellip;</div>';
                } else if (this.deviceTraceCache[dev.id]) {
                    html += this._renderDeviceTraceSummary(this.deviceTraceCache[dev.id], dev.id);
                }
                html += '</div>';
            }
            html += '</div>';
        }
        html += '</div>';
        return html;
    };

    Sidebar.prototype._renderDeviceTraceSummary = function(interfaces, deviceId) {
        if (!interfaces || interfaces.length === 0) {
            return '<div class="rack-dev-trace-empty"><em>No cabled ports</em></div>';
        }
        return App.generateTraceHTML(interfaces, 'rdt-' + deviceId, this.state.deviceTileMap);
    };

    // ─── Event Listeners ──────────────────────────────────────────

    Sidebar.prototype._attachListeners = function() {
        var self = this;
        var s = this.state;

        // Click handlers for tile items (zoom to tile)
        var items = this.tileListEl.querySelectorAll('.sidebar-tile-item');
        for (var j = 0; j < items.length; j++) {
            items[j].addEventListener('click', (function(item) {
                return function(e) {
                    if (e.target.closest('.rack-expand-toggle') || e.target.closest('.rack-dev-trace-toggle')) return;
                    var id = parseInt(item.dataset.tileId);
                    var tile = s.findTileById(id);
                    if (tile) {
                        s.selectTile(tile);
                        self.interaction.zoomToTile(tile);
                    }
                };
            })(items[j]));
        }

        // Click handlers for rack expand toggles
        var toggles = this.tileListEl.querySelectorAll('.rack-expand-toggle');
        for (var ti = 0; ti < toggles.length; ti++) {
            toggles[ti].addEventListener('click', (function(toggle) {
                return function(e) {
                    e.stopPropagation();
                    var tileId = parseInt(toggle.dataset.tileId);
                    if (self.expandedRacks.has(tileId)) {
                        self.expandedRacks.delete(tileId);
                    } else {
                        self.expandedRacks.add(tileId);
                        // Eagerly fetch traces for all devices in this rack
                        var rackTile = s.findTileById(tileId);
                        if (rackTile && rackTile.object_id && self.rackDevicesMap[rackTile.object_id]) {
                            var devs = self.rackDevicesMap[rackTile.object_id];
                            for (var rd = 0; rd < devs.length; rd++) {
                                if (!self.deviceTraceCache[devs[rd].id] && !self.deviceTracePending[devs[rd].id]) {
                                    self._fetchDeviceTraces(devs[rd].id);
                                }
                            }
                        }
                    }
                    self.build();
                };
            })(toggles[ti]));
        }

        // Click handlers for device trace toggles
        var devTraceToggles = this.tileListEl.querySelectorAll('.rack-dev-trace-toggle');
        for (var dti = 0; dti < devTraceToggles.length; dti++) {
            devTraceToggles[dti].addEventListener('click', (function(toggle) {
                return function(e) {
                    e.stopPropagation();
                    var deviceId = parseInt(toggle.dataset.deviceId);
                    if (self.expandedDeviceTraces.has(deviceId)) {
                        self.expandedDeviceTraces.delete(deviceId);
                        self.build();
                    } else {
                        self.expandedDeviceTraces.add(deviceId);
                        self.build();
                        if (!self.deviceTraceCache[deviceId]) {
                            self._fetchDeviceTraces(deviceId);
                        }
                    }
                };
            })(devTraceToggles[dti]));
        }

        // Attach trace toggle + map button listeners for rack device traces
        var rackTraceContainers = this.tileListEl.querySelectorAll('.rack-dev-traces');
        for (var rtc = 0; rtc < rackTraceContainers.length; rtc++) {
            App.attachTraceToggleListeners(rackTraceContainers[rtc], '', false);
            this._attachMapButtonListeners(rackTraceContainers[rtc]);
        }
    };

    // ─── "Show on map" buttons ────────────────────────────────────

    Sidebar.prototype._attachMapButtonListeners = function(containerEl) {
        var self = this;
        var btns = containerEl.querySelectorAll('.ct-dev-map-btn');
        for (var i = 0; i < btns.length; i++) {
            btns[i].addEventListener('click', (function(btn) {
                return function(e) {
                    e.stopPropagation();
                    var tileId = parseInt(btn.dataset.tileId);
                    var tile = self.state.findTileById(tileId);
                    if (tile) {
                        self.state.selectTile(tile);
                        self.interaction.zoomToTile(tile);
                    }
                };
            })(btns[i]));
        }
    };

    // ─── Rack Devices Loading ─────────────────────────────────────

    Sidebar.prototype._loadAllRackDevices = function(callback) {
        if (this.rackDevicesLoaded) { callback(); return; }

        var s = this.state;
        var self = this;
        var rackIds = [];
        for (var i = 0; i < s.tiles.length; i++) {
            if (s.tiles[i].object_type_model === 'rack' && s.tiles[i].object_id) {
                if (rackIds.indexOf(s.tiles[i].object_id) === -1) {
                    rackIds.push(s.tiles[i].object_id);
                }
            }
        }

        if (rackIds.length === 0) { this.rackDevicesLoaded = true; callback(); return; }

        var params = rackIds.map(function(id) { return 'rack_id=' + id; }).join('&');
        fetch('/api/dcim/devices/?' + params + '&limit=1000', {
            credentials: 'same-origin',
            headers: { 'Accept': 'application/json' }
        })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            var results = data.results || [];
            self.rackDevicesMap = {};
            for (var i = 0; i < results.length; i++) {
                var d = results[i];
                var rackId = d.rack ? d.rack.id : null;
                if (!rackId) continue;
                if (!self.rackDevicesMap[rackId]) self.rackDevicesMap[rackId] = [];

                var ip = null;
                if (d.primary_ip4 && d.primary_ip4.address) ip = d.primary_ip4.address.split('/')[0];
                else if (d.primary_ip6 && d.primary_ip6.address) ip = d.primary_ip6.address.split('/')[0];

                self.rackDevicesMap[rackId].push({
                    id: d.id,
                    name: d.display || d.name || ('Device #' + d.id),
                    url: d.display_url || ('/dcim/devices/' + d.id + '/'),
                    ip: ip,
                    position: d.position
                });
            }
            // Sort by U position descending within each rack
            for (var rid in self.rackDevicesMap) {
                self.rackDevicesMap[rid].sort(function(a, b) {
                    return (b.position || 0) - (a.position || 0);
                });
            }
            // Add rack-child devices to deviceTileMap for "show on map" buttons
            for (var rti = 0; rti < s.tiles.length; rti++) {
                var rackTile = s.tiles[rti];
                if (rackTile.object_type_model === 'rack' && rackTile.object_id && self.rackDevicesMap[rackTile.object_id]) {
                    var rackDevs = self.rackDevicesMap[rackTile.object_id];
                    for (var rdi = 0; rdi < rackDevs.length; rdi++) {
                        if (!s.deviceTileMap[rackDevs[rdi].id]) {
                            s.deviceTileMap[rackDevs[rdi].id] = rackTile;
                        }
                    }
                }
            }
            self.rackDevicesLoaded = true;
            callback();
        })
        .catch(function(err) {
            console.error('Failed to load rack devices:', err);
            self.rackDevicesLoaded = true;
            callback();
        });
    };

    Sidebar.prototype._fetchDeviceTraces = function(deviceId) {
        if (this.deviceTraceCache[deviceId] || this.deviceTracePending[deviceId]) return;
        this.deviceTracePending[deviceId] = true;
        var self = this;

        fetch(this.state.detailBaseUrl + 'device/' + deviceId + '/', {
            credentials: 'same-origin',
            headers: { 'Accept': 'application/json' }
        })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            self.deviceTraceCache[deviceId] = data.interfaces || [];
            delete self.deviceTracePending[deviceId];
            self.build();
        })
        .catch(function(err) {
            console.error('Failed to load device traces:', err);
            self.deviceTraceCache[deviceId] = [];
            delete self.deviceTracePending[deviceId];
            self.build();
        });
    };

    // ─── Type Toggles ─────────────────────────────────────────────

    Sidebar.prototype._bindTypeToggles = function() {
        var self = this;
        var s = this.state;
        var toggleContainer = document.getElementById('type-toggles');
        if (!toggleContainer) return;

        var toggleBtns = toggleContainer.querySelectorAll('.type-toggle[data-type]');
        for (var ti = 0; ti < toggleBtns.length; ti++) {
            toggleBtns[ti].addEventListener('click', (function(btn) {
                return function() {
                    var type = btn.dataset.type;
                    s.toggleType(type);
                    if (s.visibleTypes.has(type)) {
                        btn.classList.add('active');
                    } else {
                        btn.classList.remove('active');
                    }
                };
            })(toggleBtns[ti]));
        }
    };

    Sidebar.prototype._bindFOVToggle = function() {
        var self = this;
        var fovToggle = document.getElementById('fov-toggle');
        if (!fovToggle) return;

        fovToggle.addEventListener('click', function() {
            self.state.toggleFOV();
            if (self.state.showFOV) {
                fovToggle.classList.add('active');
            } else {
                fovToggle.classList.remove('active');
            }
        });
    };

    // ─── Search ───────────────────────────────────────────────────

    Sidebar.prototype._bindSearch = function() {
        if (!this.tileSearchInput) return;
        var self = this;
        this.tileSearchInput.addEventListener('input', function() { self.build(); });
    };

    // ─── Floor Plan Selector ──────────────────────────────────────

    Sidebar.prototype._bindFloorplanSelector = function() {
        var selector = document.getElementById('floorplan-selector');
        if (!selector) return;
        var editMode = this.state.editMode;

        selector.addEventListener('change', function() {
            var fpId = this.value;
            var currentPath = window.location.pathname;
            var url = currentPath.replace(/\/\d+\/visualization\/?.*$/, '/' + fpId + '/visualization/');
            if (editMode) url += '?edit=true';
            window.location.href = url;
        });
    };

    // ─── Panel Swap ───────────────────────────────────────────────

    Sidebar.prototype.showListPanel = function() {
        if (this.panelList)   this.panelList.classList.remove('d-none');
        if (this.panelDetail) this.panelDetail.classList.add('d-none');
    };

    Sidebar.prototype.showDetailPanel = function() {
        if (this.panelList)   this.panelList.classList.add('d-none');
        if (this.panelDetail) this.panelDetail.classList.remove('d-none');
    };

    Sidebar.prototype._bindBackButton = function() {
        if (!this.detailBackBtn) return;
        var self = this;
        this.detailBackBtn.addEventListener('click', function() {
            self.state.deselectTile();
        });
    };

    Sidebar.prototype._bindEscKey = function() {
        var self = this;
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape' && self.panelDetail && !self.panelDetail.classList.contains('d-none')) {
                // Don't intercept ESC if user is typing in an input/select
                if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
                self.state.deselectTile();
            }
        });
    };

    App.Sidebar = Sidebar;

})(window.FloorplanApp);
