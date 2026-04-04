/* NetBox Map — Application Topology Renderer v3 */
/* Orthogonal routing, port-anchored edges, compact identity cards */

(function(App) {
    'use strict';

    /* ── Constants ── */
    var CARD_W    = 220;
    var CARD_R    = 5;
    var HEADER_H  = 40;     // name + subtitle + pill area
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

        // ── Filter nodes/edges based on mode ──
        var isMixed = this.state.topologyMode === 'mixed';
        var nodes = [], edges = [];
        rawNodes.forEach(function(n) {
            if (n.node_type === 'application' || (isMixed && (n.node_type === 'device' || n.device_id))) {
                nodes.push(Object.assign({}, n, { ports: (n.ports || []).slice() }));
            }
        });
        rawEdges.forEach(function(e) {
            // In mixed mode, accept all edge types (dependency, deployed_on, cables)
            if (e.edge_type === 'dependency' || (isMixed && e.edge_type === 'deployed_on')) {
                edges.push(Object.assign({}, e));
            } else if (isMixed && !e.edge_type) {
                // Network cable edges have no edge_type field
                var copy = Object.assign({}, e);
                copy.edge_type = 'cable';
                edges.push(copy);
            }
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

    /**
     * Render app cards + edges as an OVERLAY on existing network content.
     * Does NOT clear SVG layers — appends to them.
     * Used by mixed mode after the network renderer has drawn devices + cables.
     */
    AppRenderer.prototype.renderOverlay = function(appNodes, appEdges, deviceNodes) {
        var self = this;

        // Prepare app nodes
        this._byId = {};
        this._portMap = {};
        var nodes = appNodes.map(function(n) { return Object.assign({}, n, { ports: (n.ports || []).slice() }); });
        nodes.forEach(function(n) {
            self._buildPorts(n);
            self._byId[n.id] = n;
        });

        // Also register device nodes in _byId for edge routing
        (deviceNodes || []).forEach(function(n) {
            if (!self._byId[n.id]) {
                self._byId[n.id] = n;
                // Compute height from ports
                var pc = (n.ports || []).length;
                n._h = 38 + pc * 27 + 10;
                if (pc === 0) n._h = 48;
                // Initialize port structures so _assignPortSides doesn't crash
                if (!n._portById) {
                    n._portById = {};
                    n._portsL = [];
                    n._portsR = [];
                    (n.ports || []).forEach(function(p) {
                        n._portById[p.id] = p;
                        self._portMap[p.id] = n;
                    });
                }
            }
        });

        // Filter edges to only those with valid endpoints
        var edges = appEdges.filter(function(e) {
            var s = typeof e.source === 'object' ? e.source.id : e.source;
            var t = typeof e.target === 'object' ? e.target.id : e.target;
            return self._byId[s] && self._byId[t];
        });

        this._nodes = nodes;
        this._edges = edges;

        // Layout app nodes using dagre (device positions are already set by network renderer)
        this._layoutOverlay(nodes, edges, deviceNodes);
        this._assignPortSides(edges);

        // Draw WITHOUT clearing — append to existing layers
        var root = this.base.g;
        this._ensureMarkers();
        this._paintEdges(edges, root.select('.edge-layer'));
        this._paintCards(nodes, root.select('.node-layer'));
        this._bind(edges);

        this.base._stencilNodeData = (this.base._stencilNodeData || []).concat(nodes);
        // Delay fitToView slightly to ensure SVG elements are rendered
        var base = this.base;
        setTimeout(function() { base.fitToView(); }, 50);
    };

    AppRenderer.prototype.focusNode = function(id) {
        var n = this._byId[id];
        if (!n) return;
        var svg = this.base.svg, zoom = this.base.zoom;
        var w = svg.node().clientWidth  || 900;
        var h = svg.node().clientHeight || 600;
        // Preserve current zoom level (minimum 1x)
        var currentTransform = d3.zoomTransform(svg.node());
        var scale = Math.max(currentTransform.k, 1);
        var cx = n.x + CARD_W / 2;
        var cy = n.y + (n._h || 44) / 2;
        svg.transition().duration(350).call(zoom.transform,
            d3.zoomIdentity.translate(w / 2 - cx * scale, h / 2 - cy * scale).scale(scale)
        );
        this._select(n);
    };

    /* ══════════════════════════════════════════
       Port Preparation
       ══════════════════════════════════════════ */

    AppRenderer.prototype._buildPorts = function(n) {
        // Device nodes: compact, no ports
        if (n.node_type === 'device') {
            n._portById = {};
            n._portsL = [];
            n._portsR = [];
            n._h = 44;
            n._cardH = 44;
            return;
        }

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
        var SECTION_HDR_H = 12;  // space for "DEPENDS ON" / "NEEDED BY" label
        var portTopY = HEADER_H + SECTION_HDR_H + PORT_PAD;
        this._nodes.forEach(function(n) {
            var hasPorts = n._portsL.length > 0 || n._portsR.length > 0;
            var top = hasPorts ? portTopY : HEADER_H + PORT_PAD;
            n._portsL.forEach(function(p, i) { p._y = top + i * (PORT_H + PORT_GAP) + PORT_H / 2; });
            n._portsR.forEach(function(p, i) { p._y = top + i * (PORT_H + PORT_GAP) + PORT_H / 2; });
            var maxPorts = Math.max(n._portsL.length, n._portsR.length);
            var blockH = maxPorts > 0 ? SECTION_HDR_H + PORT_PAD + maxPorts * (PORT_H + PORT_GAP) + PORT_PAD : 0;
            var footerH = (n.deploy_count > 0) ? 20 : 4;
            n._h = Math.max(44, HEADER_H + blockH + footerH);
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

    /* Layout for overlay mode — dagre for apps, offset to right of devices */
    AppRenderer.prototype._layoutOverlay = function(appNodes, edges, deviceNodes) {
        var self = this;
        var saved = this.state.savedLayout || {};

        if (appNodes.length === 0) return;

        // Find rightmost device edge + add small gap for app placement
        var maxDeviceX = 0;
        (deviceNodes || []).forEach(function(n) {
            if (n.x !== undefined && !isNaN(n.x)) {
                maxDeviceX = Math.max(maxDeviceX, n.x + 200);
            }
        });
        maxDeviceX += 60; // single gap between device area and app area
        if (maxDeviceX <= 60) maxDeviceX = 400;

        // Use dagre for app layout — same as app-only mode
        // This gives proper left-to-right dependency flow
        var g = new dagre.graphlib.Graph();
        g.setGraph({
            rankdir: 'LR',
            ranksep: 100,
            nodesep: 25,
            marginx: 0,
            marginy: 40,
            ranker: 'network-simplex'
        });
        g.setDefaultEdgeLabel(function() { return {}; });

        appNodes.forEach(function(n) {
            g.setNode(n.id, { width: CARD_W, height: n._h });
        });

        // Only dependency edges for layout (deployed_on handled by edges only)
        edges.forEach(function(e) {
            if (e.edge_type !== 'dependency') return;
            var s = typeof e.source === 'object' ? e.source.id : e.source;
            var t = typeof e.target === 'object' ? e.target.id : e.target;
            if (g.hasNode(s) && g.hasNode(t)) g.setEdge(t, s);
        });

        dagre.layout(g);

        // Apply dagre positions, offset to the right of all devices
        appNodes.forEach(function(n) {
            var key = String(n.id);
            if (saved[key] && saved[key].x !== undefined) {
                n.x = saved[key].x;
                n.y = saved[key].y;
            } else {
                var dn = g.node(n.id);
                if (dn) {
                    n.x = dn.x - CARD_W / 2 + maxDeviceX;
                    n.y = dn.y - n._h / 2;
                }
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

        var nodeLayer = root.select('.node-layer');
        var appNodes = nodes.filter(function(n) { return n.node_type === 'application'; });
        var deviceNodes = nodes.filter(function(n) { return n.node_type === 'device'; });

        this._paintCards(appNodes, nodeLayer);
        if (deviceNodes.length > 0) {
            this._paintDeviceCards(deviceNodes, nodeLayer);
            // Merge all cards into one selection for interactions
            this._cards = nodeLayer.selectAll('.acard, .dcard');
        }
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
                .attr('viewBox', '0 -3 5 6').attr('refX', 5).attr('refY', 0)
                .attr('markerWidth', 5).attr('markerHeight', 5).attr('orient', 'auto')
                .append('path').attr('d', 'M0,-2L5,0L0,2Z')
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
                .attr('viewBox', '0 -3 5 6').attr('refX', 5).attr('refY', 0)
                .attr('markerWidth', 5).attr('markerHeight', 5).attr('orient', 'auto')
                .append('path').attr('d', 'M0,-2L5,0L0,2')
                .attr('fill', 'none').attr('stroke', '#' + hex)
                .attr('stroke-width', 1).attr('stroke-linejoin', 'round');
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
                if (d.edge_type === 'deployed_on') return 'aedge aedge-deployed';
                if (d.edge_type === 'cable') return 'aedge aedge-cable';
                return 'aedge' + (d.dependency_type === 'soft' ? ' aedge-soft' : ' aedge-hard');
            })
            .attr('stroke', function(d) {
                return d.color || '#6c757d';
            })
            .attr('d', function(d) { return self._edgePath(d); })
            .attr('marker-end', function(d) {
                if (d.edge_type === 'deployed_on' || d.edge_type === 'cable') return null;
                var c = (d.color || '#6c757d').replace('#', '');
                return d.dependency_type === 'soft' ? self._openArrow(c) : self._filledArrow(c);
            });

        // Tooltips
        this._lines.append('title').text(function(d) {
            return [d.source_port_name, '\u2192', d.target_port_name,
                    d.cable_label].filter(Boolean).join(' ');
        });

        // Edge tooltips handled by hit paths (wider target area)
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

        // Find a midX that doesn't intersect any card (checks vertical AND horizontal segments)
        var candidateX = (sx + tx) / 2 + chOff;
        var margin = 10;
        var self = this;

        function isBlocked(mx) {
            var minY = Math.min(sy, ty);
            var maxY = Math.max(sy, ty);
            for (var i = 0; i < self._nodes.length; i++) {
                var n = self._nodes[i];
                if (n.id === srcId || n.id === tgtId) continue;
                var nl = n.x - margin, nr = n.x + CARD_W + margin;
                var nt = n.y - margin, nb = n.y + n._h + margin;

                // Vertical segment: x=mx, from minY to maxY
                if (mx > nl && mx < nr && maxY > nt && minY < nb) return true;

                // Horizontal segment from sx to mx at y=sy
                var hMinX = Math.min(sx, mx), hMaxX = Math.max(sx, mx);
                if (sy > nt && sy < nb && hMaxX > nl && hMinX < nr) return true;

                // Horizontal segment from mx to tx at y=ty
                var hMinX2 = Math.min(mx, tx), hMaxX2 = Math.max(mx, tx);
                if (ty > nt && ty < nb && hMaxX2 > nl && hMinX2 < nr) return true;
            }
            return false;
        }

        var attempts = 0;
        while (isBlocked(candidateX) && attempts < 12) {
            if (exitRight) {
                candidateX = sx + 16 + attempts * 14;
            } else {
                candidateX = sx - 16 - attempts * 14;
            }
            attempts++;
        }

        // Rounded corners at bends — radius clamped to available space
        var dyAbs = Math.abs(ty - sy);
        var dxAbs1 = Math.abs(candidateX - sx);
        var dxAbs2 = Math.abs(tx - candidateX);
        var r = Math.min(6, dyAbs / 2, dxAbs1, dxAbs2);

        if (r < 1 || dyAbs < 2) {
            // Too tight for curves — use straight lines
            return 'M' + sx + ',' + sy
                 + ' L' + candidateX + ',' + sy
                 + ' L' + candidateX + ',' + ty
                 + ' L' + tx + ',' + ty;
        }

        var dySign = ty > sy ? 1 : -1;
        var dxSign1 = candidateX > sx ? 1 : -1;
        var dxSign2 = tx > candidateX ? 1 : -1;

        return 'M' + sx + ',' + sy
             + ' L' + (candidateX - r * dxSign1) + ',' + sy
             + ' Q' + candidateX + ',' + sy + ' ' + candidateX + ',' + (sy + r * dySign)
             + ' L' + candidateX + ',' + (ty - r * dySign)
             + ' Q' + candidateX + ',' + ty + ' ' + (candidateX + r * dxSign2) + ',' + ty
             + ' L' + tx + ',' + ty;
    };

    /* Bezier path — smooth curves that naturally separate */
    AppRenderer.prototype._bezierPath = function(d) {
        var srcId = typeof d.source === 'object' ? d.source.id : d.source;
        var tgtId = typeof d.target === 'object' ? d.target.id : d.target;
        var sn = this._byId[srcId];
        var tn = this._byId[tgtId];
        if (!sn || !tn) return '';

        var sp = this._portY(d.source_port);
        var tp = this._portY(d.target_port);
        var sy = sn.y + (sp !== null ? sp : sn._h / 2);
        var ty = tn.y + (tp !== null ? tp : tn._h / 2);

        var sx, stx, sDir, tDir;
        if (sn.x + CARD_W <= tn.x) {
            sx = sn.x + CARD_W; stx = tn.x; sDir = 1; tDir = -1;
        } else if (tn.x + CARD_W <= sn.x) {
            sx = sn.x; stx = tn.x + CARD_W; sDir = -1; tDir = 1;
        } else {
            var exitRight = sn.x < tn.x;
            sx = exitRight ? sn.x + CARD_W : sn.x;
            stx = exitRight ? tn.x : tn.x + CARD_W;
            sDir = exitRight ? 1 : -1;
            tDir = exitRight ? -1 : 1;
        }

        var dxAbs = Math.abs(stx - sx);
        var cp = Math.max(dxAbs * 0.45, 60);

        return 'M' + sx + ',' + sy
             + ' C' + (sx + cp * sDir) + ',' + sy
             + ' ' + (stx + cp * tDir) + ',' + ty
             + ' ' + stx + ',' + ty;
    };

    /* Route dispatcher — picks ortho or bezier based on state */
    AppRenderer.prototype._edgePath = function(d) {
        return this.state.cableStyle === 'ortho' ? this._orthoPath(d) : this._bezierPath(d);
    };

    /* Switch edge style and re-render edges */
    AppRenderer.prototype.switchEdgeStyle = function(style) {
        this.state.cableStyle = style;
        var self = this;
        if (this._lines) {
            this._lines.attr('d', function(d) { return self._edgePath(d); });
        }
        // Update hit paths too
        this.base.g.selectAll('.aedge-hit').attr('d', function(d) { return self._edgePath(d); });
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
            .attr('class', function(d) { return 'acard' + (d.on_device ? ' acard-on-device' : ''); })
            .attr('transform', function(d) { return 'translate(' + d.x + ',' + d.y + ')'; });

        this._cards = cards;

        // Background rect
        cards.append('rect').attr('class', 'acard-bg')
            .attr('width', CARD_W).attr('height', function(d) { return d._h; })
            .attr('rx', CARD_R);

        // Left accent bar — group color, clipped inside rounded rect
        cards.each(function(d, i) {
            var gc = d.category_color || d.role_color || '';
            if (!gc) return;
            var clipId = 'aclip-' + d.id.replace(/[^a-z0-9]/gi, '');
            d3.select(this).append('clipPath').attr('id', clipId)
                .append('rect').attr('width', CARD_W).attr('height', d._h)
                .attr('rx', CARD_R).attr('ry', CARD_R);
            d3.select(this).append('rect')
                .attr('width', 3).attr('height', d._h)
                .attr('fill', gc).attr('opacity', 0.5)
                .attr('clip-path', 'url(#' + clipId + ')');
        });

        // ── Card internals ──
        cards.each(function(d) {
            var g = d3.select(this);
            var hs = d.host_status || 'healthy';
            var hasPorts = d._portsL.length > 0 || d._portsR.length > 0;

            // Row 1 (y=16): Name + status pill
            var nameText = d.name || '';
            var maxNameLen = (hs !== 'healthy') ? 18 : 24;  // shorter when pill present
            if (nameText.length > maxNameLen) nameText = nameText.substring(0, maxNameLen - 2) + '\u2026';
            g.append('text').attr('class', 'acard-name')
                .attr('x', 10).attr('y', 16).text(nameText);

            // Status pill — right side of row 1
            var statusLabel, statusClass;
            if (hs === 'down') {
                statusLabel = 'DOWN';
                statusClass = 'acard-pill-down';
            } else if (hs === 'degraded') {
                statusLabel = 'DEGRADED';
                statusClass = 'acard-pill-degraded';
            } else {
                statusLabel = '';  // no pill for healthy — clean
                statusClass = '';
            }
            if (statusLabel) {
                var pillW = statusLabel.length * 5.5 + 10;
                var pillX = CARD_W - pillW - 8;

                // Build tooltip explaining WHY this status
                var tooltip = statusLabel;
                var hostReasons = d.host_down_reasons || [];
                var depReasons = d.dep_down_reasons || [];
                var parts = [];
                if (hostReasons.length > 0) parts.push('Host offline: ' + hostReasons.join(', '));
                if (depReasons.length > 0) parts.push('Dependency down: ' + depReasons.join(', '));
                if (parts.length > 0) tooltip = parts.join('. ');

                var pillGroup = g.append('g').attr('class', 'acard-pill-group');
                pillGroup.append('rect').attr('class', 'acard-pill ' + statusClass)
                    .attr('x', pillX).attr('y', 5)
                    .attr('width', pillW).attr('height', 14)
                    .attr('rx', 3);
                pillGroup.append('text').attr('class', 'acard-pill-text ' + statusClass + '-text')
                    .attr('x', pillX + pillW / 2).attr('y', 15)
                    .attr('text-anchor', 'middle')
                    .text(statusLabel);
                pillGroup.append('title').text(tooltip);
            }

            // Row 2 (y=30): group · env
            var subText = [d.group, d.environment].filter(Boolean).join(' \u00B7 ');
            if (subText.length > 28) subText = subText.substring(0, 26) + '\u2026';
            g.append('text').attr('class', 'acard-sub')
                .attr('x', 10).attr('y', 30).text(subText);

            // Row 2 (right): short reason
            if (hs !== 'healthy') {
                var hostR = d.host_down_reasons || [];
                var depR = d.dep_down_reasons || [];
                var reasonText = '';
                if (hostR.length > 0) {
                    reasonText = hostR.length === 1 ? hostR[0] : hostR.length + ' hosts';
                } else if (depR.length > 0) {
                    reasonText = depR.length === 1 ? depR[0] : depR.length + ' deps';
                }
                if (reasonText) {
                    if (reasonText.length > 14) reasonText = reasonText.substring(0, 12) + '..';
                    g.append('text').attr('class', 'acard-reason')
                        .attr('x', CARD_W - 8).attr('y', 30)
                        .attr('text-anchor', 'end')
                        .text(reasonText);
                }
            }

            // ── Header / port separator ──
            if (hasPorts) {
                g.append('line').attr('class', 'acard-sep')
                    .attr('x1', 8).attr('x2', CARD_W - 8)
                    .attr('y1', HEADER_H).attr('y2', HEADER_H);
            }

            // ── Port table ──

            // Section headers
            if (d._portsL.length > 0) {
                g.append('text').attr('class', 'aport-section-hdr')
                    .attr('x', 8).attr('y', HEADER_H + 10)
                    .text('DEPENDS ON');
            }
            if (d._portsR.length > 0) {
                g.append('text').attr('class', 'aport-section-hdr')
                    .attr('x', CARD_W - 8).attr('y', HEADER_H + 10)
                    .attr('text-anchor', 'end')
                    .text('NEEDED BY');
            }

            // Collect all port Y positions from both sides to draw aligned rows
            var allPortYs = [];
            d._portsL.forEach(function(p) { allPortYs.push(p._y); });
            d._portsR.forEach(function(p) {
                // Only add if not already at this Y (avoid duplicates when both sides have same row count)
                if (allPortYs.indexOf(p._y) === -1) allPortYs.push(p._y);
            });
            allPortYs.sort(function(a, b) { return a - b; });

            // Full-width row backgrounds — aligned to actual port Y
            allPortYs.forEach(function(py, i) {
                g.append('rect')
                    .attr('class', i % 2 === 0 ? 'aport-row-even' : 'aport-row-odd')
                    .attr('x', 1).attr('y', py - PORT_H / 2)
                    .attr('width', CARD_W - 2).attr('height', PORT_H);
            });

            // Center divider between left/right columns
            if (d._portsL.length > 0 && d._portsR.length > 0 && allPortYs.length > 0) {
                g.append('line').attr('class', 'acard-col-div')
                    .attr('x1', CARD_W / 2).attr('x2', CARD_W / 2)
                    .attr('y1', allPortYs[0] - PORT_H / 2)
                    .attr('y2', allPortYs[allPortYs.length - 1] + PORT_H / 2);
            }

            // Left-side ports (DEPENDS ON)
            d._portsL.forEach(function(p) {
                g.append('text').attr('class', 'aport-label aport-in')
                    .attr('x', 8).attr('y', p._y + 3)
                    .text(function() {
                        var t = p.name || '';
                        return t.length > 12 ? t.substring(0, 10) + '..' : t;
                    });
                g.append('circle').attr('class', 'aport-tick')
                    .attr('cx', 0).attr('cy', p._y).attr('r', 2);
            });

            // Right-side ports (NEEDED BY)
            d._portsR.forEach(function(p) {
                g.append('text').attr('class', 'aport-label aport-out')
                    .attr('x', CARD_W - 8).attr('y', p._y + 3)
                    .attr('text-anchor', 'end')
                    .text(function() {
                        var t = p.name || '';
                        return t.length > 12 ? t.substring(0, 10) + '..' : t;
                    });
                g.append('circle').attr('class', 'aport-tick')
                    .attr('cx', CARD_W).attr('cy', p._y).attr('r', 2);
            });

            // ── Footer: host count inside the card ──
            if (d.deploy_count > 0) {
                var sepY = d._h - 20;
                // Footer separator
                g.append('line').attr('class', 'acard-sep')
                    .attr('x1', 8).attr('x2', CARD_W - 8)
                    .attr('y1', sepY).attr('y2', sepY);
                // Host count text — centered in the 20px footer area
                var hostLabel = d.deploy_count === 1 ? '1 host' : d.deploy_count + ' hosts';
                g.append('text').attr('class', 'acard-footer')
                    .attr('x', CARD_W / 2).attr('y', d._h - 7)
                    .attr('text-anchor', 'middle')
                    .text(hostLabel);
                // Store app_id for hover popup
                g.attr('data-app-id', d.app_id);
            }
        });
    };

    /* ── Device Cards (mixed mode) ── */

    AppRenderer.prototype._paintDeviceCards = function(nodes, layer) {
        var cards = layer.selectAll('.dcard')
            .data(nodes).enter().append('g')
            .attr('class', 'dcard')
            .attr('transform', function(d) { return 'translate(' + d.x + ',' + d.y + ')'; });

        // Background
        cards.append('rect').attr('class', 'dcard-bg')
            .attr('width', CARD_W).attr('height', 44)
            .attr('rx', CARD_R);

        // Device name
        cards.append('text').attr('class', 'dcard-name')
            .attr('x', 10).attr('y', 17)
            .each(function(d) {
                var t = d.name || '';
                if (t.length > 24) t = t.substring(0, 22) + '\u2026';
                d3.select(this).text(t);
            });

        // Status dot
        cards.each(function(d) {
            d3.select(this).append('circle').attr('class', 'dcard-status')
                .attr('cx', CARD_W - 10).attr('cy', 14).attr('r', 3)
                .attr('fill', App.statusColor(d.status_value));
        });

        // Device type subtitle
        cards.append('text').attr('class', 'dcard-sub')
            .attr('x', 10).attr('y', 32)
            .each(function(d) {
                var t = d.device_type || d.role || '';
                if (t.length > 28) t = t.substring(0, 26) + '\u2026';
                d3.select(this).text(t);
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

        // Drag — with 3px threshold to avoid accidental repositioning
        this._cards.call(d3.drag()
            .on('start', function(ev, d) {
                d._rawX = d.x;
                d._rawY = d.y;
                d._dragStartX = d.x;
                d._dragStartY = d.y;
                d._dragActive = false;
            })
            .on('drag', function(ev, d) {
                d._rawX += ev.dx;
                d._rawY += ev.dy;

                // 3px threshold before activating drag
                if (!d._dragActive) {
                    var dist = Math.abs(d._rawX - d._dragStartX) + Math.abs(d._rawY - d._dragStartY);
                    if (dist < 3) return;
                    d._dragActive = true;
                    d3.select(this).raise().classed('dragging', true);
                }

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

                // Redraw app edges only (don't touch network cables)
                self._lines.filter(function(e) {
                    return e.edge_type === 'dependency' || e.edge_type === 'deployed_on';
                }).attr('d', function(e) { return self._edgePath(e); });
            })
            .on('end', function(ev, d) {
                d3.select(this).classed('dragging', false);
                if (d._dragActive) {
                    // Reassign port sides after drag — only update app edges, not network cables
                    self._assignPortSides(edges);
                    self._lines.filter(function(e) {
                        return e.edge_type === 'dependency' || e.edge_type === 'deployed_on';
                    }).attr('d', function(e) { return self._edgePath(e); });
                }
            })
        );

        // Host footer hover → popup with host names
        this._hostCache = this._hostCache || {};
        d3.selectAll('.acard-footer')
            .on('mouseenter', function(ev) {
                var el = d3.select(this.parentNode);
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

                // Delayed removal so user can move cursor to popup
                var footerEl = this;
                var removeTimer = null;
                d3.select(footerEl).on('mouseleave.popup', function() {
                    removeTimer = setTimeout(function() {
                        d3.selectAll('.host-popup').remove();
                        d3.select(footerEl).on('mouseleave.popup', null);
                    }, 200);
                });
                popup.on('mouseenter', function() {
                    if (removeTimer) clearTimeout(removeTimer);
                }).on('mouseleave', function() {
                    d3.selectAll('.host-popup').remove();
                    d3.select(footerEl).on('mouseleave.popup', null);
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

        // P3-20: Invisible wider hit area for edges
        var hitLayer = this.base.g.select('.edge-layer');
        hitLayer.selectAll('.aedge-hit')
            .data(edges).enter().append('path')
            .attr('class', 'aedge-hit')
            .attr('d', function(d) { return self._edgePath(d); })
            .attr('fill', 'none')
            .attr('stroke', 'transparent')
            .attr('stroke-width', 12)
            .attr('pointer-events', 'stroke')
            .on('mouseenter', function(ev, d) {
                self._lines.classed('aedge-dim', true);
                self._lines.filter(function(e) { return e === d; })
                    .classed('aedge-dim', false).classed('aedge-hi', true);
                // Show tooltip
                var label = d.cable_label || d.dependency_type || '';
                if (label) {
                    d3.selectAll('.aedge-tooltip').remove();
                    d3.select('body').append('div')
                        .attr('class', 'aedge-tooltip')
                        .style('left', (ev.clientX + 12) + 'px')
                        .style('top', (ev.clientY - 24) + 'px')
                        .text(label);
                }
            })
            .on('mouseleave', function() {
                self._lines.classed('aedge-dim', false).classed('aedge-hi', false);
                d3.selectAll('.aedge-tooltip').remove();
            });

        // P3-19: Keyboard navigation
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') {
                // Clear simulation if active
                if (self._simulationActive) {
                    self.clearSimulation();
                    return;
                }
                // Dismiss context menu
                d3.selectAll('.topo-context-menu').remove();
                // Deselect
                self._cards.classed('selected', false);
                self.events.emit('node:deselect');
            }
            // Tab cycles through nodes
            if (e.key === 'Tab' && self._nodes && self._nodes.length > 0) {
                e.preventDefault();
                var current = self.state.selectedNode;
                var idx = current ? self._nodes.indexOf(current) : -1;
                var next = e.shiftKey
                    ? (idx <= 0 ? self._nodes.length - 1 : idx - 1)
                    : (idx + 1) % self._nodes.length;
                self.focusNode(self._nodes[next].id);
            }
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

        // View Dependencies — opens focused topology view
        if (d.node_type === 'application' && d.app_id) {
            m.append('div').attr('class', 'ctx-item')
                .html('<i class="mdi mdi-graph-outline"></i> View Dependencies')
                .on('click', function() {
                    window.location.href = '/plugins/map/topology/?mode=apps&focus_app=' + d.app_id;
                    m.remove();
                });
        } else if (d.device_id) {
            m.append('div').attr('class', 'ctx-item')
                .html('<i class="mdi mdi-graph-outline"></i> View Apps on Device')
                .on('click', function() {
                    window.location.href = '/plugins/map/topology/?mode=apps&device_ids=' + d.device_id + '&highlight_device=' + d.device_id;
                    m.remove();
                });
        }

        m.append('div').attr('class', 'ctx-divider');

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
