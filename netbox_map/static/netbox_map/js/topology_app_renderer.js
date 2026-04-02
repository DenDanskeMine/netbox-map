/* NetBox Map — Application Topology Renderer v3 */
/* Orthogonal routing, port-anchored edges, compact identity cards */

(function(App) {
    'use strict';

    /* ── Constants ── */
    var CARD_W    = 200;
    var CARD_R    = 5;
    var HEADER_H  = 36;     // name + subtitle area
    var PORT_H    = 16;     // height per port row
    var PORT_GAP  = 1;
    var PORT_PAD  = 4;      // padding above/below port block
    var ACCENT_W  = 4;      // left criticality bar
    var STATUS_R  = 3.5;    // status dot radius

    /* ── Constructor ── */

    function AppRenderer(state, events, base) {
        this.state   = state;
        this.events  = events;
        this.base    = base;
        this._nodes  = null;
        this._edges  = null;
        this._cards  = null;
        this._lines  = null;
        this._byId   = {};
        this._portMap = {};   // portId → node
        this._arrowCache = {};
    }

    /* ══════════════════════════════════════════
       Public API (matches Renderer interface)
       ══════════════════════════════════════════ */

    AppRenderer.prototype.render = function(rawNodes, rawEdges) {
        var self = this;

        // ── Filter: apps + dependency edges only ──
        var nodes = [], edges = [];
        rawNodes.forEach(function(n) {
            if (n.node_type === 'application') nodes.push(Object.assign({}, n, { ports: (n.ports || []).slice() }));
        });
        rawEdges.forEach(function(e) {
            if (e.edge_type === 'dependency') edges.push(Object.assign({}, e));
        });

        // ── Build lookups + port structures ──
        this._byId = {};
        this._portMap = {};
        nodes.forEach(function(n) {
            self._buildPorts(n);
            self._byId[n.id] = n;
        });

        // Drop edges with missing endpoints
        edges = edges.filter(function(e) {
            var s = typeof e.source === 'object' ? e.source.id : e.source;
            var t = typeof e.target === 'object' ? e.target.id : e.target;
            return self._byId[s] && self._byId[t];
        });

        this._nodes = nodes;
        this._edges = edges;

        // ── Layout → Assign port sides → Draw → Sync ──
        this._dagreLayout(nodes, edges);
        this._assignPortSides(edges);
        this._paint(nodes, edges);

        this.base.nodeElements    = this._cards;
        this.base.edgeElements    = this._lines;
        this.base._stencilNodeData = this._nodes;
        this.base.fitToView();
    };

    AppRenderer.prototype.focusNode = function(id) {
        var n = this._byId[id];
        if (!n) return;
        var svg = this.base.svg, zoom = this.base.zoom;
        var w = svg.node().clientWidth  || 900;
        var h = svg.node().clientHeight || 600;
        svg.transition().duration(350).call(zoom.transform,
            d3.zoomIdentity.translate(w / 2 - (n.x + CARD_W / 2), h / 2 - (n.y + n._h / 2)).scale(1)
        );
        this._select(n);
    };

    /* ══════════════════════════════════════════
       Port Preparation
       ══════════════════════════════════════════ */

    AppRenderer.prototype._buildPorts = function(n) {
        var self = this;
        var byId = {};

        (n.ports || []).forEach(function(p) {
            if (p.port_class === 'section-header') return;
            byId[p.id] = p;
            self._portMap[p.id] = n;
        });

        n._portById = byId;
        n._portsL = [];
        n._portsR = [];

        // Worst-case height for dagre (all ports on one side)
        var portCount = Object.keys(byId).length;
        var portBlockH = portCount > 0 ? PORT_PAD + portCount * (PORT_H + PORT_GAP) + PORT_PAD : 0;
        n._h = Math.max(44, HEADER_H + portBlockH);
        n._cardH = n._h;
    };

    /* Assign port sides AFTER layout based on connected card positions */
    AppRenderer.prototype._assignPortSides = function(edges) {
        var self = this;

        // Reset per-side lists
        this._nodes.forEach(function(n) { n._portsL = []; n._portsR = []; });

        // Clear previous assignment
        this._nodes.forEach(function(n) {
            Object.keys(n._portById).forEach(function(pid) {
                delete n._portById[pid]._assigned;
            });
        });

        edges.forEach(function(e) {
            var srcId = typeof e.source === 'object' ? e.source.id : e.source;
            var tgtId = typeof e.target === 'object' ? e.target.id : e.target;
            var sn = self._byId[srcId];
            var tn = self._byId[tgtId];
            if (!sn || !tn) return;

            var srcRight = (sn.x + CARD_W / 2) < (tn.x + CARD_W / 2);

            // Source port: exits TOWARD target
            var sp = e.source_port ? sn._portById[e.source_port] : null;
            if (sp && !sp._assigned) {
                sp._assigned = true;
                sp._side = srcRight ? 'R' : 'L';
                (srcRight ? sn._portsR : sn._portsL).push(sp);
            }

            // Target port: enters FROM source
            var tp = e.target_port ? tn._portById[e.target_port] : null;
            if (tp && !tp._assigned) {
                tp._assigned = true;
                tp._side = srcRight ? 'L' : 'R';
                (srcRight ? tn._portsL : tn._portsR).push(tp);
            }
        });

        // Assign Y positions per side + recompute card height
        var portTopY = HEADER_H + PORT_PAD;
        this._nodes.forEach(function(n) {
            n._portsL.forEach(function(p, i) { p._y = portTopY + i * (PORT_H + PORT_GAP) + PORT_H / 2; });
            n._portsR.forEach(function(p, i) { p._y = portTopY + i * (PORT_H + PORT_GAP) + PORT_H / 2; });
            var maxPorts = Math.max(n._portsL.length, n._portsR.length);
            var blockH = maxPorts > 0 ? PORT_PAD + maxPorts * (PORT_H + PORT_GAP) + PORT_PAD : 0;
            n._h = Math.max(44, HEADER_H + blockH);
            n._cardH = n._h;
        });
    };

    /* ══════════════════════════════════════════
       Dagre Layout
       ══════════════════════════════════════════ */

    AppRenderer.prototype._dagreLayout = function(nodes, edges) {
        var g = new dagre.graphlib.Graph();
        g.setGraph({
            rankdir: 'LR',
            ranksep: 120,
            nodesep: 40,
            edgesep: 20,
            marginx: 50,
            marginy: 40,
            ranker: 'network-simplex'
        });
        g.setDefaultEdgeLabel(function() { return {}; });

        nodes.forEach(function(n) {
            g.setNode(n.id, { width: CARD_W, height: n._h });
        });
        edges.forEach(function(e) {
            var s = typeof e.source === 'object' ? e.source.id : e.source;
            var t = typeof e.target === 'object' ? e.target.id : e.target;
            if (g.hasNode(s) && g.hasNode(t)) {
                g.setEdge(t, s);   // reverse: providers rank LEFT
            }
        });

        dagre.layout(g);

        var saved = this.state.savedLayout || {};
        nodes.forEach(function(n) {
            var dn = g.node(n.id);
            if (!dn) return;
            var k = String(n.id);
            if (saved[k] && saved[k].x !== undefined) {
                n.x = saved[k].x;
                n.y = saved[k].y;
            } else {
                n.x = dn.x - CARD_W / 2;
                n.y = dn.y - n._h / 2;
            }
        });
    };

    /* ══════════════════════════════════════════
       Rendering
       ══════════════════════════════════════════ */

    AppRenderer.prototype._paint = function(nodes, edges) {
        var self = this;
        var root = this.base.g;
        root.select('.edge-layer').selectAll('*').remove();
        root.select('.node-layer').selectAll('*').remove();

        this._ensureMarkers();
        this._paintEdges(edges, root.select('.edge-layer'));
        this._paintCards(nodes, root.select('.node-layer'));
        this._bind(edges);
    };

    /* ── Markers (arrows) ── */

    AppRenderer.prototype._ensureMarkers = function() {
        var d = this.base.svg.select('defs');
        if (d.empty()) d = this.base.svg.append('defs');
        this._defs = d;
    };

    AppRenderer.prototype._filledArrow = function(hex) {
        hex = hex.replace('#', '');
        var id = 'afa-' + hex;
        if (!this._arrowCache[id]) {
            this._arrowCache[id] = true;
            this._defs.append('marker').attr('id', id)
                .attr('viewBox', '0 -4 8 8').attr('refX', 8).attr('refY', 0)
                .attr('markerWidth', 7).attr('markerHeight', 7).attr('orient', 'auto')
                .append('path').attr('d', 'M0,-3L8,0L0,3Z')
                .attr('fill', '#' + hex);
        }
        return 'url(#' + id + ')';
    };

    AppRenderer.prototype._openArrow = function(hex) {
        hex = hex.replace('#', '');
        var id = 'aoa-' + hex;
        if (!this._arrowCache[id]) {
            this._arrowCache[id] = true;
            this._defs.append('marker').attr('id', id)
                .attr('viewBox', '0 -4 8 8').attr('refX', 8).attr('refY', 0)
                .attr('markerWidth', 7).attr('markerHeight', 7).attr('orient', 'auto')
                .append('path').attr('d', 'M0,-3L8,0L0,3')
                .attr('fill', 'none').attr('stroke', '#' + hex)
                .attr('stroke-width', 1.2).attr('stroke-linejoin', 'round');
        }
        return 'url(#' + id + ')';
    };

    /* ── Edges (orthogonal routing) ── */

    AppRenderer.prototype._paintEdges = function(edges, layer) {
        var self = this;

        // Pre-compute channel offsets for parallel edges in the same gap
        this._computeChannels(edges);

        this._lines = layer.selectAll('.aedge')
            .data(edges).enter().append('path')
            .attr('class', function(d) {
                return 'aedge' + (d.dependency_type === 'soft' ? ' aedge-soft' : ' aedge-hard');
            })
            .attr('stroke', function(d) { return d.color || '#6c757d'; })
            .attr('d', function(d) { return self._orthoPath(d); })
            .attr('marker-end', function(d) {
                var c = (d.color || '#6c757d').replace('#', '');
                return d.dependency_type === 'soft' ? self._openArrow(c) : self._filledArrow(c);
            });

        this._lines.append('title').text(function(d) {
            return [d.source_port_name, '\u2192', d.target_port_name,
                    d.cable_label].filter(Boolean).join(' ');
        });
    };

    /* Channel computation: edges sharing the same column gap get stacked */
    AppRenderer.prototype._computeChannels = function(edges) {
        var self = this;
        var channels = {};

        edges.forEach(function(e) {
            var srcId = typeof e.source === 'object' ? e.source.id : e.source;
            var tgtId = typeof e.target === 'object' ? e.target.id : e.target;
            var sn = self._byId[srcId];
            var tn = self._byId[tgtId];
            if (!sn || !tn) return;

            // Group by the pair of cards (regardless of direction)
            var a = srcId < tgtId ? srcId : tgtId;
            var b = srcId < tgtId ? tgtId : srcId;
            var key = a + '|' + b;
            if (!channels[key]) channels[key] = [];
            channels[key].push(e);
        });

        Object.keys(channels).forEach(function(key) {
            var group = channels[key];
            group.forEach(function(e, i) {
                e._chIdx   = i;
                e._chTotal = group.length;
            });
        });
    };

    /* Orthogonal path with obstacle avoidance */
    AppRenderer.prototype._orthoPath = function(d) {
        var srcId = typeof d.source === 'object' ? d.source.id : d.source;
        var tgtId = typeof d.target === 'object' ? d.target.id : d.target;
        var sn = this._byId[srcId];
        var tn = this._byId[tgtId];
        if (!sn || !tn) return '';

        var sp = this._portY(d.source_port);
        var tp = this._portY(d.target_port);
        var sy = sn.y + (sp !== null ? sp : sn._h / 2);
        var ty = tn.y + (tp !== null ? tp : tn._h / 2);

        // Exit/entry sides based on relative position
        var sx, tx, exitRight;
        if (sn.x + CARD_W <= tn.x) {
            sx = sn.x + CARD_W; tx = tn.x; exitRight = true;
        } else if (tn.x + CARD_W <= sn.x) {
            sx = sn.x; tx = tn.x + CARD_W; exitRight = false;
        } else {
            exitRight = sn.x < tn.x;
            sx = exitRight ? sn.x + CARD_W : sn.x;
            tx = exitRight ? tn.x : tn.x + CARD_W;
        }

        // Channel offset for parallel edges
        var chOff = 0;
        if (d._chTotal > 1) {
            chOff = (d._chIdx - (d._chTotal - 1) / 2) * 8;
        }

        // Find a midX that doesn't intersect any card
        var candidateX = (sx + tx) / 2 + chOff;
        var minY = Math.min(sy, ty) - 4;
        var maxY = Math.max(sy, ty) + 4;
        var margin = 12;

        // Check if any card body overlaps the vertical segment
        var self = this;
        var blocked = true;
        var attempts = 0;
        while (blocked && attempts < 8) {
            blocked = false;
            self._nodes.forEach(function(n) {
                if (n.id === srcId || n.id === tgtId) return;
                // Does this card's X range contain candidateX?
                if (candidateX > n.x - margin && candidateX < n.x + CARD_W + margin) {
                    // Does the vertical segment Y range overlap the card?
                    if (maxY > n.y - margin && minY < n.y + n._h + margin) {
                        blocked = true;
                    }
                }
            });
            if (blocked) {
                // Shift toward the exit side
                if (exitRight) {
                    candidateX = sx + 20 + attempts * 12;
                } else {
                    candidateX = sx - 20 - attempts * 12;
                }
                attempts++;
            }
        }

        return 'M' + sx + ',' + sy
             + ' L' + candidateX + ',' + sy
             + ' L' + candidateX + ',' + ty
             + ' L' + tx + ',' + ty;
    };

    AppRenderer.prototype._portY = function(portId) {
        if (!portId) return null;
        var n = this._portMap[portId];
        if (!n) return null;
        var p = n._portById[portId];
        if (!p) return null;
        return p._y;
    };

    /* ── Cards ── */

    AppRenderer.prototype._paintCards = function(nodes, layer) {
        var self = this;

        var cards = layer.selectAll('.acard')
            .data(nodes).enter().append('g')
            .attr('class', 'acard')
            .attr('transform', function(d) { return 'translate(' + d.x + ',' + d.y + ')'; });

        this._cards = cards;

        // Shadow
        cards.append('rect').attr('class', 'acard-shadow')
            .attr('x', 1).attr('y', 1)
            .attr('width', CARD_W).attr('height', function(d) { return d._h; })
            .attr('rx', CARD_R);

        // Background
        cards.append('rect').attr('class', 'acard-bg')
            .attr('width', CARD_W).attr('height', function(d) { return d._h; })
            .attr('rx', CARD_R);

        // Left accent bar (criticality color)
        cards.append('rect').attr('class', 'acard-accent')
            .attr('y', CARD_R).attr('width', ACCENT_W)
            .attr('height', function(d) { return d._h - CARD_R * 2; })
            .attr('fill', function(d) { return d.criticality_color || d.role_color || '#6c757d'; });

        // Name (single line, bold)
        cards.append('text').attr('class', 'acard-name')
            .attr('x', ACCENT_W + 8).attr('y', 16)
            .each(function(d) {
                var t = d.name || '';
                if (t.length > 24) t = t.substring(0, 22) + '\u2026';
                d3.select(this).text(t);
            });

        // Status indicator: down=⚠red, degraded=●orange, healthy=●green
        cards.each(function(d) {
            var hs = d.host_status || 'healthy';
            if (hs === 'down') {
                d3.select(this).append('text').attr('class', 'acard-warn')
                    .attr('x', CARD_W - 14).attr('y', 17).text('\u26A0');
            } else if (hs === 'degraded') {
                d3.select(this).append('circle').attr('class', 'acard-status')
                    .attr('cx', CARD_W - 12).attr('cy', 13).attr('r', STATUS_R)
                    .attr('fill', '#e67e22');
            } else {
                d3.select(this).append('circle').attr('class', 'acard-status')
                    .attr('cx', CARD_W - 12).attr('cy', 13).attr('r', STATUS_R)
                    .attr('fill', App.statusColor(d.status_value));
            }
        });

        // Subtitle: host issue reason OR group · env
        cards.append('text')
            .attr('class', function(d) {
                var hs = d.host_status || 'healthy';
                return (hs === 'down' || hs === 'degraded') ? 'acard-alert' : 'acard-sub';
            })
            .attr('x', ACCENT_W + 8).attr('y', 30)
            .each(function(d) {
                var hs = d.host_status || 'healthy';
                var t;
                if (hs !== 'healthy' && d.host_down_reasons) {
                    var prefix = hs === 'degraded' ? 'degraded: ' : '';
                    var r = d.host_down_reasons;
                    t = prefix + (r.length === 1 ? r[0] + ' down' : r.length + ' hosts down');
                } else {
                    t = [d.group, d.environment].filter(Boolean).join(' \u00B7 ');
                }
                if (t.length > 30) t = t.substring(0, 28) + '\u2026';
                d3.select(this).text(t);
            });

        // Separator between header and ports
        // Separator (only if card has ports)
        cards.filter(function(d) {
            return d._portsL.length > 0 || d._portsR.length > 0;
        }).append('line').attr('class', 'acard-sep')
            .attr('x1', ACCENT_W).attr('x2', CARD_W)
            .attr('y1', HEADER_H).attr('y2', HEADER_H);

        // Port labels + dots on correct sides
        cards.each(function(d) {
            var g = d3.select(this);

            d._portsR.forEach(function(p) {
                g.append('text').attr('class', 'aport-label aport-out')
                    .attr('x', CARD_W - 6).attr('y', p._y + 3)
                    .attr('text-anchor', 'end')
                    .text(function() {
                        var t = p.name || '';
                        return t.length > 18 ? t.substring(0, 16) + '..' : t;
                    });
                g.append('circle').attr('class', 'aport-dot')
                    .attr('cx', CARD_W).attr('cy', p._y).attr('r', 3);
            });

            d._portsL.forEach(function(p) {
                g.append('text').attr('class', 'aport-label aport-in')
                    .attr('x', ACCENT_W + 6).attr('y', p._y + 3)
                    .text(function() {
                        var t = p.name || '';
                        return t.length > 18 ? t.substring(0, 16) + '..' : t;
                    });
                g.append('circle').attr('class', 'aport-dot')
                    .attr('cx', 0).attr('cy', p._y).attr('r', 3);
            });

            // Host count — pill below card, hover shows HTML popup with host names
            if (d.deploy_count > 0) {
                var label = d.deploy_count === 1 ? '1 host' : d.deploy_count + ' hosts';
                var bw = label.length * 5.5 + 10;
                var bx = CARD_W / 2 - bw / 2;
                var by = d._h;
                var badge = g.append('g').attr('class', 'acard-host-badge')
                    .attr('data-app-id', d.app_id);

                badge.append('rect').attr('class', 'host-pill')
                    .attr('x', bx).attr('y', by)
                    .attr('width', bw).attr('height', 13)
                    .attr('rx', 2);
                badge.append('text').attr('class', 'host-pill-text')
                    .attr('x', CARD_W / 2).attr('y', by + 10)
                    .attr('text-anchor', 'middle')
                    .text(label);
            }
        });
    };

    /* ══════════════════════════════════════════
       Interactions
       ══════════════════════════════════════════ */

    AppRenderer.prototype._bind = function(edges) {
        var self = this;
        if (!this._cards || !this._lines) return;

        // Click → select
        this._cards.on('click', function(ev, d) {
            ev.stopPropagation();
            self._select(d);
        });

        // Hover card → highlight its edges (suppressed during simulation)
        this._cards
            .on('mouseenter', function(ev, d) {
                if (self._simulationActive) return;
                self._lines.each(function(e) {
                    var s = typeof e.source === 'object' ? e.source.id : e.source;
                    var t = typeof e.target === 'object' ? e.target.id : e.target;
                    var hit = (s === d.id || t === d.id);
                    d3.select(this).classed('aedge-dim', !hit).classed('aedge-hi', hit);
                });
                self._cards.each(function(n) {
                    if (n.id === d.id) return;
                    var connected = edges.some(function(e) {
                        var s = typeof e.source === 'object' ? e.source.id : e.source;
                        var t = typeof e.target === 'object' ? e.target.id : e.target;
                        return (s === d.id && t === n.id) || (t === d.id && s === n.id);
                    });
                    d3.select(this).classed('acard-dim', !connected);
                });
            })
            .on('mouseleave', function() {
                if (self._simulationActive) return;
                self._lines.classed('aedge-dim', false).classed('aedge-hi', false);
                self._cards.classed('acard-dim', false);
            });

        // Hover edge → highlight just that edge
        this._lines
            .on('mouseenter', function() {
                self._lines.classed('aedge-dim', true);
                d3.select(this).classed('aedge-dim', false).classed('aedge-hi', true);
            })
            .on('mouseleave', function() {
                self._lines.classed('aedge-dim', false).classed('aedge-hi', false);
            });

        // Drag — matches network map: raw accumulation + snap + shift support
        this._cards.call(d3.drag()
            .on('start', function(ev, d) {
                d3.select(this).raise().classed('dragging', true);
                d._rawX = d.x;
                d._rawY = d.y;
                d._dragStartX = d.x;
                d._dragStartY = d.y;
            })
            .on('drag', function(ev, d) {
                d._rawX += ev.dx;
                d._rawY += ev.dy;

                if (self.state.snapToGrid || ev.sourceEvent.shiftKey) {
                    var gs = self.state.gridSize || 20;
                    d.x = Math.round(d._rawX / gs) * gs;
                    d.y = Math.round(d._rawY / gs) * gs;
                } else {
                    d.x = d._rawX;
                    d.y = d._rawY;
                }

                d3.select(this).attr('transform', 'translate(' + d.x + ',' + d.y + ')');

                // Sync to state.nodes
                var orig = self.state.nodes.find(function(n) { return n.id === d.id; });
                if (orig) { orig.x = d.x; orig.y = d.y; }

                // Redraw edges
                self._lines.attr('d', function(e) { return self._orthoPath(e); });
            })
            .on('end', function(ev, d) {
                d3.select(this).classed('dragging', false);
            })
        );

        // Host badge hover → popup with host names
        this._hostCache = this._hostCache || {};
        d3.selectAll('.acard-host-badge')
            .on('mouseenter', function(ev) {
                var el = d3.select(this);
                var appId = el.attr('data-app-id');
                if (!appId) return;
                ev.stopPropagation();

                // Position popup near the badge
                var rect = this.getBoundingClientRect();
                var popup = d3.select('body').append('div')
                    .attr('class', 'host-popup')
                    .style('left', rect.left + 'px')
                    .style('top', (rect.bottom + 4) + 'px');

                popup.append('div').attr('class', 'host-popup-title').text('Hosts');

                if (self._hostCache[appId]) {
                    self._renderHostPopup(popup, self._hostCache[appId]);
                } else {
                    popup.append('div').attr('class', 'host-popup-loading').text('Loading\u2026');
                    var url = self.state.appDetailUrl + appId + '/';
                    var api = new App.API(self.state);
                    api.get(url).then(function(data) {
                        self._hostCache[appId] = data.deployments || [];
                        popup.select('.host-popup-loading').remove();
                        self._renderHostPopup(popup, self._hostCache[appId]);
                    }).catch(function() {
                        popup.select('.host-popup-loading').text('Failed to load');
                    });
                }

                el.on('mouseleave.popup', function() {
                    d3.selectAll('.host-popup').remove();
                    el.on('mouseleave.popup', null);
                });
            });

        // Context menu
        this._cards.on('contextmenu', function(ev, d) {
            ev.preventDefault(); ev.stopPropagation();
            self._ctx(ev, d, edges);
        });

        // Deselect on background click
        this.base.svg.on('click.app', function() {
            self._cards.classed('selected', false);
            self.events.emit('node:deselect');
        });
    };

    AppRenderer.prototype._renderHostPopup = function(popup, deployments) {
        deployments.forEach(function(dep) {
            var row = popup.append('a')
                .attr('class', 'host-popup-row')
                .attr('href', '/dcim/devices/?q=' + encodeURIComponent(dep.host_name))
                .attr('target', '_blank');
            var dotColor = App.statusColor(dep.host_status || 'active');
            row.append('span').attr('class', 'host-popup-dot').style('background', dotColor);
            row.append('span').attr('class', 'host-popup-name').text(dep.host_name);
            row.append('span').attr('class', 'host-popup-role').text(dep.role);
        });
        if (deployments.length === 0) {
            popup.append('div').attr('class', 'host-popup-empty').text('No hosts');
        }
    };

    /* ══════════════════════════════════════════
       Failure Simulation
       ══════════════════════════════════════════ */

    AppRenderer.prototype.simulateFailure = function(nodeId) {
        var self = this;
        if (!this._cards || !this._lines) return;

        // Build reverse adjacency with dep type
        var reverseAdj = {};
        this._nodes.forEach(function(n) { reverseAdj[n.id] = []; });
        this._edges.forEach(function(e) {
            var s = typeof e.source === 'object' ? e.source.id : e.source;
            var t = typeof e.target === 'object' ? e.target.id : e.target;
            if (reverseAdj[t]) reverseAdj[t].push({ id: s, depType: e.dependency_type || 'hard' });
        });

        // BFS: track down vs degraded
        var down = new Set([nodeId]);      // fully down
        var degraded = new Set();           // degraded (soft dep or has failover)
        var visited = new Set([nodeId]);
        var queue = [{ id: nodeId, status: 'down' }];

        while (queue.length > 0) {
            var item = queue.shift();
            if (item.status === 'down' && !down.has(item.id)) down.add(item.id);
            if (item.status === 'degraded' && !down.has(item.id)) degraded.add(item.id);

            (reverseAdj[item.id] || []).forEach(function(dep) {
                if (visited.has(dep.id)) return;
                visited.add(dep.id);
                // Hard dep on a down node → down; soft dep or degraded source → degraded
                var newStatus = (item.status === 'down' && dep.depType === 'hard') ? 'down' : 'degraded';
                queue.push({ id: dep.id, status: newStatus });
            });
        }

        // Remove source from down/degraded sets (it gets its own class)
        down.delete(nodeId);

        this._simulationActive = true;

        // Apply visual states
        this._cards
            .classed('failure-source', function(d) { return d.id === nodeId; })
            .classed('failure-impacted', function(d) { return down.has(d.id); })
            .classed('failure-degraded', function(d) { return degraded.has(d.id); })
            .style('opacity', function(d) {
                if (d.id === nodeId || down.has(d.id) || degraded.has(d.id)) return 1;
                return 0.08;
            });

        // Edge highlighting
        var affected = new Set([nodeId]);
        down.forEach(function(id) { affected.add(id); });
        degraded.forEach(function(id) { affected.add(id); });

        this._lines.style('stroke-opacity', function(e) {
            var s = typeof e.source === 'object' ? e.source.id : e.source;
            var t = typeof e.target === 'object' ? e.target.id : e.target;
            return (affected.has(s) && affected.has(t)) ? 0.9 : 0.03;
        });

        // Impact summary
        this._showImpactSummary(nodeId, down, degraded);

        // Clear button
        this._addClearButton();
    };

    AppRenderer.prototype.clearSimulation = function() {
        this._simulationActive = false;
        if (this._cards) {
            this._cards
                .classed('failure-source', false)
                .classed('failure-impacted', false)
                .classed('failure-degraded', false)
                .style('opacity', null);
        }
        if (this._lines) {
            this._lines.style('stroke-opacity', null);
        }
        d3.selectAll('.sim-impact-summary').remove();
        d3.selectAll('.sim-clear-btn').remove();
    };

    AppRenderer.prototype._showImpactSummary = function(sourceId, down, degraded) {
        d3.selectAll('.sim-impact-summary').remove();
        var self = this;
        var srcNode = this._byId[sourceId];
        var counts = { critical: 0, high: 0, medium: 0, low: 0 };
        var allAffected = new Set();
        down.forEach(function(id) { allAffected.add(id); });
        degraded.forEach(function(id) { allAffected.add(id); });

        this._nodes.forEach(function(n) {
            if (allAffected.has(n.id)) counts[n.criticality || 'low']++;
        });

        var parts = [];
        if (counts.critical) parts.push(counts.critical + ' critical');
        if (counts.high) parts.push(counts.high + ' high');
        if (counts.medium) parts.push(counts.medium + ' medium');
        if (counts.low) parts.push(counts.low + ' low');

        var panel = d3.select('body').append('div').attr('class', 'sim-impact-summary');
        panel.append('div').attr('class', 'sim-title')
            .text('Failure: ' + (srcNode ? srcNode.name : sourceId));
        panel.append('div').attr('class', 'sim-body')
            .text(parts.join(', ') + ' affected');
        panel.append('div').attr('class', 'sim-detail')
            .text(down.size + ' down \u00B7 ' + degraded.size + ' degraded');
    };

    AppRenderer.prototype._addClearButton = function() {
        d3.selectAll('.sim-clear-btn').remove();
        var self = this;
        d3.select('body').append('button')
            .attr('class', 'sim-clear-btn')
            .text('Clear Simulation')
            .on('click', function() { self.clearSimulation(); });
    };

    AppRenderer.prototype._select = function(d) {
        this._cards.classed('selected', false);
        this._cards.filter(function(n) { return n.id === d.id; }).classed('selected', true);
        this.state.selectedNode = d;
        this.events.emit('node:select', d);
    };

    AppRenderer.prototype._ctx = function(ev, d, edges) {
        var self = this;
        d3.selectAll('.topo-context-menu').remove();
        var m = d3.select('body').append('div').attr('class', 'topo-context-menu')
            .style('left', ev.pageX + 'px').style('top', ev.pageY + 'px');

        m.append('div').attr('class', 'ctx-header').html('<strong>' + App.escapeHtml(d.name) + '</strong>');
        m.append('div').attr('class', 'ctx-divider');

        if (d.url) m.append('div').attr('class', 'ctx-item').text('Open in NetBox')
            .on('click', function() { window.open(d.url, '_blank'); m.remove(); });
        m.append('div').attr('class', 'ctx-item').text('Copy name')
            .on('click', function() { navigator.clipboard.writeText(d.name || ''); m.remove(); });

        m.append('div').attr('class', 'ctx-divider');

        if (!self._simulationActive) {
            m.append('div').attr('class', 'ctx-item ctx-danger').text('Simulate failure')
                .on('click', function() { self.simulateFailure(d.id); m.remove(); });
        } else {
            m.append('div').attr('class', 'ctx-item').text('Clear simulation')
                .on('click', function() { self.clearSimulation(); m.remove(); });
        }

        m.append('div').attr('class', 'ctx-item').text('Isolate connections')
            .on('click', function() {
                var s = new Set([d.id]);
                edges.forEach(function(e) {
                    var a = typeof e.source === 'object' ? e.source.id : e.source;
                    var b = typeof e.target === 'object' ? e.target.id : e.target;
                    if (a === d.id) s.add(b); if (b === d.id) s.add(a);
                });
                self.base.filterNodes(s); m.remove();
            });
        m.append('div').attr('class', 'ctx-item').text('Show all')
            .on('click', function() { self.base.filterNodes(null); m.remove(); });

        setTimeout(function() {
            d3.select('body').on('click.actx', function() { m.remove(); d3.select('body').on('click.actx', null); });
        }, 0);
    };

    App.AppRenderer = AppRenderer;
})(TopologyApp);
