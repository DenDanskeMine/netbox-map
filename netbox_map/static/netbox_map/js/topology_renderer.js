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

    // Compute layer assignment from actual cable connections via BFS.
    // Devices with fewest connections or no "upstream" are placed left (layer 0).
    // Falls back to role-based hints if available.
    function computeLayers(nodeData, edgeData) {
        var nodeIds = {};
        nodeData.forEach(function(n) { nodeIds[n.id] = n; });

        // Build adjacency + connection counts
        var adj = {};
        var degree = {};
        nodeData.forEach(function(n) { adj[n.id] = []; degree[n.id] = 0; });
        edgeData.forEach(function(e) {
            var s = typeof e.source === 'object' ? e.source.id : e.source;
            var t = typeof e.target === 'object' ? e.target.id : e.target;
            if (adj[s] && adj[t]) {
                adj[s].push(t);
                adj[t].push(s);
                degree[s]++;
                degree[t]++;
            }
        });

        // Find root candidates: devices with fewest connections (edge devices)
        // or use role hints if they match common patterns
        var ROLE_HINTS = {
            'firewall': 0, 'fw': 0,
            'router': 1, 'rtr': 1, 'edge': 1,
            'core': 2,
            'distribution': 3, 'dist': 3, 'aggregation': 3,
            'access': 4, 'leaf': 4,
            'server': 5, 'host': 5, 'compute': 5, 'storage': 5,
            'patch': 3, 'panel': 3,
        };

        function roleHint(slug) {
            if (!slug) return -1;
            slug = slug.toLowerCase();
            for (var k in ROLE_HINTS) {
                if (slug.indexOf(k) !== -1) return ROLE_HINTS[k];
            }
            return -1;
        }

        // Check if any role hints match
        var hasHints = nodeData.some(function(n) { return roleHint(n.role_slug) >= 0; });

        if (hasHints) {
            // Use role hints — group by hint value, unmatched roles get assigned
            // based on their connections to hinted devices
            var layers = {};
            var unassigned = [];
            nodeData.forEach(function(n) {
                var hint = roleHint(n.role_slug);
                if (hint >= 0) {
                    if (!layers[hint]) layers[hint] = [];
                    layers[hint].push(n);
                    n._layer = hint;
                } else {
                    unassigned.push(n);
                }
            });

            // Assign unmatched devices based on neighbors' average layer
            unassigned.forEach(function(n) {
                var neighbors = adj[n.id] || [];
                var sum = 0, count = 0;
                neighbors.forEach(function(nid) {
                    var nb = nodeIds[nid];
                    if (nb && nb._layer !== undefined) { sum += nb._layer; count++; }
                });
                var layer = count > 0 ? Math.round(sum / count) : 5;
                n._layer = layer;
                if (!layers[layer]) layers[layer] = [];
                layers[layer].push(n);
            });

            return layers;
        }

        // No role hints — use pure BFS from lowest-degree nodes
        var sorted = nodeData.slice().sort(function(a, b) {
            return (degree[a.id] || 0) - (degree[b.id] || 0);
        });

        // BFS from the node with fewest connections
        var visited = {};
        var layers = {};
        var queue = [];

        // Start from lowest-degree node
        if (sorted.length > 0) {
            var root = sorted[0];
            queue.push({ node: root, level: 0 });
            visited[root.id] = true;
        }

        while (queue.length > 0) {
            var item = queue.shift();
            var lvl = item.level;
            if (!layers[lvl]) layers[lvl] = [];
            layers[lvl].push(item.node);
            item.node._layer = lvl;

            (adj[item.node.id] || []).forEach(function(nid) {
                if (!visited[nid] && nodeIds[nid]) {
                    visited[nid] = true;
                    queue.push({ node: nodeIds[nid], level: lvl + 1 });
                }
            });
        }

        // Handle disconnected nodes
        nodeData.forEach(function(n) {
            if (!visited[n.id]) {
                var maxLayer = Object.keys(layers).length;
                if (!layers[maxLayer]) layers[maxLayer] = [];
                layers[maxLayer].push(n);
                n._layer = maxLayer;
            }
        });

        return layers;
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

    Renderer.prototype.render = function(nodes, edges, skipFit) {
        this._skipFit = !!skipFit;
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

        // Hierarchical layout — use custom hierarchy if set, otherwise auto-detect
        var layers;
        if (self.state.customHierarchy && Object.keys(self.state.customHierarchy).length > 0) {
            layers = {};
            nodeData.forEach(function(n) {
                var l = self.state.customHierarchy[n.role_slug];
                if (l === undefined) l = 99;
                if (!layers[l]) layers[l] = [];
                layers[l].push(n);
                n._layer = l;
            });
        } else {
            layers = computeLayers(nodeData, edgeData);
        }
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

        // Store positioned node data for external access (save, PDF, etc.)
        this._stencilNodeData = nodeData;

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

        // Detect parallel cables (multiple edges between same device pair)
        // Assign each an offset index so they fan out instead of overlapping
        var pairCount = {};  // "devA-devB" -> count
        var pairIndex = {};  // edge.id -> index within its pair
        edgeData.forEach(function(e) {
            var s = typeof e.source === 'object' ? e.source.id : e.source;
            var t = typeof e.target === 'object' ? e.target.id : e.target;
            var key = s < t ? s + '|' + t : t + '|' + s;
            if (!pairCount[key]) pairCount[key] = 0;
            pairIndex[e.id] = pairCount[key];
            pairCount[key]++;
        });
        // Store total count per edge
        edgeData.forEach(function(e) {
            var s = typeof e.source === 'object' ? e.source.id : e.source;
            var t = typeof e.target === 'object' ? e.target.id : e.target;
            var key = s < t ? s + '|' + t : t + '|' + s;
            e._pairIdx = pairIndex[e.id];
            e._pairTotal = pairCount[key];
        });

        // Find a safe Y for the ortho cable's horizontal middle segment.
        // Only checks devices that are actually in the path of the horizontal segment.
        function findSafeY(sp, tp, srcId, tgtId) {
            var naiveY = (sp.y + tp.y) / 2;
            var pad = 12;

            // The horizontal segment runs between the two vertical drop points.
            // These are offset from the port positions by outLen.
            var dxAbs = Math.abs(sp.x - tp.x);
            var sDir = sp.side === 'right' ? 1 : -1;
            var tDir = tp.side === 'right' ? 1 : -1;
            var outLen = Math.max(dxAbs * 0.2, 30);
            var sx2 = sp.x + outLen * sDir;
            var tx2 = tp.x + outLen * tDir;
            var segLeft = Math.min(sx2, tx2);
            var segRight = Math.max(sx2, tx2);

            // Find devices whose card body overlaps with this horizontal segment
            var obstacles = [];
            nodeData.forEach(function(n) {
                if (n.id === srcId || n.id === tgtId) return;
                var cardH = n._cardH || 60;
                // Does this card's X range overlap with the horizontal segment?
                if (n.x + CARD_W <= segLeft || n.x >= segRight) return;
                obstacles.push({
                    top: n.y - pad,
                    bottom: n.y + cardH + pad,
                });
            });

            if (obstacles.length === 0) return naiveY;

            var isBlocked = function(y) {
                return obstacles.some(function(o) { return y >= o.top && y <= o.bottom; });
            };

            if (!isBlocked(naiveY)) return naiveY;

            // Try just above/below each obstacle
            var candidates = [];
            obstacles.forEach(function(o) {
                candidates.push(o.top - 1);
                candidates.push(o.bottom + 1);
            });

            // Sort by distance from naive Y (closest first)
            candidates.sort(function(a, b) {
                return Math.abs(a - naiveY) - Math.abs(b - naiveY);
            });

            for (var i = 0; i < candidates.length; i++) {
                if (!isBlocked(candidates[i])) return candidates[i];
            }

            return naiveY;
        }

        // Cable path generator
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

            // Check if devices are in the same column (vertical/HA link)
            var dxAbs = Math.abs(sp.x - tp.x);
            var isSameColumn = dxAbs < CARD_W * 1.2;

            // Parallel cable offset (fan out multiple cables between same pair)
            var fanOffset = 0;
            if (d._pairTotal > 1) {
                var spread = 6; // pixels between parallel cables
                fanOffset = (d._pairIdx - (d._pairTotal - 1) / 2) * spread;
            }

            if (isSameColumn) {
                // Same-column (HA/vertical): side rail pattern
                // Cables go out to the right side as a vertical bus bar
                var railBase = Math.max(sp.x, tp.x) + 20;
                var railX = railBase + d._pairIdx * 14; // each cable gets its own rail offset

                // Orthogonal path: stub out → vertical → stub in
                return 'M' + sp.x + ',' + sp.y
                    + ' L' + railX + ',' + sp.y
                    + ' L' + railX + ',' + tp.y
                    + ' L' + tp.x + ',' + tp.y;
            }

            if (self.state.cableStyle === 'ortho') {
                var sDir = sp.side === 'right' ? 1 : -1;
                var tDir = tp.side === 'right' ? 1 : -1;
                var outLen = Math.max(dxAbs * 0.2, 30);
                var sx2 = sp.x + outLen * sDir;
                var tx2 = tp.x + outLen * tDir;
                var srcId = typeof d.source === 'object' ? d.source.id : d.source;
                var tgtId = typeof d.target === 'object' ? d.target.id : d.target;
                var midY = findSafeY(sp, tp, srcId, tgtId) + fanOffset;
                return 'M' + sp.x + ',' + sp.y
                    + ' L' + sx2 + ',' + sp.y
                    + ' L' + sx2 + ',' + midY
                    + ' L' + tx2 + ',' + midY
                    + ' L' + tx2 + ',' + tp.y
                    + ' L' + tp.x + ',' + tp.y;
            }

            // Default: bezier curve with fan offset
            // Check if naive curve would pass through a device and adjust
            var srcId3 = typeof d.source === 'object' ? d.source.id : d.source;
            var tgtId3 = typeof d.target === 'object' ? d.target.id : d.target;
            var safeY = findSafeY(sp, tp, srcId3, tgtId3);
            var yShift = safeY - (sp.y + tp.y) / 2 + fanOffset;

            var cp = Math.max(dxAbs * 0.45, 60);
            var sDir2 = sp.side === 'right' ? 1 : -1;
            var tDir2 = tp.side === 'right' ? 1 : -1;

            return 'M' + sp.x + ',' + sp.y
                + ' C' + (sp.x + cp * sDir2) + ',' + (sp.y + yShift)
                + ' ' + (tp.x + cp * tDir2) + ',' + (tp.y + yShift)
                + ' ' + tp.x + ',' + tp.y;
        }

        // Cable color helper — physical cable color or speed color
        function getCableColor(d) {
            if (self.state.cableColorMode === 'speed') {
                var spd = d.source_port_speed || d.target_port_speed;
                return spd ? App.speedColor(spd) : '#6c757d';
            }
            return d.color || '#6c757d';
        }

        // === Draw cables ===
        this.edgeElements = this.g.select('.edge-layer')
            .selectAll('path').data(edgeData).enter().append('path')
            .attr('class', function(d) {
                var c = 'topo-edge';
                if (d.status_value === 'planned') c += ' planned';
                if (d._virtual) c += ' virtual';
                return c;
            })
            .attr('stroke', function(d) { return getCableColor(d); })
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

        // Create label paths — always left-to-right, horizontal text
        function createLabelPath(d) {
            var sp = getPortPos(d.source_port, d.target);
            var tp = getPortPos(d.target_port, d.source);
            if (!sp || !tp) return;

            var pathId = 'cable-label-path-' + d.cable_id;
            var dxAbs = Math.abs(sp.x - tp.x);
            var isSameColumn = dxAbs < CARD_W * 1.2;

            var labelPath;

            if (isSameColumn) {
                // Same-column: horizontal label at the rail midpoint
                var railBase = Math.max(sp.x, tp.x) + 20;
                var railX = railBase + (d._pairIdx || 0) * 14;
                var midY = (sp.y + tp.y) / 2;
                // Short horizontal path at the rail for the text
                labelPath = 'M' + (railX + 4) + ',' + midY + ' L' + (railX + 80) + ',' + midY;
            } else if (self.state.cableStyle === 'ortho') {
                var sDir = sp.side === 'right' ? 1 : -1;
                var tDir = tp.side === 'right' ? 1 : -1;
                var outLen = Math.max(dxAbs * 0.2, 30);
                var sx2 = sp.x + outLen * sDir;
                var tx2 = tp.x + outLen * tDir;
                var fanOffset = 0;
                if (d._pairTotal > 1) {
                    fanOffset = (d._pairIdx - (d._pairTotal - 1) / 2) * 6;
                }
                var lSrcId = typeof d.source === 'object' ? d.source.id : d.source;
                var lTgtId = typeof d.target === 'object' ? d.target.id : d.target;
                var midY2 = findSafeY(sp, tp, lSrcId, lTgtId) + fanOffset;
                var leftX = Math.min(sx2, tx2);
                var rightX = Math.max(sx2, tx2);
                labelPath = 'M' + leftX + ',' + midY2 + ' L' + rightX + ',' + midY2;
            } else {
                // Bezier: left-to-right path
                var lp, rp;
                if (sp.x <= tp.x) { lp = sp; rp = tp; }
                else { lp = tp; rp = sp; }
                var dx = Math.abs(rp.x - lp.x);
                var cp = Math.max(dx * 0.45, 60);
                var fanOff = 0;
                if (d._pairTotal > 1) {
                    fanOff = (d._pairIdx - (d._pairTotal - 1) / 2) * 6;
                }
                var lDir = lp === sp ? (sp.side === 'right' ? 1 : -1) : (tp.side === 'right' ? 1 : -1);
                var rDir = rp === sp ? (sp.side === 'right' ? 1 : -1) : (tp.side === 'right' ? 1 : -1);
                labelPath = 'M' + lp.x + ',' + lp.y
                    + ' C' + (lp.x + cp * lDir) + ',' + (lp.y + fanOff)
                    + ' ' + (rp.x + cp * rDir) + ',' + (rp.y + fanOff)
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
            var dColor = getCableColor(d);
            if (sp) connectorDots.append('circle').attr('class', 'connector-dot')
                .attr('cx', sp.x).attr('cy', sp.y).attr('r', 3.5)
                .attr('fill', dColor);
            if (tp) connectorDots.append('circle').attr('class', 'connector-dot')
                .attr('cx', tp.x).attr('cy', tp.y).attr('r', 3.5)
                .attr('fill', dColor);
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

        // Card shadow (subtle)
        cards.append('rect').attr('class', 'stencil-shadow')
            .attr('x', 2).attr('y', 2)
            .attr('width', CARD_W).attr('height', function(d) { return d._cardH; })
            .attr('rx', 6).attr('ry', 6)
            .attr('fill', 'rgba(0,0,0,0.15)');

        // Card body
        cards.append('rect').attr('class', 'stencil-bg')
            .attr('width', CARD_W).attr('height', function(d) { return d._cardH; })
            .attr('rx', 6).attr('ry', 6);

        // Role color top stripe (rounded top corners)
        cards.append('clipPath')
            .attr('id', function(d) { return 'clip-' + d.id; })
            .append('rect')
            .attr('width', CARD_W).attr('height', function(d) { return d._cardH; })
            .attr('rx', 6).attr('ry', 6);

        cards.append('rect').attr('class', 'stencil-stripe')
            .attr('width', CARD_W).attr('height', 4)
            .attr('clip-path', function(d) { return 'url(#clip-' + d.id + ')'; })
            .attr('fill', function(d) { return d.role_color || '#6c757d'; });

        // Device name
        cards.append('text').attr('class', 'stencil-name')
            .attr('x', CARD_W / 2).attr('y', 18).attr('text-anchor', 'middle')
            .text(function(d) {
                var n = d.name || '';
                return n.length > 20 ? n.substring(0, 18) + '\u2026' : n;
            });

        // Device type
        cards.append('text').attr('class', 'stencil-type')
            .attr('x', CARD_W / 2).attr('y', 30).attr('text-anchor', 'middle')
            .text(function(d) {
                var t = d.device_type || '';
                return t.length > 24 ? t.substring(0, 22) + '\u2026' : t;
            });

        // Separator
        cards.append('line')
            .attr('x1', 4).attr('x2', CARD_W - 4)
            .attr('y1', HEADER_H - 1).attr('y2', HEADER_H - 1)
            .attr('stroke', 'rgba(255,255,255,0.08)');

        // Draw ports
        cards.each(function(d) {
            var g = d3.select(this);
            d.ports.forEach(function(p, i) {
                var py = HEADER_H + i * (PORT_H + PORT_GAP);
                var color = p.speed ? App.speedColor(p.speed) : '#556';
                if (p.port_class === 'front-port') color = '#ff9800';
                if (p.port_class === 'rear-port') color = '#795548';

                var pg = g.append('g').attr('class', 'port-container');

                // Port row background (alternating subtle shade)
                pg.append('rect')
                    .attr('x', 0).attr('y', py)
                    .attr('width', CARD_W).attr('height', PORT_H)
                    .attr('fill', i % 2 === 0 ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.02)');

                // Color accent bar
                pg.append('rect')
                    .attr('x', 0).attr('y', py + 2)
                    .attr('width', 3).attr('height', PORT_H - 4)
                    .attr('rx', 1)
                    .attr('fill', color);

                // Port name (left side)
                pg.append('text').attr('class', 'port-name')
                    .attr('x', 10)
                    .attr('y', py + PORT_H / 2 + 4)
                    .text(function() {
                        var n = p.name;
                        return n.length > 14 ? n.substring(0, 12) + '..' : n;
                    });

                // Speed/type text (right side, no pill — cleaner)
                var badge = '';
                if (p.speed) badge = App.formatSpeed(p.speed);
                else if (p.port_class === 'front-port') badge = 'FP';
                else if (p.port_class === 'rear-port') badge = 'RP';

                if (badge) {
                    pg.append('text').attr('class', 'port-speed')
                        .attr('x', CARD_W - 8)
                        .attr('y', py + PORT_H / 2 + 4)
                        .attr('text-anchor', 'end')
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

        // Right-click context menu
        cards.on('contextmenu', function(ev, d) {
            ev.preventDefault();
            ev.stopPropagation();
            d3.selectAll('.topo-context-menu').remove();

            var menu = d3.select('body').append('div')
                .attr('class', 'topo-context-menu')
                .style('left', ev.pageX + 'px')
                .style('top', ev.pageY + 'px');

            // --- Info header ---
            menu.append('div').attr('class', 'ctx-header')
                .html('<span class="ctx-dot" style="background:' + (d.role_color || '#6c757d') + '"></span> '
                    + '<strong>' + App.escapeHtml(d.name) + '</strong>');

            menu.append('div').attr('class', 'ctx-divider');

            // --- Open in NetBox ---
            menu.append('div').attr('class', 'ctx-item')
                .html('<i class="mdi mdi-open-in-new"></i> Open in NetBox')
                .on('click', function() { window.open(d.url, '_blank'); menu.remove(); });

            // --- Copy name ---
            menu.append('div').attr('class', 'ctx-item')
                .html('<i class="mdi mdi-content-copy"></i> Copy name')
                .on('click', function() {
                    navigator.clipboard.writeText(d.name || '');
                    menu.remove();
                });

            // --- Copy IP ---
            if (d.primary_ip) {
                menu.append('div').attr('class', 'ctx-item')
                    .html('<i class="mdi mdi-ip-network"></i> Copy IP (' + App.escapeHtml(d.primary_ip) + ')')
                    .on('click', function() {
                        navigator.clipboard.writeText(d.primary_ip);
                        menu.remove();
                    });
            }

            menu.append('div').attr('class', 'ctx-divider');

            // --- Isolate (show only this device + neighbors) ---
            menu.append('div').attr('class', 'ctx-item')
                .html('<i class="mdi mdi-focus-field"></i> Isolate connections')
                .on('click', function() {
                    var connectedIds = new Set([d.id]);
                    edgeData.forEach(function(e) {
                        var s = typeof e.source === 'object' ? e.source.id : e.source;
                        var t = typeof e.target === 'object' ? e.target.id : e.target;
                        if (s === d.id) connectedIds.add(t);
                        if (t === d.id) connectedIds.add(s);
                    });
                    self.filterNodes(connectedIds);
                    menu.remove();
                });

            // --- Show all (reset isolation) ---
            menu.append('div').attr('class', 'ctx-item')
                .html('<i class="mdi mdi-eye-outline"></i> Show all devices')
                .on('click', function() {
                    self.filterNodes(null);
                    menu.remove();
                });

            // --- Add neighbors (devices connected but not on canvas) ---
            menu.append('div').attr('class', 'ctx-item')
                .html('<i class="mdi mdi-plus-network-outline"></i> Add connected devices')
                .on('click', function() {
                    self.events.emit('device:add-neighbors', d);
                    menu.remove();
                });

            menu.append('div').attr('class', 'ctx-divider');

            // --- Center view ---
            menu.append('div').attr('class', 'ctx-item')
                .html('<i class="mdi mdi-crosshairs-gps"></i> Center on device')
                .on('click', function() {
                    var cx = d.x + CARD_W / 2;
                    var cy = d.y + (d._cardH || 60) / 2;
                    var w = self.width, h = self.height;
                    self.svg.transition().duration(400).call(
                        self.zoom.transform,
                        d3.zoomIdentity.translate(w/2 - cx, h/2 - cy).scale(1)
                    );
                    menu.remove();
                });

            // --- Pin/Unpin position ---
            var isPinned = d._pinned;
            menu.append('div').attr('class', 'ctx-item')
                .html('<i class="mdi mdi-pin' + (isPinned ? '-off' : '') + '-outline"></i> '
                    + (isPinned ? 'Unpin position' : 'Pin position'))
                .on('click', function() {
                    d._pinned = !d._pinned;
                    // Visual indicator
                    var cardEl = d3.select(cards.nodes()[nodeData.indexOf(d)]);
                    if (d._pinned) {
                        cardEl.select('.stencil-bg').attr('stroke-dasharray', '4,2');
                    } else {
                        cardEl.select('.stencil-bg').attr('stroke-dasharray', null);
                    }
                    menu.remove();
                });

            menu.append('div').attr('class', 'ctx-divider');

            // --- Remove ---
            menu.append('div').attr('class', 'ctx-item ctx-danger')
                .html('<i class="mdi mdi-close-circle-outline"></i> Remove from canvas')
                .on('click', function() { self.events.emit('device:remove', d.id); menu.remove(); });

            // Close on click elsewhere
            setTimeout(function() {
                d3.select('body').on('click.ctx', function() {
                    d3.selectAll('.topo-context-menu').remove();
                    d3.select('body').on('click.ctx', null);
                });
            }, 10);
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

        // Drag — update cables, snap to grid if enabled or shift held
        cards.call(d3.drag()
            .on('start', function(ev, d) {
                // Store raw (unsnapped) position for smooth dragging
                d._rawX = d.x;
                d._rawY = d.y;
            })
            .on('drag', function(ev, d) {
                // Accumulate raw movement
                d._rawX += ev.dx;
                d._rawY += ev.dy;

                // Apply snap if enabled
                if (self.state.snapToGrid || ev.sourceEvent.shiftKey) {
                    var gs = self.state.gridSize;
                    d.x = Math.round(d._rawX / gs) * gs;
                    d.y = Math.round(d._rawY / gs) * gs;
                } else {
                    d.x = d._rawX;
                    d.y = d._rawY;
                }

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
                    var ec = getCableColor(e);
                    if (sp) connectorDots.append('circle').attr('class', 'connector-dot')
                        .attr('cx', sp.x).attr('cy', sp.y).attr('r', 3.5).attr('fill', ec);
                    if (tp) connectorDots.append('circle').attr('class', 'connector-dot')
                        .attr('cx', tp.x).attr('cy', tp.y).attr('r', 3.5).attr('fill', ec);
                });
            })
        );

        // Sync final positions back to state.nodes so save/toggle works
        nodeData.forEach(function(d) {
            var orig = self.state.nodes.find(function(n) { return n.id === d.id; });
            if (orig) { orig.x = d.x; orig.y = d.y; }
        });

        if (!self._skipFit) {
            setTimeout(function() { self.fitToView(); }, 50);
        }
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
            .attr('stroke', function(d) {
                if (self.state.cableColorMode === 'speed') {
                    var spd = d.source_port_speed || d.target_port_speed;
                    return spd ? App.speedColor(spd) : '#6c757d';
                }
                return d.color || '#6c757d';
            })
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
    Renderer.prototype.switchView = function(m) { this.state.viewMode = m; this.render(this.state.nodes, this.state.edges, true); };
    Renderer.prototype.switchLayout = function() { this.render(this.state.nodes, this.state.edges, true); };
    Renderer.prototype.switchCableStyle = function(style) { this.state.cableStyle = style; this.render(this.state.nodes, this.state.edges, true); };

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
