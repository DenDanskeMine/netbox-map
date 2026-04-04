/* NetBox Map — Topology Sidebar Module */
/* Device list, search, role toggle buttons */

(function(App) {
    'use strict';

    function Sidebar(state, events) {
        this.state = state;
        this.events = events;
        this.deviceListEl = document.getElementById('topo-device-list');
        this.searchInput = document.getElementById('topo-search');
        this.countEl = document.getElementById('topo-device-count');
        this.roleTogglesEl = document.getElementById('topo-role-toggles');
        this.panelList = document.getElementById('topo-sidebar-list');
        this.panelDetail = document.getElementById('topo-sidebar-detail');
        this.detailBackBtn = document.getElementById('topo-detail-back');

        this._bindEvents();
    }

    Sidebar.prototype._bindEvents = function() {
        var self = this;

        this.events.on('data:loaded', function() { self.build(); });

        this.events.on('node:select', function(node) {
            self._highlightItem(node.id);
            self.showDetail();
        });

        this.events.on('node:deselect', function() {
            self._clearHighlight();
            self.showList();
        });

        // Search
        if (this.searchInput) {
            this.searchInput.addEventListener('input', function() {
                self.state.searchQuery = this.value.toLowerCase();
                self._renderDeviceList();
                self._applyVisibilityFilter();
            });
        }

        // Back button
        if (this.detailBackBtn) {
            this.detailBackBtn.addEventListener('click', function() {
                self.events.emit('node:deselect');
            });
        }

        // Escape key
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape' && self.state.selectedNode) {
                self.events.emit('node:deselect');
            }
        });
    };

    Sidebar.prototype.build = function() {
        // Update search placeholder for mode
        if (this.searchInput) {
            this.searchInput.placeholder = this.state.topologyMode === 'apps'
                ? 'Search applications...'
                : 'Search devices...';
        }
        this._buildRoleToggles();
        this._renderDeviceList();
    };

    Sidebar.prototype._buildRoleToggles = function() {
        var self = this;
        if (!this.roleTogglesEl) return;

        if (this.state.topologyMode === 'apps') {
            this._buildCriticalityToggles();
            return;
        }

        // Extract unique roles
        var roles = {};
        this.state.nodes.forEach(function(n) {
            if (n.role) {
                if (!roles[n.role]) {
                    roles[n.role] = { name: n.role, slug: n.role_slug, color: n.role_color, count: 0 };
                }
                roles[n.role].count++;
            }
        });

        // All roles visible by default
        var roleList = Object.values(roles).sort(function(a, b) {
            return b.count - a.count;
        });

        this.state.visibleRoles = new Set(roleList.map(function(r) { return r.name; }));

        var html = '';
        roleList.forEach(function(role) {
            html += '<div class="topo-role-toggle active" data-role="' + App.escapeHtml(role.name) + '">'
                + '<span class="toggle-dot" style="background:' + App.escapeHtml(role.color) + ';"></span>'
                + App.escapeHtml(role.name)
                + ' <span class="text-muted">(' + role.count + ')</span>'
                + '</div>';
        });
        this.roleTogglesEl.innerHTML = html;

        // Toggle clicks
        this.roleTogglesEl.querySelectorAll('.topo-role-toggle').forEach(function(el) {
            el.addEventListener('click', function() {
                var role = this.getAttribute('data-role');
                if (self.state.visibleRoles.has(role)) {
                    self.state.visibleRoles.delete(role);
                    this.classList.remove('active');
                } else {
                    self.state.visibleRoles.add(role);
                    this.classList.add('active');
                }
                self._renderDeviceList();
                self._applyVisibilityFilter();
            });
        });
    };

    Sidebar.prototype._buildCriticalityToggles = function() {
        var self = this;
        var critColors = {critical:'#e74c3c', high:'#e67e22', medium:'#f39c12', low:'#3498db'};
        var crits = {};
        this.state.nodes.forEach(function(n) {
            if (n.criticality) {
                if (!crits[n.criticality]) {
                    crits[n.criticality] = { name: n.criticality, color: critColors[n.criticality] || '#6c757d', count: 0 };
                }
                crits[n.criticality].count++;
            }
        });

        var critOrder = ['critical', 'high', 'medium', 'low'];
        var critList = critOrder.filter(function(c) { return crits[c]; }).map(function(c) { return crits[c]; });

        this.state.visibleRoles = new Set(critList.map(function(r) { return r.name; }));

        var html = '';
        critList.forEach(function(crit) {
            html += '<div class="topo-role-toggle active" data-role="' + App.escapeHtml(crit.name) + '">'
                + '<span class="toggle-dot" style="background:' + App.escapeHtml(crit.color) + ';"></span>'
                + App.escapeHtml(crit.name)
                + ' <span class="text-muted">(' + crit.count + ')</span>'
                + '</div>';
        });
        this.roleTogglesEl.innerHTML = html;

        this.roleTogglesEl.querySelectorAll('.topo-role-toggle').forEach(function(el) {
            el.addEventListener('click', function() {
                var role = this.getAttribute('data-role');
                if (self.state.visibleRoles.has(role)) {
                    self.state.visibleRoles.delete(role);
                    this.classList.remove('active');
                } else {
                    self.state.visibleRoles.add(role);
                    this.classList.add('active');
                }
                self._renderDeviceList();
                self._applyVisibilityFilter();
            });
        });
    };

    Sidebar.prototype._renderDeviceList = function() {
        if (!this.deviceListEl) return;
        var self = this;
        var query = this.state.searchQuery;
        var isAppMode = this.state.topologyMode === 'apps';

        var filtered = this.state.nodes.filter(function(n) {
            if (isAppMode) {
                // Criticality filter
                if (n.criticality && !self.state.visibleRoles.has(n.criticality)) return false;
            } else {
                // Role filter
                if (n.role && !self.state.visibleRoles.has(n.role)) return false;
            }
            // Search filter
            if (query) {
                var searchable;
                if (isAppMode) {
                    searchable = (n.name + ' ' + (n.environment || '') + ' ' + (n.group || '') + ' ' + (n.owner || '')).toLowerCase();
                } else {
                    searchable = (n.name + ' ' + n.device_type + ' ' + n.role + ' ' + n.primary_ip).toLowerCase();
                }
                if (searchable.indexOf(query) === -1) return false;
            }
            return true;
        });

        // Sort by name
        filtered.sort(function(a, b) {
            return (a.name || '').localeCompare(b.name || '');
        });

        var html = '';
        if (isAppMode) {
            // Filter: only show application nodes (no devices)
            filtered = filtered.filter(function(n) { return n.node_type === 'application'; });

            // Group instances by base name: "fluentd (srv-001)" → base "fluentd"
            var groups = {};
            var groupOrder = [];
            filtered.forEach(function(n) {
                var name = n.name || '';
                var parenIdx = name.indexOf(' (');
                var baseName = parenIdx > 0 ? name.substring(0, parenIdx) : name;
                if (!groups[baseName]) {
                    groups[baseName] = [];
                    groupOrder.push(baseName);
                }
                groups[baseName].push(n);
            });

            groupOrder.forEach(function(baseName) {
                var items = groups[baseName];

                if (items.length === 1) {
                    // Single item — render flat (no grouping)
                    html += self._renderAppItem(items[0]);
                } else {
                    // Multiple instances — collapsible group
                    var downCount = items.filter(function(n) { return (n.host_status || 'healthy') === 'down'; }).length;
                    var degradedCount = items.filter(function(n) { return (n.host_status || 'healthy') === 'degraded'; }).length;
                    var groupId = 'appgrp-' + baseName.replace(/[^a-z0-9]/gi, '-');
                    var critColor = items[0].criticality_color || '#6c757d';

                    html += '<div class="topo-app-group" data-group-id="' + App.escapeHtml(groupId) + '">'
                        + '<span class="app-group-chevron"><i class="mdi mdi-chevron-right"></i></span>'
                        + '<div class="device-info">'
                        + '<div class="device-name">' + App.escapeHtml(baseName) + '</div>'
                        + '<div class="device-meta">' + items.length + ' instances'
                        + (downCount > 0 ? ' &middot; <span style="color:#f85149;">' + downCount + ' down</span>' : '')
                        + (degradedCount > 0 ? ' &middot; <span style="color:#d29922;">' + degradedCount + ' degraded</span>' : '')
                        + '</div></div>'
                        + '<span class="app-crit" style="color:' + App.escapeHtml(critColor) + ';">'
                        + App.escapeHtml((items[0].criticality || '').toUpperCase()) + '</span>'
                        + '</div>';

                    html += '<div class="topo-app-group-items d-none" id="' + App.escapeHtml(groupId) + '">';
                    items.forEach(function(n) {
                        html += self._renderAppItem(n);
                    });
                    html += '</div>';
                }
            });
        } else {
            filtered.forEach(function(n) {
                var selected = self.state.selectedNode && self.state.selectedNode.id === n.id ? ' selected' : '';
                var isHidden = self.state.hiddenNodes.has(n.id);
                html += '<div class="topo-device-item' + selected + (isHidden ? ' hidden-node' : '') + '" data-node-id="' + App.escapeHtml(n.id) + '">'
                    + '<span class="role-dot" style="background:' + App.escapeHtml(n.role_color) + ';' + (isHidden ? 'opacity:0.3;' : '') + '"></span>'
                    + '<div class="device-info">'
                    + '<div class="device-name">' + App.escapeHtml(n.name) + '</div>'
                    + '<div class="device-meta">' + App.escapeHtml(n.device_type);
                if (n.rack) html += ' &middot; ' + App.escapeHtml(n.rack);
                html += '</div></div>'
                    + '<span class="device-ports">' + n.interface_count + 'p</span>'
                    + '<button class="topo-hide-btn" data-hide-id="' + App.escapeHtml(n.id) + '" title="' + (isHidden ? 'Show' : 'Hide') + '">'
                    + '<i class="mdi mdi-eye' + (isHidden ? '-off' : '') + '"></i>'
                    + '</button>'
                    + '</div>';
            });
        }

        this.deviceListEl.innerHTML = html;

        if (this.countEl) {
            var entityName = isAppMode ? 'applications' : 'devices';
            this.countEl.textContent = filtered.length + ' of ' + this.state.nodes.length + ' ' + entityName;
        }

        // Click handlers — device item (select)
        this.deviceListEl.querySelectorAll('.topo-device-item').forEach(function(el) {
            el.addEventListener('click', function(e) {
                // Don't select if clicking hide button
                if (e.target.closest('.topo-hide-btn')) return;
                var nodeId = this.getAttribute('data-node-id');
                var node = self.state.nodes.find(function(n) { return n.id === nodeId; });
                if (node) {
                    self.state.selectedNode = node;
                    self.events.emit('node:select', node);
                    self.events.emit('renderer:highlight', nodeId);
                }
            });
        });

        // Click handlers — hide/show toggle
        this.deviceListEl.querySelectorAll('.topo-hide-btn').forEach(function(btn) {
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                var nodeId = this.getAttribute('data-hide-id');
                if (self.state.hiddenNodes.has(nodeId)) {
                    self.state.hiddenNodes.delete(nodeId);
                } else {
                    self.state.hiddenNodes.add(nodeId);
                }
                self._renderDeviceList();
                self.events.emit('node:hidden');
            });
        });

        // Click handlers — group expand/collapse
        this.deviceListEl.querySelectorAll('.topo-app-group').forEach(function(el) {
            el.addEventListener('click', function() {
                var groupId = this.getAttribute('data-group-id');
                var itemsEl = document.getElementById(groupId);
                if (!itemsEl) return;
                var collapsed = itemsEl.classList.toggle('d-none');
                var chevron = this.querySelector('.app-group-chevron i');
                if (chevron) chevron.className = 'mdi mdi-chevron-' + (collapsed ? 'right' : 'down');
                this.classList.toggle('expanded', !collapsed);
            });
        });
    };

    Sidebar.prototype._renderAppItem = function(n) {
        var selected = this.state.selectedNode && this.state.selectedNode.id === n.id ? ' selected' : '';
        var isHidden = this.state.hiddenNodes.has(n.id);
        var hs = n.host_status || 'healthy';
        var statusColor = hs === 'down' ? '#e74c3c' : hs === 'degraded' ? '#e67e22' : App.statusColor(n.status_value);
        var critColor = n.criticality_color || '#6c757d';

        // Show short name if it has a parenthetical suffix
        var displayName = n.name || '';
        var parenIdx = displayName.indexOf(' (');
        var shortName = parenIdx > 0 ? displayName.substring(parenIdx + 2, displayName.length - 1) : displayName;

        var h = '<div class="topo-device-item' + selected + (isHidden ? ' hidden-node' : '') + '" data-node-id="' + App.escapeHtml(n.id) + '">'
            + '<span class="role-dot" style="background:' + App.escapeHtml(statusColor) + ';' + (isHidden ? 'opacity:0.3;' : '') + '"></span>'
            + '<div class="device-info">'
            + '<div class="device-name">' + App.escapeHtml(shortName) + '</div>'
            + '<div class="device-meta">'
            + App.escapeHtml(n.environment || '');
        if (n.group) h += ' &middot; ' + App.escapeHtml(n.group);
        h += '</div></div>';
        h += '<div class="app-item-right">';
        h += '<span class="app-crit" style="color:' + App.escapeHtml(critColor) + ';">'
            + App.escapeHtml((n.criticality || '').toUpperCase()) + '</span>';
        if (n.deploy_count > 0) {
            h += '<span class="app-hosts">' + n.deploy_count + '</span>';
        }
        h += '</div>';
        h += '<button class="topo-hide-btn" data-hide-id="' + App.escapeHtml(n.id) + '" title="' + (isHidden ? 'Show' : 'Hide') + '">'
            + '<i class="mdi mdi-eye' + (isHidden ? '-off' : '') + '"></i></button>'
            + '</div>';
        return h;
    };

    Sidebar.prototype._applyVisibilityFilter = function() {
        var self = this;
        var query = this.state.searchQuery;
        var isAppMode = this.state.topologyMode === 'apps';

        // Build set of visible node IDs
        var visibleIds = new Set();
        this.state.nodes.forEach(function(n) {
            var filterOk;
            if (isAppMode) {
                filterOk = !n.criticality || self.state.visibleRoles.has(n.criticality);
            } else {
                filterOk = !n.role || self.state.visibleRoles.has(n.role);
            }
            var searchOk;
            if (isAppMode) {
                searchOk = !query || (n.name + ' ' + (n.environment || '') + ' ' + (n.group || '') + ' ' + (n.owner || ''))
                    .toLowerCase().indexOf(query) !== -1;
            } else {
                searchOk = !query || (n.name + ' ' + n.device_type + ' ' + n.role + ' ' + n.primary_ip)
                    .toLowerCase().indexOf(query) !== -1;
            }
            if (filterOk && searchOk) visibleIds.add(n.id);
        });

        var allVisible = visibleIds.size === this.state.nodes.length;
        this.events.emit('filter:applied', allVisible ? null : visibleIds);
    };

    Sidebar.prototype._highlightItem = function(nodeId) {
        if (!this.deviceListEl) return;
        this.deviceListEl.querySelectorAll('.topo-device-item').forEach(function(el) {
            var match = el.getAttribute('data-node-id') === nodeId;
            el.classList.toggle('selected', match);
            if (match) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        });
    };

    Sidebar.prototype._clearHighlight = function() {
        if (!this.deviceListEl) return;
        this.deviceListEl.querySelectorAll('.topo-device-item.selected').forEach(function(el) {
            el.classList.remove('selected');
        });
    };

    Sidebar.prototype.showDetail = function() {
        if (this.panelList) this.panelList.classList.add('d-none');
        if (this.panelDetail) this.panelDetail.classList.remove('d-none');
    };

    Sidebar.prototype.showList = function() {
        if (this.panelDetail) this.panelDetail.classList.add('d-none');
        if (this.panelList) this.panelList.classList.remove('d-none');
    };

    App.Sidebar = Sidebar;

})(TopologyApp);
