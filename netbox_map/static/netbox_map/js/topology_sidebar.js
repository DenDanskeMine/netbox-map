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
        this._buildRoleToggles();
        this._renderDeviceList();
    };

    Sidebar.prototype._buildRoleToggles = function() {
        var self = this;
        if (!this.roleTogglesEl) return;

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

    Sidebar.prototype._renderDeviceList = function() {
        if (!this.deviceListEl) return;
        var self = this;
        var query = this.state.searchQuery;

        var filtered = this.state.nodes.filter(function(n) {
            // Role filter
            if (n.role && !self.state.visibleRoles.has(n.role)) return false;
            // Search filter
            if (query) {
                var searchable = (n.name + ' ' + n.device_type + ' ' + n.role + ' ' + n.primary_ip).toLowerCase();
                if (searchable.indexOf(query) === -1) return false;
            }
            return true;
        });

        // Sort by name
        filtered.sort(function(a, b) {
            return (a.name || '').localeCompare(b.name || '');
        });

        var html = '';
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

        this.deviceListEl.innerHTML = html;

        if (this.countEl) {
            this.countEl.textContent = filtered.length + ' of ' + this.state.nodes.length + ' devices';
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
    };

    Sidebar.prototype._applyVisibilityFilter = function() {
        var self = this;
        var query = this.state.searchQuery;

        // Build set of visible node IDs
        var visibleIds = new Set();
        this.state.nodes.forEach(function(n) {
            var roleOk = !n.role || self.state.visibleRoles.has(n.role);
            var searchOk = !query || (n.name + ' ' + n.device_type + ' ' + n.role + ' ' + n.primary_ip)
                .toLowerCase().indexOf(query) !== -1;
            if (roleOk && searchOk) visibleIds.add(n.id);
        });

        var allVisible = visibleIds.size === this.state.nodes.length;
        this.events.emit('filter:applied', allVisible ? null : visibleIds);
    };

    Sidebar.prototype._highlightItem = function(nodeId) {
        if (!this.deviceListEl) return;
        this.deviceListEl.querySelectorAll('.topo-device-item').forEach(function(el) {
            el.classList.toggle('selected', el.getAttribute('data-node-id') === nodeId);
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
