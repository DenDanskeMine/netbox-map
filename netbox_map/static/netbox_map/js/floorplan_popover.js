/**
 * FloorplanApp Popover — Hover popovers with configurable fields and cable traces.
 * Depends on: floorplan_core.js
 */
(function(App) {
    'use strict';

    function Popover(state, events) {
        this.state = state;
        this.events = events;
        this.popoverEl = document.getElementById('tile-popover');
        this.container = document.getElementById('floorplan-container');
        this.visible = false;
        this.hoverTile = null;

        // Listen for hover events from Interaction module
        var self = this;
        events.on('hover', function(data) {
            if (data.tile) {
                self.hoverTile = data.tile;
                self.show(data.tile, data.x, data.y);
            } else {
                self.hide();
            }
        });
    }

    // ─── Show / Hide ──────────────────────────────────────────────

    Popover.prototype.show = function(tile, mouseX, mouseY) {
        if (!this.popoverEl) return;
        var s = this.state;

        // Resolve the field list for this tile type
        var typeKey = tile.type || 'default';
        var activeFields = s.popoverConfig[typeKey] || s.popoverConfig['default'];

        var lines = [];
        var self = this;

        for (var fi = 0; fi < activeFields.length; fi++) {
            var fieldKey = activeFields[fi];

            // Handle custom field keys (cf_xxx)
            if (fieldKey.startsWith('cf_')) {
                var cfName = fieldKey.substring(3);
                if (tile.custom_fields && tile.custom_fields[cfName]) {
                    var cfLabel = cfName.replace(/_/g, ' ').replace(/\b\w/g, function(c) { return c.toUpperCase(); });
                    lines.push('<span class="popover-dim">' + cfLabel + ':</span> ' + tile.custom_fields[cfName]);
                }
                continue;
            }

            switch (fieldKey) {
                case 'label':
                    lines.push('<strong>' + (tile.label || tile.type) + '</strong>');
                    break;
                case 'object_info':
                    if (tile.object_type && tile.object_name) {
                        lines.push('<span class="popover-dim">' + tile.object_type + ':</span> ' + tile.object_name);
                    }
                    break;
                case 'primary_ip':
                    if (tile.primary_ip) {
                        lines.push('<span class="popover-dim">IP:</span> ' + tile.primary_ip);
                    }
                    break;
                case 'mac':
                    if (tile.mac) {
                        lines.push('<span class="popover-dim">MAC:</span> ' + tile.mac);
                    }
                    break;
                case 'utilization':
                    if (tile.utilization !== null && tile.utilization !== undefined) {
                        lines.push('<span class="popover-dim">Util:</span> ' + Math.round(tile.utilization) + '%');
                    }
                    break;
                case 'position':
                    lines.push('<span class="popover-dim">Pos:</span> ' + tile.x + ', ' + tile.y);
                    break;
                case 'size':
                    lines.push('<span class="popover-dim">Size:</span> ' + tile.w + '&times;' + tile.h);
                    break;
                case 'status':
                    if (tile.status) {
                        lines.push('<span class="popover-dim">Status:</span> ' + tile.status);
                    }
                    break;
                case 'type':
                    if (tile.type) {
                        lines.push('<span class="popover-dim">Type:</span> ' + tile.type);
                    }
                    break;
                case 'orientation':
                    if (tile.orientation !== undefined && tile.orientation !== null) {
                        lines.push('<span class="popover-dim">Orientation:</span> ' + tile.orientation + '&deg;');
                    }
                    break;
                case 'cable_trace':
                case 'cable_trace_full':
                    this._handleTraceField(tile, fieldKey, lines, mouseX, mouseY);
                    break;
            }
        }

        // Fallback: always show at least the label
        if (lines.length === 0) {
            lines.push('<strong>' + (tile.label || tile.type) + '</strong>');
        }

        // Check if full trace content is present
        var joinedHtml = lines.join('<br>');
        var hasFullTrace = joinedHtml.indexOf('pt-section') !== -1;
        this.popoverEl.classList.toggle('popover-has-trace', hasFullTrace);

        this.popoverEl.innerHTML = joinedHtml;
        this.popoverEl.style.display = 'block';

        // Position with edge-flip to stay within container
        this._position(mouseX, mouseY);
        this.visible = true;
    };

    Popover.prototype.hide = function() {
        if (this.popoverEl) {
            this.popoverEl.style.display = 'none';
            this.popoverEl.classList.remove('popover-has-trace');
        }
        this.visible = false;
        this.hoverTile = null;
    };

    // ─── Cable Trace Fields ───────────────────────────────────────

    Popover.prototype._handleTraceField = function(tile, fieldKey, lines, mouseX, mouseY) {
        var traceModel = tile.object_type_model;
        var hasTraceSource = (traceModel && (traceModel === 'device' || traceModel === 'rearport' || traceModel === 'frontport') && tile.object_id) || tile.type === 'drop';

        if (!hasTraceSource) return;

        if (tile._cachedTrace) {
            var renderer = (fieldKey === 'cable_trace_full') ? this._renderTraceFull : this._renderTraceSimple;
            var traceHtml = renderer(tile._cachedTrace);
            if (traceHtml) lines.push(traceHtml);
        } else if (!tile._traceLoading) {
            tile._traceLoading = true;
            lines.push('<span class="popover-dim">Cable trace:</span> Loading...');
            var self = this;
            var s = this.state;

            // AJAX fetch cable trace data
            var url = tile.type === 'drop'
                ? s.detailBaseUrl + 'drop/' + tile.id + '/'
                : s.detailBaseUrl + traceModel + '/' + tile.object_id + '/';

            fetch(url, { credentials: 'same-origin' })
            .then(function(r) { return r.ok ? r.json() : null; })
            .then(function(data) {
                tile._traceLoading = false;
                tile._cachedTrace = (data && data.interfaces) ? data.interfaces : [];
                // Re-render popover if still hovering the same tile
                if (self.hoverTile === tile && self.visible) {
                    self.show(tile, mouseX, mouseY);
                }
            })
            .catch(function() {
                tile._traceLoading = false;
                tile._cachedTrace = [];
            });
        }
    };

    // ─── Trace Renderers ──────────────────────────────────────────

    /** Compact trace: port name -> final endpoint device, max 5 lines. */
    Popover.prototype._renderTraceSimple = function(interfaces) {
        if (!interfaces || interfaces.length === 0) return '';
        var traceLines = [];
        var limit = Math.min(interfaces.length, 5);

        for (var i = 0; i < limit; i++) {
            var iface = interfaces[i];
            var source = '';
            var dest = '';
            var destRack = '';
            if (iface.trace && iface.trace.length > 0) {
                // Extract source from first hop's near_end
                var firstHop = iface.trace[0];
                if (firstHop.near_end && firstHop.near_end.device) {
                    source = firstHop.near_end.device;
                }
                // Extract destination from last hop's far_end
                var lastHop = iface.trace[iface.trace.length - 1];
                if (lastHop.far_end && lastHop.far_end.device) {
                    dest = lastHop.far_end.device;
                    destRack = lastHop.far_end.device_rack || '';
                }
            }
            var portName = '<span class="popover-dim">' + App.escapeHtml(iface.name) + '</span>';
            var rackSuffix = destRack ? ' <span class="popover-dim">(' + App.escapeHtml(destRack) + ')</span>' : '';
            if (source && dest) {
                // Bidirectional: Source ← Port → Dest (Rack)
                traceLines.push(App.escapeHtml(source) + ' &larr; ' + portName + ' &rarr; ' + App.escapeHtml(dest) + rackSuffix);
            } else if (dest) {
                traceLines.push(portName + ' &rarr; ' + App.escapeHtml(dest) + rackSuffix);
            } else if (source) {
                traceLines.push(App.escapeHtml(source) + ' &larr; ' + portName);
            } else {
                traceLines.push(portName + ' &rarr; <em>?</em>');
            }
        }
        if (interfaces.length > 5) {
            traceLines.push('<span class="popover-dim">... and ' + (interfaces.length - 5) + ' more</span>');
        }
        return traceLines.join('<br>');
    };

    /** Full NetBox-style trace: device -> port -> cable -> port -> device. Max 3 interfaces. */
    Popover.prototype._renderTraceFull = function(interfaces) {
        if (!interfaces || interfaces.length === 0) return '';
        var html = '<div class="pt-section">';
        var limit = Math.min(interfaces.length, 3);

        for (var i = 0; i < limit; i++) {
            var iface = interfaces[i];
            html += '<div class="pt-iface">';
            html += '<div class="pt-iface-header"><i class="mdi ' + App.portTypeIcon(iface.type) + '"></i> ' + App.escapeHtml(iface.name) + '</div>';

            if (iface.trace && iface.trace.length > 0) {
                var path = App.buildTracePath(iface.trace);
                html += '<div class="pt-path">';
                for (var p = 0; p < path.length; p++) {
                    var node = path[p];
                    if (node.kind === 'device') {
                        var roleClass = 'pt-dev-' + node.role;
                        html += '<div class="pt-device ' + roleClass + '">';
                        html += '<i class="mdi mdi-server"></i> ' + App.escapeHtml(node.data.device || node.data.name);
                        if (node.data.device_rack) {
                            html += ' <span class="popover-dim">(' + App.escapeHtml(node.data.device_rack) + ')</span>';
                        }
                        html += '</div>';
                    } else if (node.kind === 'port') {
                        html += '<div class="pt-port">';
                        html += '<i class="mdi ' + App.portTypeIcon(node.data.type) + '"></i>';
                        html += App.escapeHtml(node.data.name);
                        html += '</div>';
                    } else if (node.kind === 'cable') {
                        html += '<div class="pt-cable">';
                        html += '<i class="mdi mdi-cable-data"></i> ' + App.escapeHtml(node.data.label);
                        if (node.data.type_display) {
                            html += ' <span class="popover-dim">' + App.escapeHtml(node.data.type_display) + '</span>';
                        }
                        html += '</div>';
                    }
                }
                html += '</div>'; // pt-path
            } else {
                html += '<div class="popover-dim">No trace</div>';
            }
            html += '</div>'; // pt-iface
            if (i < limit - 1) html += '<hr class="pt-separator">';
        }

        if (interfaces.length > 3) {
            html += '<div class="pt-overflow">... and ' + (interfaces.length - 3) + ' more</div>';
        }
        html += '</div>'; // pt-section
        return html;
    };

    // ─── Positioning ──────────────────────────────────────────────

    Popover.prototype._position = function(mouseX, mouseY) {
        if (!this.popoverEl || !this.container) return;

        var cRect = this.container.getBoundingClientRect();
        var offsetX = 14;
        var offsetY = 14;
        var left = mouseX + offsetX;
        var top = mouseY + offsetY;

        // Measure after making visible
        var pw = this.popoverEl.offsetWidth;
        var ph = this.popoverEl.offsetHeight;

        if (left + pw > cRect.width) {
            left = mouseX - pw - 6;
        }
        if (top + ph > cRect.height) {
            top = mouseY - ph - 6;
        }
        if (left < 0) left = 4;
        if (top < 0) top = 4;

        this.popoverEl.style.left = left + 'px';
        this.popoverEl.style.top = top + 'px';
    };

    App.Popover = Popover;

})(window.FloorplanApp);
