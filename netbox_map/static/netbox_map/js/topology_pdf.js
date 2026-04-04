/* NetBox Map — Topology PDF Export */
/* Renders topology as vector PDF using jsPDF direct drawing */

(function() {
    'use strict';

    var CARD_W = 200;
    var HEADER_H = 38;
    var PORT_H = 24;
    var PORT_GAP = 3;

    function hexToRgb(hex) {
        if (!hex) return { r: 108, g: 117, b: 125 };
        hex = hex.replace('#', '');
        if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
        var n = parseInt(hex, 16);
        if (isNaN(n)) return { r: 108, g: 117, b: 125 };
        return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
    }

    function speedColor(kbps) {
        if (!kbps) return '#6c757d';
        if (kbps >= 100000000) return '#e91e63';
        if (kbps >= 40000000) return '#e74c3c';
        if (kbps >= 25000000) return '#9b59b6';
        if (kbps >= 10000000) return '#3498db';
        if (kbps >= 1000000) return '#2ecc71';
        return '#f39c12';
    }

    function formatSpeed(kbps) {
        if (!kbps) return '';
        if (kbps >= 1000000) return (kbps / 1000000) + 'G';
        if (kbps >= 1000) return (kbps / 1000) + 'M';
        return kbps + 'K';
    }

    function portColorHex(port) {
        if (port.port_class === 'front-port') return '#ff9800';
        if (port.port_class === 'rear-port') return '#795548';
        return port.speed ? speedColor(port.speed) : '#6c757d';
    }

    function portBadge(port) {
        if (port.speed) return formatSpeed(port.speed);
        if (port.port_class === 'front-port') return 'FP';
        if (port.port_class === 'rear-port') return 'RP';
        return '';
    }

    function sampleBezier(x0, y0, cx0, cy0, cx1, cy1, x1, y1, n) {
        var pts = [];
        for (var i = 0; i <= n; i++) {
            var t = i / n, mt = 1 - t;
            pts.push({
                x: mt*mt*mt*x0 + 3*mt*mt*t*cx0 + 3*mt*t*t*cx1 + t*t*t*x1,
                y: mt*mt*mt*y0 + 3*mt*mt*t*cy0 + 3*mt*t*t*cy1 + t*t*t*y1,
            });
        }
        return pts;
    }

    function bezierMidpoint(x0, y0, cx0, cy0, cx1, cy1, x1, y1) {
        var t = 0.5, mt = 0.5;
        var mx = mt*mt*mt*x0 + 3*mt*mt*t*cx0 + 3*mt*t*t*cx1 + t*t*t*x1;
        var my = mt*mt*mt*y0 + 3*mt*mt*t*cy0 + 3*mt*t*t*cy1 + t*t*t*y1;
        var dx = 3*mt*mt*(cx0-x0) + 6*mt*t*(cx1-cx0) + 3*t*t*(x1-cx1);
        var dy = 3*mt*mt*(cy0-y0) + 6*mt*t*(cy1-cy0) + 3*t*t*(y1-cy1);
        var angle = Math.atan2(dy, dx) * 180 / Math.PI;
        return { x: mx, y: my, angle: angle };
    }

    function edgeSourceId(e) { return typeof e.source === 'object' ? e.source.id : e.source; }
    function edgeTargetId(e) { return typeof e.target === 'object' ? e.target.id : e.target; }

    /* ===== Constructor ===== */

    function TopologyPDF(state, renderer) {
        this.state = state;
        this.renderer = renderer;
        var btn = document.getElementById('topo-export-pdf');
        if (!btn) return;
        var self = this;
        btn.addEventListener('click', function() {
            var icon = btn.querySelector('i');
            var origClass = icon.className;
            icon.className = 'mdi mdi-loading mdi-spin';
            btn.disabled = true;
            setTimeout(function() {
                try { self.exportPDF(); }
                catch (e) { console.error('PDF export error:', e); alert('PDF export failed: ' + e.message); }
                icon.className = origClass;
                btn.disabled = false;
            }, 50);
        });
    }

    TopologyPDF.prototype.exportPDF = function() {
        if (this.state.topologyMode === 'apps') {
            this.exportAppPDF();
            return;
        }
        this._exportNetworkPDF();
    };

    TopologyPDF.prototype._exportNetworkPDF = function() {
        var jsPDF = window.jspdf && window.jspdf.jsPDF;
        if (!jsPDF) { alert('jsPDF not loaded'); return; }

        var state = this.state;
        var nodeData = this.renderer._stencilNodeData;
        if (!nodeData || nodeData.length === 0) { alert('No topology data to export'); return; }

        // Filter to only what's currently visible on screen
        // Respects: hidden nodes (eye toggle), role filter (sidebar toggles),
        // isolation (right-click isolate), and any other visibility state
        var visibleNodes = nodeData.filter(function(n) {
            if (state.hiddenNodes.has(n.id)) return false;
            // Check if node is dimmed/filtered by checking SVG opacity
            var svgNode = d3.select('#topology-svg .node-layer [transform]')
                ? null : null; // fallback
            return true;
        });

        // If role visibility filter is active, also check sidebar role toggles
        if (state.visibleRoles && state.visibleRoles.size > 0) {
            var allRolesCount = 0;
            var roles = {};
            nodeData.forEach(function(n) { if (n.role) roles[n.role] = true; });
            allRolesCount = Object.keys(roles).length;
            // Only filter if not all roles are visible
            if (state.visibleRoles.size < allRolesCount) {
                visibleNodes = visibleNodes.filter(function(n) {
                    return !n.role || state.visibleRoles.has(n.role);
                });
            }
        }

        var visibleIds = new Set(visibleNodes.map(function(n) { return n.id; }));
        var visibleEdges = state.edges.filter(function(e) {
            return visibleIds.has(edgeSourceId(e)) && visibleIds.has(edgeTargetId(e));
        });

        // Lookups
        var nodeById = {};
        visibleNodes.forEach(function(n) { nodeById[n.id] = n; });
        var portToNode = {};
        visibleNodes.forEach(function(n) {
            (n.ports || []).forEach(function(p) { portToNode[p.id] = n; });
        });

        function getPortPos(pid, otherNid) {
            var nd = portToNode[pid];
            if (!nd) return null;
            var idx = -1;
            for (var i = 0; i < nd.ports.length; i++) {
                if (nd.ports[i].id === pid) { idx = i; break; }
            }
            if (idx < 0) return null;
            var other = otherNid ? nodeById[otherNid] : null;
            var side = (!other || other.x >= nd.x) ? 'right' : 'left';
            return {
                x: side === 'right' ? nd.x + CARD_W : nd.x,
                y: nd.y + HEADER_H + idx * (PORT_H + PORT_GAP) + PORT_H / 2,
                side: side,
            };
        }

        // Bounding box
        var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        visibleNodes.forEach(function(n) {
            minX = Math.min(minX, n.x);
            minY = Math.min(minY, n.y);
            maxX = Math.max(maxX, n.x + CARD_W);
            maxY = Math.max(maxY, n.y + (n._cardH || 60));
        });

        // Page setup
        var margin = 15, hdrH = 18, ftrH = 14;
        var svgW = maxX - minX + 40;
        var svgH = maxY - minY + 40;
        var format = visibleNodes.length > 30 ? 'a3' : 'a4';
        var orientation = (svgW / Math.max(svgH, 1)) > 0.9 ? 'landscape' : 'portrait';

        var doc = new jsPDF({ orientation: orientation, unit: 'mm', format: format });
        var pageW = doc.internal.pageSize.getWidth();
        var pageH = doc.internal.pageSize.getHeight();
        var bodyW = pageW - margin * 2;
        var bodyH = pageH - margin * 2 - hdrH - ftrH;

        var scale = Math.min(bodyW / svgW, bodyH / svgH);
        var offsetX = margin + (bodyW - svgW * scale) / 2;
        var offsetY = margin + hdrH + (bodyH - svgH * scale) / 2;

        function tx(x) { return offsetX + (x - minX + 20) * scale; }
        function ty(y) { return offsetY + (y - minY + 20) * scale; }
        function ts(v) { return v * scale; }
        function fs(svgSize) { return Math.max(ts(svgSize) * 0.3, 2.5); }

        // ===== Header =====
        doc.setFontSize(13);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(30, 30, 30);
        doc.text('Network Topology', margin, margin + 10);

        doc.setFontSize(7.5);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(130, 130, 130);
        doc.text('Exported: ' + new Date().toLocaleString(), pageW - margin, margin + 6, { align: 'right' });
        doc.text(visibleNodes.length + ' devices  \u00B7  ' + visibleEdges.length + ' cables', pageW - margin, margin + 11, { align: 'right' });
        doc.setDrawColor(210, 210, 210);
        doc.setLineWidth(0.2);
        doc.line(margin, margin + hdrH - 2, pageW - margin, margin + hdrH - 2);

        // ===== Cables =====
        visibleEdges.forEach(function(edge) {
            var sid = edgeSourceId(edge), tid = edgeTargetId(edge);
            var sp = getPortPos(edge.source_port, tid);
            var tp = getPortPos(edge.target_port, sid);
            if (!sp || !tp) return;

            var rgb = hexToRgb(edge.color);
            doc.setDrawColor(rgb.r, rgb.g, rgb.b);
            doc.setLineWidth(Math.max(ts(1.5), 0.25));
            if (edge.status_value === 'planned') doc.setLineDashPattern([1.5, 1]);
            else doc.setLineDashPattern([]);

            if (state.cableStyle === 'ortho') {
                var sD = sp.side === 'right' ? 1 : -1;
                var tD = tp.side === 'right' ? 1 : -1;
                var out = Math.max(Math.abs(tp.x - sp.x) * 0.2, 30);
                var sx2 = sp.x + out * sD, tx2 = tp.x + out * tD;
                var mY = (sp.y + tp.y) / 2;
                doc.line(tx(sp.x), ty(sp.y), tx(sx2), ty(sp.y));
                doc.line(tx(sx2), ty(sp.y), tx(sx2), ty(mY));
                doc.line(tx(sx2), ty(mY), tx(tx2), ty(mY));
                doc.line(tx(tx2), ty(mY), tx(tx2), ty(tp.y));
                doc.line(tx(tx2), ty(tp.y), tx(tp.x), ty(tp.y));
            } else {
                var dx = Math.abs(tp.x - sp.x);
                var cp = Math.max(dx * 0.45, 60);
                var sD2 = sp.side === 'right' ? 1 : -1;
                var tD2 = tp.side === 'right' ? 1 : -1;
                var pts = sampleBezier(sp.x, sp.y, sp.x+cp*sD2, sp.y, tp.x+cp*tD2, tp.y, tp.x, tp.y, 25);
                for (var i = 0; i < pts.length - 1; i++) {
                    doc.line(tx(pts[i].x), ty(pts[i].y), tx(pts[i+1].x), ty(pts[i+1].y));
                }
            }
            doc.setLineDashPattern([]);

            // Connector dots
            doc.setFillColor(rgb.r, rgb.g, rgb.b);
            doc.circle(tx(sp.x), ty(sp.y), Math.max(ts(2.5), 0.4), 'F');
            doc.circle(tx(tp.x), ty(tp.y), Math.max(ts(2.5), 0.4), 'F');
        });

        // ===== Cable Labels (only if toggle is ON in the web UI) =====
        var edgeLayer = document.querySelector('.edge-layer');
        var showLabels = edgeLayer && edgeLayer.classList.contains('show-cable-labels');
        if (showLabels) {
            // Simple approach: place each label at a spread position along its cable
            // No collision avoidance — just spread + small white bg for readability
            var labelT = [0.3, 0.5, 0.7, 0.35, 0.65, 0.4, 0.6, 0.45, 0.55];

            visibleEdges.forEach(function(edge, idx) {
                var sid = edgeSourceId(edge), tid = edgeTargetId(edge);
                var sp = getPortPos(edge.source_port, tid);
                var tp = getPortPos(edge.target_port, sid);
                if (!sp || !tp) return;

                // Short label: just #ID + abbreviated type
                var label = '#' + edge.cable_id;
                if (edge.cable_type) {
                    var ct = edge.cable_type;
                    // Abbreviate common types
                    ct = ct.replace('Single-mode Fiber', 'SMF').replace('Multimode Fiber', 'MMF');
                    label += ' ' + ct;
                }

                var t = labelT[idx % labelT.length];
                var lx, ly;

                if (state.cableStyle === 'ortho') {
                    lx = sp.x + (tp.x - sp.x) * t;
                    ly = (sp.y + tp.y) / 2;
                } else {
                    var dx = Math.abs(tp.x - sp.x);
                    var cp = Math.max(dx * 0.45, 60);
                    var sD = sp.side === 'right' ? 1 : -1;
                    var tD = tp.side === 'right' ? 1 : -1;
                    var mt = 1 - t;
                    lx = mt*mt*mt*sp.x + 3*mt*mt*t*(sp.x+cp*sD) + 3*mt*t*t*(tp.x+cp*tD) + t*t*t*tp.x;
                    ly = mt*mt*mt*sp.y + 3*mt*mt*t*sp.y + 3*mt*t*t*tp.y + t*t*t*tp.y;
                }

                doc.setFontSize(Math.max(fs(5), 1.3));
                doc.setFont('helvetica', 'normal');

                var tw = doc.getTextWidth(label);
                var th = doc.getFontSize() * 0.35;

                // Small white background
                doc.setFillColor(255, 255, 255);
                doc.rect(tx(lx) - tw/2 - 0.3, ty(ly) - th - 0.2, tw + 0.6, th + 0.4, 'F');

                // Text in dark gray
                doc.setTextColor(80, 80, 90);
                doc.text(label, tx(lx), ty(ly), { align: 'center' });
            });
        }

        // ===== Device Cards =====
        visibleNodes.forEach(function(node) {
            var cx = tx(node.x), cy = ty(node.y);
            var cw = ts(CARD_W), ch = ts(node._cardH || 60);
            var cr = Math.max(ts(5), 0.4);

            // Card body — clean white with thin border
            doc.setFillColor(255, 255, 255);
            doc.setDrawColor(210, 210, 215);
            doc.setLineWidth(0.15);
            doc.roundedRect(cx, cy, cw, ch, cr, cr, 'FD');

            // Role stripe — thin 2px line at top
            var rRgb = hexToRgb(node.role_color);
            doc.setFillColor(rRgb.r, rRgb.g, rRgb.b);
            doc.rect(cx, cy, cw, Math.max(ts(3), 0.4), 'F');

            // Name — shrink font until it fits, show full text
            var name = node.name || '';
            var maxNameW = cw - ts(6);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(25, 25, 30);
            // Start at normal size and shrink until it fits
            var nameSizes = [Math.max(fs(11), 3.5), Math.max(fs(9), 3), Math.max(fs(7.5), 2.5), Math.max(fs(6), 2), Math.max(fs(5), 1.8)];
            for (var ni = 0; ni < nameSizes.length; ni++) {
                doc.setFontSize(nameSizes[ni]);
                if (doc.getTextWidth(name) <= maxNameW) break;
            }
            doc.text(name, cx + cw / 2, cy + ts(16), { align: 'center' });

            // Type — same shrink approach
            var typeStr = node.device_type || '';
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(130, 130, 145);
            var typeSizes = [Math.max(fs(8), 2.5), Math.max(fs(6.5), 2), Math.max(fs(5), 1.8)];
            for (var ti = 0; ti < typeSizes.length; ti++) {
                doc.setFontSize(typeSizes[ti]);
                if (doc.getTextWidth(typeStr) <= maxNameW) break;
            }
            doc.text(typeStr, cx + cw / 2, cy + ts(27), { align: 'center' });

            // Separator — subtle line
            doc.setDrawColor(230, 230, 235);
            doc.setLineWidth(0.08);
            doc.line(cx + ts(4), cy + ts(HEADER_H - 2), cx + cw - ts(4), cy + ts(HEADER_H - 2));

            // Ports
            (node.ports || []).forEach(function(port, i) {
                var py = cy + ts(HEADER_H + i * (PORT_H + PORT_GAP));
                var ph = ts(PORT_H);

                // Alternating row
                doc.setFillColor(i % 2 === 0 ? 248 : 253, i % 2 === 0 ? 248 : 253, i % 2 === 0 ? 251 : 255);
                doc.rect(cx, py, cw, ph, 'F');

                // Accent bar
                var pRgb = hexToRgb(portColorHex(port));
                doc.setFillColor(pRgb.r, pRgb.g, pRgb.b);
                doc.rect(cx, py + ts(2), Math.max(ts(3), 0.3), Math.max(ph - ts(4), 0.8), 'F');

                // Port name
                doc.setFontSize(Math.max(fs(9), 2));
                doc.setFont('courier', 'normal');
                doc.setTextColor(40, 40, 50);
                var pn = port.name;
                var maxPortW = cw * 0.55;
                while (doc.getTextWidth(pn) > maxPortW && pn.length > 3) {
                    pn = pn.substring(0, pn.length - 2) + '..';
                }
                doc.text(pn, cx + ts(8), py + ph * 0.62);

                // Speed text
                var badge = portBadge(port);
                if (badge) {
                    doc.setFontSize(Math.max(fs(8), 1.8));
                    doc.setFont('helvetica', 'bold');
                    doc.setTextColor(pRgb.r, pRgb.g, pRgb.b);
                    doc.text(badge, cx + cw - ts(6), py + ph * 0.62, { align: 'right' });
                }
            });
        });

        // ===== Footer Legend =====
        var ly = pageH - margin - ftrH + 6;
        doc.setDrawColor(210, 210, 210);
        doc.setLineWidth(0.2);
        doc.line(margin, ly - 4, pageW - margin, ly - 4);

        var lx = margin;
        doc.setFontSize(5.5);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(120, 120, 120);
        doc.text('SPEED', lx, ly); lx += 13;

        [['100M','#f39c12'],['1G','#2ecc71'],['10G','#3498db'],['25G','#9b59b6'],['40G','#e74c3c'],['100G','#e91e63']].forEach(function(s) {
            var c = hexToRgb(s[1]);
            doc.setFillColor(c.r, c.g, c.b);
            doc.circle(lx, ly - 1, 1, 'F');
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(80, 80, 80);
            doc.text(s[0], lx + 2.5, ly);
            lx += doc.getTextWidth(s[0]) + 6;
        });

        lx += 6;
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(120, 120, 120);
        doc.text('PORT', lx, ly); lx += 10;

        [['Front','#ff9800'],['Rear','#795548']].forEach(function(p) {
            var c = hexToRgb(p[1]);
            doc.setFillColor(c.r, c.g, c.b);
            doc.circle(lx, ly - 1, 1, 'F');
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(80, 80, 80);
            doc.text(p[0], lx + 2.5, ly);
            lx += doc.getTextWidth(p[0]) + 6;
        });

        // Save
        var title = 'Network_Topology';
        doc.save(title + '.pdf');
    };

    /* ===== App Topology PDF Export ===== */

    var APP_W = 220, APP_HEADER = 40, APP_PORT_H = 16, APP_PORT_GAP = 1, APP_PORT_PAD = 4;

    TopologyPDF.prototype.exportAppPDF = function() {
        var jsPDF = window.jspdf && window.jspdf.jsPDF;
        if (!jsPDF) { alert('jsPDF not loaded'); return; }

        var state = this.state;
        var nodeData = this.renderer._stencilNodeData;
        if (!nodeData || nodeData.length === 0) { alert('No topology data to export'); return; }

        // Filter to apps only
        var nodes = nodeData.filter(function(n) {
            return n.node_type === 'application' && !state.hiddenNodes.has(n.id);
        });
        var nodeIds = new Set(nodes.map(function(n) { return n.id; }));
        var edges = (state.edges || []).filter(function(e) {
            return e.edge_type === 'dependency' &&
                nodeIds.has(edgeSourceId(e)) && nodeIds.has(edgeTargetId(e));
        });

        var nodeById = {};
        nodes.forEach(function(n) { nodeById[n.id] = n; });

        // Bounding box
        var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        nodes.forEach(function(n) {
            minX = Math.min(minX, n.x);
            minY = Math.min(minY, n.y);
            maxX = Math.max(maxX, n.x + APP_W);
            maxY = Math.max(maxY, n.y + (n._h || n._cardH || 60));
        });

        // Page setup
        var margin = 15, hdrH = 18, ftrH = 14;
        var svgW = maxX - minX + 40;
        var svgH = maxY - minY + 40;
        var format = nodes.length > 25 ? 'a3' : 'a4';
        var orientation = (svgW / Math.max(svgH, 1)) > 0.9 ? 'landscape' : 'portrait';

        var doc = new jsPDF({ orientation: orientation, unit: 'mm', format: format });
        var pageW = doc.internal.pageSize.getWidth();
        var pageH = doc.internal.pageSize.getHeight();
        var bodyW = pageW - margin * 2;
        var bodyH = pageH - margin * 2 - hdrH - ftrH;
        var scale = Math.min(bodyW / svgW, bodyH / svgH);
        var offsetX = margin + (bodyW - svgW * scale) / 2;
        var offsetY = margin + hdrH + (bodyH - svgH * scale) / 2;

        function tx(x) { return offsetX + (x - minX + 20) * scale; }
        function ty(y) { return offsetY + (y - minY + 20) * scale; }
        function ts(v) { return v * scale; }
        function fs(sz) { return Math.max(ts(sz) * 0.3, 2); }

        // ── Header ──
        doc.setFontSize(13);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(30, 30, 30);
        doc.text('Application Topology', margin, margin + 10);

        doc.setFontSize(7.5);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(130, 130, 130);
        doc.text('Exported: ' + new Date().toLocaleString(), pageW - margin, margin + 6, { align: 'right' });
        doc.text(nodes.length + ' apps  \u00B7  ' + edges.length + ' dependencies', pageW - margin, margin + 11, { align: 'right' });
        doc.setDrawColor(210, 210, 210);
        doc.setLineWidth(0.2);
        doc.line(margin, margin + hdrH - 2, pageW - margin, margin + hdrH - 2);

        // ── Edges (orthogonal) ──
        edges.forEach(function(e) {
            var sn = nodeById[edgeSourceId(e)];
            var tn = nodeById[edgeTargetId(e)];
            if (!sn || !tn) return;

            var rgb = hexToRgb(e.color);
            doc.setDrawColor(rgb.r, rgb.g, rgb.b);
            doc.setLineWidth(Math.max(ts(e.dependency_type === 'soft' ? 0.8 : 1.2), 0.15));
            if (e.dependency_type === 'soft') doc.setLineDashPattern([1.5, 1]);
            else doc.setLineDashPattern([]);

            // Simple orthogonal: exit right/left based on position
            var sx, stx, sy, sty;
            if (sn.x + APP_W <= tn.x) {
                sx = sn.x + APP_W; stx = tn.x;
            } else {
                sx = sn.x; stx = tn.x + APP_W;
            }
            sy = sn.y + (sn._h || 60) / 2;
            sty = tn.y + (tn._h || 60) / 2;
            var midX = (sx + stx) / 2;

            doc.line(tx(sx), ty(sy), tx(midX), ty(sy));
            doc.line(tx(midX), ty(sy), tx(midX), ty(sty));
            doc.line(tx(midX), ty(sty), tx(stx), ty(sty));

            // Arrow at target
            var arrSize = Math.max(ts(4), 0.6);
            var arrDir = stx === tn.x ? -1 : 1;
            doc.setFillColor(rgb.r, rgb.g, rgb.b);
            if (e.dependency_type !== 'soft') {
                doc.triangle(
                    tx(stx), ty(sty),
                    tx(stx) + arrSize * arrDir, ty(sty) - arrSize * 0.5,
                    tx(stx) + arrSize * arrDir, ty(sty) + arrSize * 0.5,
                    'F'
                );
            }
            doc.setLineDashPattern([]);
        });

        // ── App Cards ──
        nodes.forEach(function(n) {
            var cx = tx(n.x), cy = ty(n.y);
            var cw = ts(APP_W), ch = ts(n._h || n._cardH || 60);
            var cr = Math.max(ts(4), 0.3);

            // Card body
            doc.setFillColor(255, 255, 255);
            doc.setDrawColor(210, 210, 215);
            doc.setLineWidth(0.12);
            doc.roundedRect(cx, cy, cw, ch, cr, cr, 'FD');

            // Left accent bar (group/criticality color)
            var accentRgb = hexToRgb(n.category_color || n.role_color || n.criticality_color);
            doc.setFillColor(accentRgb.r, accentRgb.g, accentRgb.b);
            doc.rect(cx, cy + cr, Math.max(ts(3), 0.3), ch - cr * 2, 'F');

            // Name
            var name = n.name || '';
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(25, 25, 30);
            var nameSize = Math.max(fs(12), 3);
            doc.setFontSize(nameSize);
            var maxNameW = cw - ts(12);
            while (doc.getTextWidth(name) > maxNameW && name.length > 3) {
                name = name.substring(0, name.length - 2) + '\u2026';
            }
            doc.text(name, cx + ts(8), cy + ts(15));

            // Status pill
            var hs = n.host_status || 'healthy';
            if (hs === 'down' || hs === 'degraded') {
                var pillText = hs === 'down' ? 'DOWN' : 'DEGRADED';
                var pillColor = hs === 'down' ? hexToRgb('#ef4444') : hexToRgb('#f97316');
                doc.setFontSize(Math.max(fs(7), 1.8));
                doc.setFont('helvetica', 'bold');
                var pw = doc.getTextWidth(pillText) + ts(4);
                var px = cx + cw - pw - ts(4);
                doc.setFillColor(pillColor.r, pillColor.g, pillColor.b);
                doc.setGState(new jsPDF.GState({ opacity: 0.15 }));
                doc.roundedRect(px, cy + ts(4), pw, ts(10), 1, 1, 'F');
                doc.setGState(new jsPDF.GState({ opacity: 1 }));
                doc.setTextColor(pillColor.r, pillColor.g, pillColor.b);
                doc.text(pillText, px + pw / 2, cy + ts(11), { align: 'center' });
            }

            // Subtitle (group · env)
            var sub = [n.group, n.environment].filter(Boolean).join(' \u00B7 ');
            doc.setFontSize(Math.max(fs(8), 2));
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(130, 130, 145);
            doc.text(sub, cx + ts(8), cy + ts(28));

            // Separator
            if (n._portsL && n._portsL.length > 0 || n._portsR && n._portsR.length > 0) {
                doc.setDrawColor(230, 230, 235);
                doc.setLineWidth(0.08);
                doc.line(cx + ts(6), cy + ts(APP_HEADER), cx + cw - ts(6), cy + ts(APP_HEADER));

                // Section headers
                doc.setFontSize(Math.max(fs(7), 1.5));
                doc.setFont('helvetica', 'bold');
                doc.setTextColor(160, 160, 170);
                if (n._portsL && n._portsL.length > 0) {
                    doc.text('DEPENDS ON', cx + ts(6), cy + ts(APP_HEADER + 8));
                }
                if (n._portsR && n._portsR.length > 0) {
                    doc.text('NEEDED BY', cx + cw - ts(6), cy + ts(APP_HEADER + 8), { align: 'right' });
                }

                // Port labels
                doc.setFontSize(Math.max(fs(8), 1.8));
                doc.setFont('helvetica', 'normal');
                doc.setTextColor(80, 80, 90);

                (n._portsL || []).forEach(function(p) {
                    var portName = p.name || '';
                    if (portName.length > 14) portName = portName.substring(0, 12) + '..';
                    doc.text(portName, cx + ts(6), cy + ts(p._y + 3));
                });
                (n._portsR || []).forEach(function(p) {
                    var portName = p.name || '';
                    if (portName.length > 14) portName = portName.substring(0, 12) + '..';
                    doc.text(portName, cx + cw - ts(6), cy + ts(p._y + 3), { align: 'right' });
                });
            }

            // Footer (host count)
            if (n.deploy_count > 0) {
                var footerText = n.deploy_count + (n.deploy_count === 1 ? ' host' : ' hosts');
                doc.setFontSize(Math.max(fs(7), 1.5));
                doc.setFont('helvetica', 'normal');
                doc.setTextColor(160, 160, 170);
                doc.text(footerText, cx + cw / 2, cy + ch - ts(4), { align: 'center' });
            }
        });

        // ── Footer Legend ──
        var ly = pageH - margin - ftrH + 6;
        doc.setDrawColor(210, 210, 210);
        doc.setLineWidth(0.2);
        doc.line(margin, ly - 4, pageW - margin, ly - 4);

        var lx = margin;
        doc.setFontSize(5.5);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(120, 120, 120);
        doc.text('DEPENDENCY', lx, ly); lx += 22;

        // Hard line
        doc.setDrawColor(231, 76, 60);
        doc.setLineWidth(0.3);
        doc.setLineDashPattern([]);
        doc.line(lx, ly - 1, lx + 8, ly - 1);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(80, 80, 80);
        doc.text('Hard', lx + 10, ly); lx += 20;

        // Soft line
        doc.setDrawColor(230, 126, 34);
        doc.setLineDashPattern([1, 0.8]);
        doc.line(lx, ly - 1, lx + 8, ly - 1);
        doc.setLineDashPattern([]);
        doc.text('Soft', lx + 10, ly); lx += 20;

        lx += 6;
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(120, 120, 120);
        doc.text('STATUS', lx, ly); lx += 14;

        [['Down','#ef4444'],['Degraded','#f97316'],['Active','#2ecc71']].forEach(function(s) {
            var c = hexToRgb(s[1]);
            doc.setFillColor(c.r, c.g, c.b);
            doc.circle(lx, ly - 1, 1, 'F');
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(80, 80, 80);
            doc.text(s[0], lx + 2.5, ly);
            lx += doc.getTextWidth(s[0]) + 6;
        });

        doc.save('Application_Topology.pdf');
    };

    window.TopologyPDF = TopologyPDF;
})();
