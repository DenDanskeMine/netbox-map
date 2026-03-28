/* NetBox Map — Topology Detail Module */
/* Device detail panel with interface and port listings */

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

        // Show device info immediately
        this._renderDeviceInfo(node);

        // Check cache for interfaces
        if (this.cache[node.device_id]) {
            this._renderInterfaces(this.cache[node.device_id]);
            return;
        }

        // Fetch interfaces via AJAX
        var url = this.state.deviceDetailUrl + node.device_id + '/';
        this.api.get(url).then(function(data) {
            self.cache[node.device_id] = data;
            self._renderInterfaces(data);
        }).catch(function(err) {
            self._appendError('Failed to load interfaces');
        });
    };

    Detail.prototype._renderDeviceInfo = function(node) {
        if (!this.contentEl) return;

        var html = '<div class="topo-detail-section">'
            + '<div class="topo-detail-section-title">Device</div>'
            + this._row('Name', '<a href="' + App.escapeHtml(node.url) + '">' + App.escapeHtml(node.name) + '</a>')
            + this._row('Type', node.device_type)
            + this._row('Role', '<span style="color:' + App.escapeHtml(node.role_color) + ';">\u25CF</span> ' + App.escapeHtml(node.role))
            + this._row('Status', node.status);

        if (node.primary_ip) html += this._row('Primary IP', node.primary_ip);
        if (node.site) html += this._row('Site', node.site);
        if (node.location) html += this._row('Location', node.location);
        if (node.rack) html += this._row('Rack', node.rack);
        if (node.tenant) html += this._row('Tenant', node.tenant);
        if (node.manufacturer) html += this._row('Manufacturer', node.manufacturer);
        if (node.virtual_chassis) html += this._row('Virtual Chassis', node.virtual_chassis);

        html += '</div>';

        // Loading placeholder for interfaces
        html += '<div class="topo-detail-section" id="topo-interfaces-section">'
            + '<div class="topo-detail-section-title">Interfaces</div>'
            + '<div class="text-center py-3"><div class="spinner-border spinner-border-sm text-primary"></div></div>'
            + '</div>';

        this.contentEl.innerHTML = html;
    };

    Detail.prototype._renderInterfaces = function(data) {
        var section = document.getElementById('topo-interfaces-section');
        if (!section) return;

        var interfaces = data.interfaces || [];
        var ports = data.ports || [];

        var html = '<div class="topo-detail-section-title">'
            + 'Interfaces (' + interfaces.length + ')'
            + '</div>';

        if (interfaces.length === 0) {
            html += '<div class="px-2 py-2 text-muted small">No interfaces</div>';
        } else {
            // Group: connected first, then unconnected
            var connected = interfaces.filter(function(i) { return i.cable_id; });
            var unconnected = interfaces.filter(function(i) { return !i.cable_id; });

            if (connected.length > 0) {
                html += '<div class="px-2 py-1 small text-muted fw-semibold" style="font-size:10px;">CONNECTED (' + connected.length + ')</div>';
                connected.forEach(function(iface) {
                    html += this._renderIfaceItem(iface);
                }.bind(this));
            }

            if (unconnected.length > 0) {
                html += '<div class="px-2 py-1 small text-muted fw-semibold" style="font-size:10px;">UNCONNECTED (' + unconnected.length + ')</div>';
                unconnected.forEach(function(iface) {
                    html += this._renderIfaceItem(iface);
                }.bind(this));
            }
        }

        // Front/Rear ports
        if (ports.length > 0) {
            html += '<div class="topo-detail-section-title mt-2">Ports (' + ports.length + ')</div>';
            ports.forEach(function(port) {
                html += '<div class="topo-iface-item">';
                if (port.cable_id && port.cable_color) {
                    html += '<span class="topo-iface-cable" style="background:' + App.escapeHtml(port.cable_color) + ';"></span>';
                } else if (port.cable_id) {
                    html += '<span class="topo-iface-cable" style="background:#6c757d;"></span>';
                } else {
                    html += '<span class="topo-iface-cable" style="background:transparent;border:1px solid var(--fp-border);"></span>';
                }
                html += '<span class="topo-iface-name"><a href="' + App.escapeHtml(port.url) + '">' + App.escapeHtml(port.name) + '</a></span>';
                html += '<span class="topo-iface-type">' + App.escapeHtml(port.port_type) + ' \u2022 ' + App.escapeHtml(port.type) + '</span>';
                html += '</div>';
            });
        }

        section.innerHTML = html;
    };

    Detail.prototype._renderIfaceItem = function(iface) {
        var html = '<div class="topo-iface-item">';

        // Cable color dot
        if (iface.cable_id && iface.cable_color) {
            html += '<span class="topo-iface-cable" style="background:' + App.escapeHtml(iface.cable_color) + ';"></span>';
        } else if (iface.cable_id) {
            html += '<span class="topo-iface-cable" style="background:#6c757d;"></span>';
        } else {
            html += '<span class="topo-iface-cable" style="background:transparent;border:1px solid var(--fp-border);"></span>';
        }

        // Interface name
        html += '<span class="topo-iface-name"><a href="' + App.escapeHtml(iface.url) + '">' + App.escapeHtml(iface.name) + '</a></span>';

        // Type
        html += '<span class="topo-iface-type">' + App.escapeHtml(iface.type) + '</span>';

        // Speed badge
        if (iface.speed) {
            html += '<span class="topo-iface-speed ' + App.speedClass(iface.speed) + '">'
                + App.formatSpeed(iface.speed) + '</span>';
        }

        // Connected to
        if (iface.connected_to) {
            html += '<span class="topo-iface-connected">'
                + '\u2192 <a href="#" data-goto-device="' + iface.connected_to.device_id + '">'
                + App.escapeHtml(iface.connected_to.device) + ':' + App.escapeHtml(iface.connected_to.port)
                + '</a></span>';
        }

        html += '</div>';
        return html;
    };

    Detail.prototype._appendError = function(msg) {
        var section = document.getElementById('topo-interfaces-section');
        if (section) {
            section.innerHTML = '<div class="topo-detail-section-title">Interfaces</div>'
                + '<div class="px-2 py-2 text-danger small">' + App.escapeHtml(msg) + '</div>';
        }
    };

    Detail.prototype._row = function(label, value) {
        return '<div class="topo-detail-row">'
            + '<span class="topo-detail-label">' + App.escapeHtml(label) + '</span>'
            + '<span class="topo-detail-value">' + (value || '\u2014') + '</span>'
            + '</div>';
    };

    Detail.prototype._clear = function() {
        if (this.contentEl) this.contentEl.innerHTML = '';
    };

    App.Detail = Detail;

})(TopologyApp);
