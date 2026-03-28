/* NetBox Map — Topology Renderer Module */
/* Node view (circles) and Stencil view (device cards with centered ports) */

(function(App) {
    'use strict';

    var CARD_W = 180;
    var HEADER_H = 38;
    var PORT_H = 24;          // height of each port container
    var PORT_GAP = 3;         // gap between port containers
    var PORT_TEXT_PAD = 12;   // text padding inside port container
    var CARD_PAD = 10;
    var LAYER_GAP_X = 480;
    var NODE_GAP_Y = 40;

    var ROLE_LAYER = {
        'firewall': 0, 'router': 1, 'core-switch': 2, 'core-router': 2,
        'distribution-switch': 3, 'access-switch': 4, 'patch-panel': 3, 'server': 5,
    };

    function getRoleLayer(slug) {
        if (!slug) return 5;
        if (ROLE_LAYER[slug] !== undefined) return ROLE_LAYER[slug];
        for (var k in ROLE_LAYER) { if (slug.indexOf(k) !== -1) return ROLE_LAYER[k]; }
        return 5;
    }

    function Renderer(state, events) {
        this.state = state;
        this.events = events;
        this.svg = null;
        this.g = null;
        this.zoom = null;
        this.simulation = null;
        this.nodeElements = null;
        this.edgeElements = null;
        this.width = 0;
        this.height = 0;
        this._stencilNodeData = null;
        this._stencilPortPos = null;
    }

    Renderer.prototype.init = function() {
        var self = this;
        this.svg = d3.select('#topology-svg');
        this._updateSize();
        this.g = this.svg.append('g');
        this.g.append('g').attr('class', 'edge-layer');
        this.g.append('g').attr('class', 'node-layer');

        this.zoom = d3.zoom().scaleExtent([0.02, 5])
            .on('zoom', function(ev) { self.g.attr('transform', ev.transform); });
        this.svg.call(this.zoom);
        this.svg.on('dblclick.zoom', null);
        this.svg.on('click', function(ev) {
            if (ev.target === self.svg.node()) {
                self._deselectAll(); self.events.emit('node:deselect');
            }
        });
    };

    Renderer.prototype._updateSize = function() {
        var r = this.svg.node().parentElement.getBoundingClientRect();
        this.width = r.width || 800; this.height = r.height || 600;
        this.svg.attr('width', this.width).attr('height', this.height);
    };

    Renderer.prototype.render = function(nodes, edges) {
        if (this.state.viewMode === 'stencil') this._renderStencil(nodes, edges);
        else this._renderNodes(nodes, edges);
    };

    /* ================================================================
       STENCIL VIEW — Centered ports
       ================================================================ */

    Renderer.prototype._renderStencil = function(nodes, edges) {
        var self = this;
        this._updateSize();
        this.g.selectAll('.edge-layer > *, .node-layer > *').remove();
        if (this.simulation) { this.simulation.stop(); this.simulation = null; }
        if (nodes.length === 0) return;

        var nodeData = nodes.map(function(n) {
            return Object.assign({}, n, { ports: (n.ports || []).slice() });
        });
        var edgeData = edges.map(function(e) { return Object.assign({}, e); });

        // Compute card heights
        nodeData.forEach(function(nd) {
            var portCount = nd.ports.length;
            nd._cardH = HEADER_H + portCount * (PORT_H + PORT_GAP) + CARD_PAD;
            if (portCount === 0) nd._cardH = HEADER_H + CARD_PAD;
        });

        // Hierarchical layout
        var layers = {};
        nodeData.forEach(function(n) {
            var l = getRoleLayer(n.role_slug);
            if (!layers[l]) layers[l] = [];
            layers[l].push(n);
        });
        var layerKeys = Object.keys(layers).map(Number).sort(function(a, b) { return a - b; });

        layerKeys.forEach(function(lk, col) {
            var group = layers[lk];
            group.sort(function(a, b) { return (a.name || '').localeCompare(b.name || ''); });
            var curY = 80;
            group.forEach(function(n) {
                n.x = 100 + col * LAYER_GAP_X;
                n.y = curY;
                curY += n._cardH + NODE_GAP_Y;
            });
        });

        // Apply saved positions
        var savedLayout = self.state.savedLayout;
        if (savedLayout && typeof savedLayout === 'object') {
            nodeData.forEach(function(n) {
                var saved = savedLayout[n.id];
                if (saved && saved.x !== undefined) { n.x = saved.x; n.y = saved.y; }
            });
        }

        // Build node lookup by id
        var nodeById = {};
        nodeData.forEach(function(n) { nodeById[n.id] = n; });

        // Port-to-node lookup
        var portToNode = {};
        nodeData.forEach(function(nd) {
            nd.ports.forEach(function(p) { portToNode[p.id] = nd; });
        });

        // Compute port Y positions (relative to card top)
        function portRelY(nd, portIdx) {
            return HEADER_H + portIdx * (PORT_H + PORT_GAP) + PORT_H / 2;
        }

        // Port position: cable attaches at port container edge (flush with card)
        function getPortPos(portId, otherNodeId) {
            var nd = portToNode[portId];
            if (!nd) return null;
            var idx = -1;
            for (var i = 0; i < nd.ports.length; i++) {
                if (nd.ports[i].id === portId) { idx = i; break; }
            }
            if (idx < 0) return null;

            var other = otherNodeId ? nodeById[otherNodeId] : null;
            var side = 'right';
            if (other && other.x < nd.x) side = 'left';

            return {
                x: side === 'right' ? nd.x + CARD_W : nd.x,
                y: nd.y + portRelY(nd, idx),
                side: side,
            };
        }

        // Cable path generator — supports curve and orthogonal styles
        function cablePath(d) {
            var srcNode = typeof d.source === 'object' ? d.source : nodeById[d.source];
            var tgtNode = typeof d.target === 'object' ? d.target : nodeById[d.target];
            var sp = getPortPos(d.source_port, d.target);
            var tp = getPortPos(d.target_port, d.source);
            if (!sp || !tp) {
                if (!srcNode || !tgtNode) return '';
                return 'M' + (srcNode.x + CARD_W/2) + ',' + (srcNode.y + (srcNode._cardH||40)/2)
                    + ' L' + (tgtNode.x + CARD_W/2) + ',' + (tgtNode.y + (tgtNode._cardH||40)/2);
            }

            if (self.state.cableStyle === 'ortho') {
                // Orthogonal: horizontal out, vertical, horizontal in
                var sDir = sp.side === 'right' ? 1 : -1;
                var tDir = tp.side === 'right' ? 1 : -1;
                var midX = (sp.x + tp.x) / 2;
                var outLen = Math.max(Math.abs(tp.x - sp.x) * 0.2, 30);
                var sx2 = sp.x + outLen * sDir;
                var tx2 = tp.x + outLen * tDir;
                // Use midpoint X for the vertical segment
                var vx = (sx2 + tx2) / 2;
                return 'M' + sp.x + ',' + sp.y
                    + ' L' + sx2 + ',' + sp.y
                    + ' L' + sx2 + ',' + ((sp.y + tp.y) / 2)
                    + ' L' + tx2 + ',' + ((sp.y + tp.y) / 2)
                    + ' L' + tx2 + ',' + tp.y
                    + ' L' + tp.x + ',' + tp.y;
            }

            // Default: bezier curve
            var dx = Math.abs(tp.x - sp.x);
            var cp = Math.max(dx * 0.45, 60);
            var sDir2 = sp.side === 'right' ? 1 : -1;
            var tDir2 = tp.side === 'right' ? 1 : -1;

            return 'M' + sp.x + ',' + sp.y
                + ' C' + (sp.x + cp * sDir2) + ',' + sp.y
                + ' ' + (tp.x + cp * tDir2) + ',' + tp.y
                + ' ' + tp.x + ',' + tp.y;
        }

        this._stencilNodeData = nodeData;

        // === Draw cables ===
        this.edgeElements = this.g.select('.edge-layer')
            .selectAll('path').data(edgeData).enter().append('path')
            .attr('class', function(d) {
                var c = 'topo-edge';
                if (d.status_value === 'planned') c += ' planned';
                return c;
            })
            .attr('stroke', function(d) { return d.color || '#6c757d'; })
            .attr('stroke-width', 2).attr('fill', 'none')
            .attr('d', cablePath)
            .on('click', function(ev, d) { ev.stopPropagation(); if (d.url) window.open(d.url, '_blank'); });

        this.edgeElements.append('title').text(function(d) {
            return [d.source_port_name, '\u2192', d.target_port_name, '|', d.cable_label, d.cable_type].join(' ');
        });

        // Give each cable path an ID for textPath reference
        this.edgeElements.attr('id', function(d) { return 'cable-path-' + d.cable_id; });

        // Connector dots container
        var connectorDots = this.g.select('.edge-layer');

        // Create label paths — always left-to-right for readable text
        // For curves: reversed bezier when cable goes right-to-left
        // For ortho: a simple horizontal line at the midpoint
        function createLabelPath(d) {
            var sp = getPortPos(d.source_port, d.target);
            var tp = getPortPos(d.target_port, d.source);
            if (!sp || !tp) return;

            var pathId = 'cable-label-path-' + d.cable_id;
            var lp, rp; // left point, right point

            if (sp.x <= tp.x) { lp = sp; rp = tp; }
            else { lp = tp; rp = sp; }

            var labelPath;
            if (self.state.cableStyle === 'ortho') {
                // Horizontal line at vertical midpoint
                var midY = (sp.y + tp.y) / 2;
                var sDir = sp.side === 'right' ? 1 : -1;
                var tDir = tp.side === 'right' ? 1 : -1;
                var outLen = Math.max(Math.abs(tp.x - sp.x) * 0.2, 30);
                var sx2 = sp.x + outLen * sDir;
                var tx2 = tp.x + outLen * tDir;
                var leftX = Math.min(sx2, tx2);
                var rightX = Math.max(sx2, tx2);
                labelPath = 'M' + leftX + ',' + midY + ' L' + rightX + ',' + midY;
            } else {
                // Bezier from left to right
                var dx = Math.abs(rp.x - lp.x);
                var cp = Math.max(dx * 0.45, 60);
                var lDir = lp === sp ? (sp.side === 'right' ? 1 : -1) : (tp.side === 'right' ? 1 : -1);
                var rDir = rp === sp ? (sp.side === 'right' ? 1 : -1) : (tp.side === 'right' ? 1 : -1);
                labelPath = 'M' + lp.x + ',' + lp.y
                    + ' C' + (lp.x + cp * lDir) + ',' + lp.y
                    + ' ' + (rp.x + cp * rDir) + ',' + rp.y
                    + ' ' + rp.x + ',' + rp.y;
            }

            connectorDots.append('path')
                .attr('id', pathId)
                .attr('d', labelPath)
                .attr('fill', 'none')
                .attr('stroke', 'none');
        }

        edgeData.forEach(createLabelPath);

        // Cable labels — "#ID Type" following the label path
        var cableLabels = this.g.select('.edge-layer')
            .selectAll('text.cable-label').data(edgeData).enter().append('text')
            .attr('class', 'cable-label')
            .attr('dy', -5);

        cableLabels.each(function(d) {
            var tp = d3.select(this).append('textPath')
                .attr('href', '#cable-label-path-' + d.cable_id)
                .attr('startOffset', '50%')
                .attr('text-anchor', 'middle');
            tp.append('tspan').attr('class', 'cable-label-id').text('#' + d.cable_id);
            if (d.cable_type) {
                tp.append('tspan').attr('dx', 5).text(d.cable_type);
            }
        });
        edgeData.forEach(function(d) {
            var sp = getPortPos(d.source_port, d.target);
            var tp = getPortPos(d.target_port, d.source);
            if (sp) connectorDots.append('circle').attr('class', 'connector-dot')
                .attr('cx', sp.x).attr('cy', sp.y).attr('r', 3.5)
                .attr('fill', d.color || '#6c757d');
            if (tp) connectorDots.append('circle').attr('class', 'connector-dot')
                .attr('cx', tp.x).attr('cy', tp.y).attr('r', 3.5)
                .attr('fill', d.color || '#6c757d');
        });

        // Show cable labels on cable hover
        this.edgeElements.on('mouseenter', function(ev, d) {
            // Find matching label
            cableLabels.each(function(ld) {
                if (ld.id === d.id) d3.select(this).classed('visible', true);
            });
        }).on('mouseleave', function() {
            cableLabels.classed('visible', false);
        });

        // === Draw device cards ===
        var cards = this.g.select('.node-layer')
            .selectAll('g').data(nodeData).enter().append('g')
            .attr('class', 'topo-stencil-node')
            .attr('transform', function(d) { return 'translate(' + d.x + ',' + d.y + ')'; });

        this.nodeElements = cards;

        // Card body
        cards.append('rect').attr('class', 'stencil-bg')
            .attr('width', CARD_W).attr('height', function(d) { return d._cardH; })
            .attr('rx', 5).attr('ry', 5);

        // Role color top stripe
        cards.append('rect')
            .attr('width', CARD_W).attr('height', 3)
            .attr('fill', function(d) { return d.role_color || '#6c757d'; });

        // Device name
        cards.append('text').attr('class', 'stencil-name')
            .attr('x', CARD_W / 2).attr('y', 17).attr('text-anchor', 'middle')
            .text(function(d) { return d.name || ''; });

        // Device type
        cards.append('text').attr('class', 'stencil-type')
            .attr('x', CARD_W / 2).attr('y', 29).attr('text-anchor', 'middle')
            .text(function(d) {
                var t = d.device_type || '';
                return t.length > 24 ? t.substring(0, 22) + '\u2026' : t;
            });

        // Separator
        cards.append('line')
            .attr('x1', 0).attr('x2', CARD_W)
            .attr('y1', HEADER_H - 2).attr('y2', HEADER_H - 2)
            .attr('stroke', 'rgba(255,255,255,0.06)');

        // Draw ports — full-width containers flush with card edges
        cards.each(function(d) {
            var g = d3.select(this);
            d.ports.forEach(function(p, i) {
                var py = HEADER_H + i * (PORT_H + PORT_GAP);
                var color = p.speed ? App.speedColor(p.speed) : '#556';
                if (p.port_class === 'front-port') color = '#ff9800';
                if (p.port_class === 'rear-port') color = '#795548';

                var pg = g.append('g').attr('class', 'port-container');

                // Port box — full card width, flush with edges
                pg.append('rect')
                    .attr('x', 0).attr('y', py)
                    .attr('width', CARD_W).attr('height', PORT_H)
                    .attr('fill', 'rgba(255,255,255,0.04)')
                    .attr('stroke', 'rgba(255,255,255,0.06)')
                    .attr('stroke-width', 0.5);

                // Color accent bar on left
                pg.append('rect')
                    .attr('x', 0).attr('y', py)
                    .attr('width', 3).attr('height', PORT_H)
                    .attr('fill', color);

                // Port name
                pg.append('text').attr('class', 'port-name')
                    .attr('x', PORT_TEXT_PAD)
                    .attr('y', py + PORT_H / 2 + 3.5)
                    .text(function() {
                        var n = p.name;
                        return n.length > 12 ? n.substring(0, 10) + '..' : n;
                    });

                // Speed pill
                var badge = '';
                if (p.speed) badge = App.formatSpeed(p.speed);
                else if (p.port_class === 'front-port') badge = 'FP';
                else if (p.port_class === 'rear-port') badge = 'RP';

                if (badge) {
                    var pillW = badge.length * 6.5 + 8;
                    var pillX = CARD_W - pillW - PORT_TEXT_PAD + 4;
                    pg.append('rect')
                        .attr('x', pillX).attr('y', py + 4)
                        .attr('width', pillW).attr('height', PORT_H - 8)
                        .attr('rx', 3)
                        .attr('fill', color).attr('opacity', 0.2);
                    pg.append('text').attr('class', 'port-badge')
                        .attr('x', pillX + pillW / 2)
                        .attr('y', py + PORT_H / 2 + 3.5)
                        .attr('text-anchor', 'middle')
                        .attr('fill', color)
                        .text(badge);
                }
            });
        });

        // Click
        cards.on('click', function(ev, d) {
            ev.stopPropagation(); self._deselectAll();
            d3.select(this).classed('selected', true);
            self.state.selectedNode = d; self.events.emit('node:select', d);
        });

        // Hover
        cards.on('mouseenter', function(ev, d) {
            self.edgeElements.attr('stroke-opacity', function(e) {
                var s = typeof e.source === 'object' ? e.source.id : e.source;
                var t = typeof e.target === 'object' ? e.target.id : e.target;
                return (s === d.id || t === d.id) ? 1 : 0.06;
            }).attr('stroke-width', function(e) {
                var s = typeof e.source === 'object' ? e.source.id : e.source;
                var t = typeof e.target === 'object' ? e.target.id : e.target;
                return (s === d.id || t === d.id) ? 3 : 1.5;
            });
        });
        cards.on('mouseleave', function() {
            self.edgeElements.attr('stroke-opacity', null).attr('stroke-width', 2);
        });

        // Drag — update cables, dots follow automatically via textPath
        cards.call(d3.drag()
            .on('drag', function(ev, d) {
                d.x += ev.dx; d.y += ev.dy;
                d3.select(this).attr('transform', 'translate(' + d.x + ',' + d.y + ')');
                var orig = self.state.nodes.find(function(n) { return n.id === d.id; });
                if (orig) { orig.x = d.x; orig.y = d.y; }

                // Redraw cables
                self.edgeElements.attr('d', cablePath);

                // Rebuild label paths (removes old, creates new left-to-right)
                edgeData.forEach(function(e) {
                    connectorDots.select('#cable-label-path-' + e.cable_id).remove();
                    createLabelPath(e);
                });

                // Redraw connector dots
                connectorDots.selectAll('circle.connector-dot').remove();
                edgeData.forEach(function(e) {
                    var sp = getPortPos(e.source_port, e.target);
                    var tp = getPortPos(e.target_port, e.source);
                    if (sp) connectorDots.append('circle').attr('class', 'connector-dot')
                        .attr('cx', sp.x).attr('cy', sp.y).attr('r', 3.5).attr('fill', e.color || '#6c757d');
                    if (tp) connectorDots.append('circle').attr('class', 'connector-dot')
                        .attr('cx', tp.x).attr('cy', tp.y).attr('r', 3.5).attr('fill', e.color || '#6c757d');
                });
            })
        );

        setTimeout(function() { self.fitToView(); }, 50);
    };

    /* ================================================================
       NODE VIEW
       ================================================================ */

    Renderer.prototype._renderNodes = function(nodes, edges) {
        var self = this;
        this._updateSize();
        this.g.selectAll('.edge-layer > *, .node-layer > *').remove();
        if (this.simulation) this.simulation.stop();
        if (nodes.length === 0) return;

        var nd = nodes.map(function(n) { return Object.assign({}, n); });
        var ed = edges.map(function(e) { return Object.assign({}, e); });

        this.edgeElements = this.g.select('.edge-layer')
            .selectAll('line').data(ed).enter().append('line')
            .attr('class', 'topo-edge')
            .attr('stroke', function(d) { return d.color || '#6c757d'; })
            .attr('stroke-width', 2)
            .on('click', function(ev, d) { ev.stopPropagation(); if (d.url) window.open(d.url, '_blank'); });

        this.edgeElements.append('title').text(function(d) {
            return [d.cable_label, d.cable_type, d.status].filter(Boolean).join(' \u2022 ');
        });

        var ng = this.g.select('.node-layer')
            .selectAll('g').data(nd).enter().append('g')
            .attr('class', 'topo-node')
            .call(d3.drag()
                .on('start', function(ev, d) { if (!ev.active && self.simulation) self.simulation.alphaTarget(0.1).restart(); d.fx = d.x; d.fy = d.y; })
                .on('drag', function(ev, d) { d.fx = ev.x; d.fy = ev.y; })
                .on('end', function(ev, d) { if (!ev.active && self.simulation) self.simulation.alphaTarget(0); d.fx = null; d.fy = null; })
            );
        this.nodeElements = ng;

        var nr = function(d) { return d.interface_count > 24 ? 24 : 18; };
        ng.append('circle').attr('class', 'node-bg').attr('r', nr).attr('fill', function(d) { return d.role_color || '#6c757d'; });
        ng.append('text').attr('class', 'node-icon').text(function(d) { return App.roleIcon(d.role_slug); });
        ng.append('circle').attr('class', 'status-dot').attr('r', 4)
            .attr('cx', function(d) { return nr(d) - 2; }).attr('cy', function(d) { return -(nr(d) - 2); })
            .attr('fill', function(d) { return App.statusColor(d.status_value); });
        ng.append('text').attr('class', 'node-label').attr('dy', function(d) { return nr(d) + 14; })
            .text(function(d) { var n = d.name || ''; return n.length > 20 ? n.substring(0, 18) + '\u2026' : n; });

        ng.on('click', function(ev, d) {
            ev.stopPropagation(); self._deselectAll();
            d3.select(this).classed('selected', true);
            self.state.selectedNode = d; self.events.emit('node:select', d);
        });
        ng.on('mouseenter', function(ev, d) {
            self.edgeElements.attr('stroke-opacity', function(e) { return (e.source.id === d.id || e.target.id === d.id) ? 0.9 : 0.12; });
        });
        ng.on('mouseleave', function() { self.edgeElements.attr('stroke-opacity', null); });

        this.simulation = d3.forceSimulation(nd)
            .force('link', d3.forceLink(ed).id(function(d) { return d.id; }).distance(140).strength(0.7))
            .force('charge', d3.forceManyBody().strength(-400).distanceMax(500))
            .force('center', d3.forceCenter(this.width / 2, this.height / 2))
            .force('collision', d3.forceCollide().radius(35))
            .alphaDecay(0.03)
            .on('tick', function() {
                self.edgeElements.attr('x1', function(d) { return d.source.x; }).attr('y1', function(d) { return d.source.y; })
                    .attr('x2', function(d) { return d.target.x; }).attr('y2', function(d) { return d.target.y; });
                ng.attr('transform', function(d) { return 'translate(' + d.x + ',' + d.y + ')'; });
            });
        this.simulation.on('end', function() { self.fitToView(); });
    };

    /* ===== Shared ===== */

    Renderer.prototype.fitToView = function() {
        if (!this.nodeElements || this.nodeElements.empty()) return;
        this._updateSize();
        var b = this.g.node().getBBox();
        if (b.width === 0 || b.height === 0) return;
        var pad = 80;
        var s = Math.min((this.width - pad * 2) / b.width, (this.height - pad * 2) / b.height, 2);
        s = Math.max(s, 0.05);
        this.svg.transition().duration(500).call(this.zoom.transform,
            d3.zoomIdentity.translate(this.width / 2 - (b.x + b.width / 2) * s, this.height / 2 - (b.y + b.height / 2) * s).scale(s));
    };

    Renderer.prototype.zoomIn = function() { this.svg.transition().duration(300).call(this.zoom.scaleBy, 1.3); };
    Renderer.prototype.zoomOut = function() { this.svg.transition().duration(300).call(this.zoom.scaleBy, 0.7); };
    Renderer.prototype.resize = function() { this._updateSize(); };
    Renderer.prototype.switchView = function(m) { this.state.viewMode = m; this.render(this.state.nodes, this.state.edges); };
    Renderer.prototype.switchLayout = function() { this.render(this.state.nodes, this.state.edges); };
    Renderer.prototype.switchCableStyle = function(style) { this.state.cableStyle = style; this.render(this.state.nodes, this.state.edges); };

    Renderer.prototype.highlightNode = function(id) {
        this._deselectAll();
        if (this.nodeElements) this.nodeElements.each(function(d) { if (d.id === id) d3.select(this).classed('selected', true); });
    };

    Renderer.prototype.filterNodes = function(vis) {
        if (!this.nodeElements) return;
        this.nodeElements.style('opacity', function(d) { return vis === null || vis.has(d.id) ? 1 : 0.08; });
        if (this.edgeElements) this.edgeElements.style('opacity', function(d) {
            var s = typeof d.source === 'object' ? d.source.id : d.source;
            var t = typeof d.target === 'object' ? d.target.id : d.target;
            return vis === null || (vis.has(s) && vis.has(t)) ? null : 0.03;
        });
    };

    Renderer.prototype.applyHiddenNodes = function(hiddenSet) {
        if (!this.nodeElements) return;
        this.nodeElements.style('opacity', function(d) { return hiddenSet.has(d.id) ? 0.08 : 1; })
            .style('pointer-events', function(d) { return hiddenSet.has(d.id) ? 'none' : null; });
        if (this.edgeElements) this.edgeElements.style('opacity', function(d) {
            var s = typeof d.source === 'object' ? d.source.id : d.source;
            var t = typeof d.target === 'object' ? d.target.id : d.target;
            return (hiddenSet.has(s) || hiddenSet.has(t)) ? 0.03 : null;
        });
    };

    Renderer.prototype._deselectAll = function() {
        if (this.nodeElements) this.nodeElements.classed('selected', false);
        this.state.selectedNode = null;
    };

    App.Renderer = Renderer;
})(TopologyApp);
