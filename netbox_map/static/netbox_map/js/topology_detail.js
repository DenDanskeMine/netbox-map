/* NetBox Map — Topology Detail Module */
/* Rich device detail panel with interface listings and connection info */

(function(App) {
    'use strict';

    function Detail(state, events) {
        this.state = state;
        this.events = events;
        this.api = new App.API(state);
        this.contentEl = document.getElementById('topo-detail-content');
        this.cache = {};

        var self = this;
        events.on('node:select', function(node) { self.loadDetail(node); });
        events.on('node:deselect', function() { self._clear(); });
    }

    Detail.prototype.loadDetail = function(node) {
        if (!this.contentEl) return;
        var self = this;

        if (node.node_type === 'application') {
            this._renderAppInfo(node);
            return;
        }

        this._renderDeviceInfo(node);

        if (this.cache[node.device_id]) {
            this._renderInterfaces(this.cache[node.device_id], node);
            return;
        }

        var url = this.state.deviceDetailUrl + node.device_id + '/';
        this.api.get(url).then(function(data) {
            self.cache[node.device_id] = data;
            self._renderInterfaces(data, node);
        }).catch(function() {
            self._appendError('Failed to load interfaces');
        });
    };

    Detail.prototype._renderAppInfo = function(node) {
        if (!this.contentEl) return;
        var self = this;

        // Count connections from edges
        var depCount = 0;
        this.state.edges.forEach(function(e) {
            var s = typeof e.source === 'object' ? e.source.id : e.source;
            var t = typeof e.target === 'object' ? e.target.id : e.target;
            if (s === node.id || t === node.id) depCount++;
        });

        var critColor = node.criticality_color || '#6c757d';
        var html = '<div class="topo-detail-section">';

        // App header
        html += '<div class="topo-detail-device-header">'
            + '<span class="topo-detail-role-dot" style="background:' + App.escapeHtml(node.category_color || '#6c757d') + ';"></span>'
            + '<div class="topo-detail-device-info">'
            + '<a href="' + App.escapeHtml(node.url) + '" class="topo-detail-device-name">' + App.escapeHtml(node.name) + '</a>'
            + '<span class="topo-detail-device-type">' + App.escapeHtml(node.environment || '') + '</span>'
            + '</div></div>';

        // Quick stats
        html += '<div class="topo-detail-stats">'
            + '<div class="topo-detail-stat"><span class="topo-detail-stat-val" style="color:' + critColor + ';">'
            + App.escapeHtml((node.criticality || '').toUpperCase())
            + '</span><span class="topo-detail-stat-label">Criticality</span></div>'
            + '<div class="topo-detail-stat"><span class="topo-detail-stat-val">' + depCount
            + '</span><span class="topo-detail-stat-label">Dependencies</span></div>'
            + '<div class="topo-detail-stat"><span class="topo-detail-stat-val">' + (node.deploy_count || 0)
            + '</span><span class="topo-detail-stat-label">Hosts</span></div>'
            + '</div>';

        // Properties
        html += '<div class="topo-detail-props">';
        html += this._prop('Status', '<span style="color:' + App.statusColor(node.status_value) + ';">\u25CF</span> ' + App.escapeHtml(node.status || ''));
        if (node.environment) html += this._prop('Environment', node.environment);
        if (node.version) html += this._prop('Version', '<code>' + App.escapeHtml(node.version) + '</code>');
        if (node.group) html += this._prop('Group', node.group);
        if (node.owner) html += this._prop('Owner', node.owner);
        if (node.site) html += this._prop('Site', node.site);
        if (node.description) html += this._prop('Description', node.description);
        html += '</div></div>';

        // Actions
        html += '<div class="topo-detail-actions">'
            + '<a href="' + App.escapeHtml(node.url) + '" class="topo-btn" style="font-size:11px;" target="_blank"><i class="mdi mdi-open-in-new"></i> NetBox</a>'
            + '</div>';

        // Dependencies placeholder
        html += '<div id="topo-app-deps-section">'
            + '<div class="text-center py-3"><div class="spinner-border spinner-border-sm text-primary"></div></div>'
            + '</div>';

        this.contentEl.innerHTML = html;

        // Load dependency details from API
        var cacheKey = 'app-' + node.app_id;
        if (this.cache[cacheKey]) {
            this._renderAppDeps(this.cache[cacheKey]);
            return;
        }

        var url = this.state.appDetailUrl + node.app_id + '/';
        this.api.get(url).then(function(data) {
            self.cache[cacheKey] = data;
            self._renderAppDeps(data);
        }).catch(function() {
            var section = document.getElementById('topo-app-deps-section');
            if (section) section.innerHTML = '<div class="px-3 py-3 text-danger small">Failed to load dependencies</div>';
        });
    };

    Detail.prototype._renderAppDeps = function(data) {
        var section = document.getElementById('topo-app-deps-section');
        if (!section) return;
        var self = this;

        var html = '';

        // Upstream dependencies (what this app depends on)
        if (data.upstream && data.upstream.length > 0) {
            html += '<div class="topo-detail-section">'
                + '<div class="topo-detail-section-title">'
                + '<span class="topo-detail-section-icon" style="background:#e67e22;"></span>'
                + 'Depends On <span class="topo-detail-section-count">' + data.upstream.length + '</span>'
                + '</div>';
            data.upstream.forEach(function(dep) {
                html += '<div class="topo-iface-row">'
                    + '<div class="topo-iface-row-main">'
                    + '<span class="topo-iface-dot" style="background:' + (dep.dependency_type === 'hard' ? '#e74c3c' : '#3498db') + ';"></span>'
                    + '<a href="#" data-goto-app="' + dep.app_id + '" class="topo-iface-port-name" style="font-family:inherit;">' + App.escapeHtml(dep.app_name) + '</a>'
                    + '<span class="topo-iface-speed-pill" style="background:rgba(255,255,255,0.06);color:#a0a8c0;font-size:9px;">'
                    + App.escapeHtml(dep.dependency_type) + '</span>'
                    + '</div>';
                if (dep.protocol || dep.port) {
                    html += '<div class="topo-iface-row-connection">'
                        + '<i class="mdi mdi-arrow-right-thin"></i> ';
                    if (dep.protocol) html += App.escapeHtml(dep.protocol);
                    if (dep.port) html += ' :' + dep.port;
                    html += '</div>';
                }
                html += '</div>';
            });
            html += '</div>';
        }

        // Downstream dependencies (what depends on this app)
        if (data.downstream && data.downstream.length > 0) {
            html += '<div class="topo-detail-section">'
                + '<div class="topo-detail-section-title">'
                + '<span class="topo-detail-section-icon" style="background:#2ecc71;"></span>'
                + 'Depended On By <span class="topo-detail-section-count">' + data.downstream.length + '</span>'
                + '</div>';
            data.downstream.forEach(function(dep) {
                html += '<div class="topo-iface-row">'
                    + '<div class="topo-iface-row-main">'
                    + '<span class="topo-iface-dot" style="background:' + (dep.dependency_type === 'hard' ? '#e74c3c' : '#3498db') + ';"></span>'
                    + '<a href="#" data-goto-app="' + dep.app_id + '" class="topo-iface-port-name" style="font-family:inherit;">' + App.escapeHtml(dep.app_name) + '</a>'
                    + '<span class="topo-iface-speed-pill" style="background:rgba(255,255,255,0.06);color:#a0a8c0;font-size:9px;">'
                    + App.escapeHtml(dep.dependency_type) + '</span>'
                    + '</div></div>';
            });
            html += '</div>';
        }

        // Deployments
        if (data.deployments && data.deployments.length > 0) {
            html += '<div class="topo-detail-section">'
                + '<div class="topo-detail-section-title">'
                + '<span class="topo-detail-section-icon" style="background:#9b59b6;"></span>'
                + 'Hosts <span class="topo-detail-section-count">' + data.deployments.length + '</span>'
                + '</div>';
            data.deployments.forEach(function(deploy) {
                html += '<div class="topo-iface-row">'
                    + '<div class="topo-iface-row-main">'
                    + '<span class="topo-iface-dot" style="background:#9b59b6;"></span>'
                    + '<span class="topo-iface-port-name" style="font-family:inherit;">' + App.escapeHtml(deploy.host_name) + '</span>'
                    + '<span class="topo-iface-speed-pill" style="background:rgba(255,255,255,0.06);color:#a0a8c0;font-size:9px;">'
                    + App.escapeHtml(deploy.role) + '</span>'
                    + '</div></div>';
            });
            html += '</div>';
        }

        if (!data.upstream.length && !data.downstream.length && !data.deployments.length) {
            html = '<div class="px-3 py-3 text-muted small text-center">No dependencies or deployments</div>';
        }

        section.innerHTML = html;

        // Wire "go to app" links
        section.querySelectorAll('[data-goto-app]').forEach(function(link) {
            link.addEventListener('click', function(e) {
                e.preventDefault();
                var appId = parseInt(this.getAttribute('data-goto-app'));
                var nodeId = 'app-' + appId;
                var node = self.state.nodes.find(function(n) { return n.id === nodeId; });
                if (node) {
                    self.state.selectedNode = node;
                    self.events.emit('node:select', node);
                    self.events.emit('renderer:highlight', nodeId);
                }
            });
        });
    };

    Detail.prototype._renderDeviceInfo = function(node) {
        if (!this.contentEl) return;

        // Count connections from edges
        var cableCount = 0;
        this.state.edges.forEach(function(e) {
            if (e.source === node.id || e.target === node.id) cableCount++;
        });

        var html = '<div class="topo-detail-section">';

        // Device header with link
        html += '<div class="topo-detail-device-header">'
            + '<span class="topo-detail-role-dot" style="background:' + App.escapeHtml(node.role_color) + ';"></span>'
            + '<div class="topo-detail-device-info">'
            + '<a href="' + App.escapeHtml(node.url) + '" class="topo-detail-device-name">' + App.escapeHtml(node.name) + '</a>'
            + '<span class="topo-detail-device-type">' + App.escapeHtml(node.device_type) + '</span>'
            + '</div></div>';

        // Quick stats
        html += '<div class="topo-detail-stats">'
            + '<div class="topo-detail-stat"><span class="topo-detail-stat-val">' + node.interface_count + '</span><span class="topo-detail-stat-label">Interfaces</span></div>'
            + '<div class="topo-detail-stat"><span class="topo-detail-stat-val">' + cableCount + '</span><span class="topo-detail-stat-label">Cables</span></div>'
            + '<div class="topo-detail-stat"><span class="topo-detail-stat-val">' + App.escapeHtml(node.status) + '</span><span class="topo-detail-stat-label">Status</span></div>'
            + '</div>';

        // Properties
        html += '<div class="topo-detail-props">';
        if (node.role) html += this._prop('Role', '<span style="color:' + App.escapeHtml(node.role_color) + ';">\u25CF</span> ' + App.escapeHtml(node.role));
        if (node.primary_ip) html += this._prop('IP', '<code>' + App.escapeHtml(node.primary_ip) + '</code>');
        if (node.site) html += this._prop('Site', node.site);
        if (node.rack) html += this._prop('Rack', node.rack);
        if (node.location) html += this._prop('Location', node.location);
        if (node.tenant) html += this._prop('Tenant', node.tenant);
        if (node.manufacturer) html += this._prop('Mfg', node.manufacturer);
        if (node.virtual_chassis) html += this._prop('VC', node.virtual_chassis);
        html += '</div></div>';

        // Actions
        html += '<div class="topo-detail-actions">'
            + '<a href="' + App.escapeHtml(node.url) + '" class="topo-btn" style="font-size:11px;" target="_blank"><i class="mdi mdi-open-in-new"></i> NetBox</a>'
            + '<button class="topo-btn" style="font-size:11px;color:#e74c3c;" onclick="TopologyApp._events.emit(\'device:remove\',\'' + App.escapeHtml(node.id) + '\')"><i class="mdi mdi-close-circle-outline"></i> Remove</button>'
            + '</div>';

        // Loading placeholder
        html += '<div id="topo-interfaces-section">'
            + '<div class="text-center py-3"><div class="spinner-border spinner-border-sm text-primary"></div></div>'
            + '</div>';

        this.contentEl.innerHTML = html;
    };

    Detail.prototype._renderInterfaces = function(data, node) {
        var section = document.getElementById('topo-interfaces-section');
        if (!section) return;
        var self = this;

        var interfaces = data.interfaces || [];
        var ports = data.ports || [];

        var connected = interfaces.filter(function(i) { return i.cable_id; });
        var unconnected = interfaces.filter(function(i) { return !i.cable_id; });

        var html = '';

        // Connected interfaces
        if (connected.length > 0) {
            html += '<div class="topo-detail-section">'
                + '<div class="topo-detail-section-title">'
                + '<span class="topo-detail-section-icon" style="background:#2ecc71;"></span>'
                + 'Connected <span class="topo-detail-section-count">' + connected.length + '</span>'
                + '</div>';
            connected.forEach(function(iface) {
                html += self._renderIfaceRow(iface);
            });
            html += '</div>';
        }

        // Unconnected interfaces
        if (unconnected.length > 0) {
            html += '<div class="topo-detail-section">'
                + '<div class="topo-detail-section-title">'
                + '<span class="topo-detail-section-icon" style="background:#6c757d;"></span>'
                + 'Unconnected <span class="topo-detail-section-count">' + unconnected.length + '</span>'
                + '</div>';
            unconnected.forEach(function(iface) {
                html += self._renderIfaceRow(iface);
            });
            html += '</div>';
        }

        // Front/Rear ports
        if (ports.length > 0) {
            html += '<div class="topo-detail-section">'
                + '<div class="topo-detail-section-title">'
                + '<span class="topo-detail-section-icon" style="background:#ff9800;"></span>'
                + 'Ports <span class="topo-detail-section-count">' + ports.length + '</span>'
                + '</div>';
            ports.forEach(function(port) {
                html += '<div class="topo-iface-row">'
                    + '<div class="topo-iface-row-main">';
                if (port.cable_id && port.cable_color) {
                    html += '<span class="topo-iface-dot" style="background:' + App.escapeHtml(port.cable_color) + ';"></span>';
                } else {
                    html += '<span class="topo-iface-dot" style="background:transparent;border:1px solid var(--fp-border);"></span>';
                }
                html += '<a href="' + App.escapeHtml(port.url) + '" class="topo-iface-port-name">' + App.escapeHtml(port.name) + '</a>'
                    + '<span class="topo-iface-port-type">' + App.escapeHtml(port.port_type) + '</span>'
                    + '</div></div>';
            });
            html += '</div>';
        }

        if (interfaces.length === 0 && ports.length === 0) {
            html = '<div class="px-3 py-3 text-muted small text-center">No cabled interfaces</div>';
        }

        section.innerHTML = html;

        // Click to expand interface details
        section.querySelectorAll('.topo-iface-row.cabled').forEach(function(row) {
            row.addEventListener('click', function(e) {
                if (e.target.closest('a')) return; // Don't interfere with links
                var expandEl = row.querySelector('.topo-iface-expanded');
                if (expandEl) {
                    expandEl.remove();
                    row.classList.remove('expanded');
                    return;
                }
                // Find the interface data
                var cableId = parseInt(row.getAttribute('data-cable-id'));
                var iface = interfaces.find(function(i) { return i.cable_id === cableId; });
                if (!iface) return;

                row.classList.add('expanded');
                var detail = document.createElement('div');
                detail.className = 'topo-iface-expanded';

                var props = '';
                if (iface.type) props += '<div class="topo-iface-exp-row"><span>Type</span><span>' + App.escapeHtml(iface.type) + '</span></div>';
                if (iface.speed) props += '<div class="topo-iface-exp-row"><span>Speed</span><span>' + App.formatSpeed(iface.speed) + '</span></div>';
                if (iface.mode) props += '<div class="topo-iface-exp-row"><span>Mode</span><span>' + App.escapeHtml(iface.mode) + '</span></div>';
                if (iface.lag) props += '<div class="topo-iface-exp-row"><span>LAG</span><span>' + App.escapeHtml(iface.lag) + '</span></div>';
                if (iface.cable_label) props += '<div class="topo-iface-exp-row"><span>Cable</span><span>' + App.escapeHtml(iface.cable_label) + '</span></div>';
                if (iface.cable_type) props += '<div class="topo-iface-exp-row"><span>Cable Type</span><span>' + App.escapeHtml(iface.cable_type) + '</span></div>';
                if (iface.connected_to) {
                    props += '<div class="topo-iface-exp-row"><span>Remote</span><span>'
                        + App.escapeHtml(iface.connected_to.device) + ' : ' + App.escapeHtml(iface.connected_to.port)
                        + '</span></div>';
                }
                props += '<div class="topo-iface-exp-row"><a href="' + App.escapeHtml(iface.url) + '" class="topo-iface-exp-link">View in NetBox \u2192</a></div>';

                detail.innerHTML = props;
                row.appendChild(detail);
            });
        });
    };

    Detail.prototype._renderIfaceRow = function(iface) {
        var speedColor = iface.speed ? App.speedColor(iface.speed) : '#6c757d';
        var html = '<div class="topo-iface-row' + (iface.cable_id ? ' cabled' : '') + '"'
            + (iface.cable_id ? ' data-cable-id="' + iface.cable_id + '"' : '') + '>';

        // Main row
        html += '<div class="topo-iface-row-main">';

        // Cable color dot
        if (iface.cable_id && iface.cable_color) {
            html += '<span class="topo-iface-dot" style="background:' + App.escapeHtml(iface.cable_color) + ';"></span>';
        } else if (iface.cable_id) {
            html += '<span class="topo-iface-dot" style="background:#6c757d;"></span>';
        } else {
            html += '<span class="topo-iface-dot empty"></span>';
        }

        // Name
        html += '<a href="' + App.escapeHtml(iface.url) + '" class="topo-iface-port-name">' + App.escapeHtml(iface.name) + '</a>';

        // Speed pill
        if (iface.speed) {
            html += '<span class="topo-iface-speed-pill" style="background:' + speedColor + '20;color:' + speedColor + ';">'
                + App.formatSpeed(iface.speed) + '</span>';
        }

        html += '</div>';

        // Connection info (second line)
        if (iface.connected_to) {
            html += '<div class="topo-iface-row-connection">'
                + '<i class="mdi mdi-arrow-right-thin"></i> '
                + '<a href="#" data-goto-device="' + iface.connected_to.device_id + '" class="topo-iface-remote">'
                + App.escapeHtml(iface.connected_to.device)
                + '</a>'
                + '<span class="topo-iface-remote-port">' + App.escapeHtml(iface.connected_to.port) + '</span>';
            if (iface.cable_label) {
                html += '<span class="topo-iface-cable-label">' + App.escapeHtml(iface.cable_label) + '</span>';
            }
            html += '</div>';
        }

        html += '</div>';
        return html;
    };

    Detail.prototype._appendError = function(msg) {
        var section = document.getElementById('topo-interfaces-section');
        if (section) {
            section.innerHTML = '<div class="px-3 py-3 text-danger small">' + App.escapeHtml(msg) + '</div>';
        }
    };

    Detail.prototype._prop = function(label, value) {
        return '<div class="topo-detail-prop">'
            + '<span class="topo-detail-prop-label">' + App.escapeHtml(label) + '</span>'
            + '<span class="topo-detail-prop-value">' + (value || '\u2014') + '</span>'
            + '</div>';
    };

    Detail.prototype._clear = function() {
        if (this.contentEl) this.contentEl.innerHTML = '';
    };

    App.Detail = Detail;

})(TopologyApp);
