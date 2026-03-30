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
        var jsPDF = window.jspdf && window.jspdf.jsPDF;
        if (!jsPDF) { alert('jsPDF not loaded'); return; }

        var state = this.state;
        var nodeData = this.renderer._stencilNodeData;
        if (!nodeData || nodeData.length === 0) { alert('No topology data to export'); return; }

        // Filter hidden
        var visibleNodes = nodeData.filter(function(n) { return !state.hiddenNodes.has(n.id); });
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

        // ===== Cable Labels =====
        visibleEdges.forEach(function(edge) {
            var sid = edgeSourceId(edge), tid = edgeTargetId(edge);
            var sp = getPortPos(edge.source_port, tid);
            var tp = getPortPos(edge.target_port, sid);
            if (!sp || !tp) return;

            var label = '#' + edge.cable_id;
            if (edge.cable_type) label += ' ' + edge.cable_type;

            var midX, midY, angle = 0;
            if (state.cableStyle === 'ortho') {
                var sD = sp.side === 'right' ? 1 : -1;
                var tD = tp.side === 'right' ? 1 : -1;
                var out = Math.max(Math.abs(tp.x - sp.x) * 0.2, 30);
                midX = (sp.x + out*sD + tp.x + out*tD) / 2;
                midY = (sp.y + tp.y) / 2;
            } else {
                var dx = Math.abs(tp.x - sp.x);
                var cp = Math.max(dx * 0.45, 60);
                var sD2 = sp.side === 'right' ? 1 : -1;
                var tD2 = tp.side === 'right' ? 1 : -1;
                var mid = bezierMidpoint(sp.x, sp.y, sp.x+cp*sD2, sp.y, tp.x+cp*tD2, tp.y, tp.x, tp.y);
                midX = mid.x; midY = mid.y; angle = mid.angle;
                if (angle > 90) angle -= 180;
                if (angle < -90) angle += 180;
            }

            doc.setFontSize(Math.max(fs(8), 2.5));
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(120, 120, 130);
            doc.text(label, tx(midX), ty(midY) - Math.max(ts(4), 0.8), { angle: -angle, align: 'center' });
        });

        // ===== Device Cards =====
        visibleNodes.forEach(function(node) {
            var cx = tx(node.x), cy = ty(node.y);
            var cw = ts(CARD_W), ch = ts(node._cardH || 60);
            var cr = Math.max(ts(6), 0.6);

            // Shadow
            doc.setFillColor(215, 215, 220);
            doc.roundedRect(cx + 0.4, cy + 0.4, cw, ch, cr, cr, 'F');

            // Card body
            doc.setFillColor(255, 255, 255);
            doc.setDrawColor(195, 195, 200);
            doc.setLineWidth(0.15);
            doc.roundedRect(cx, cy, cw, ch, cr, cr, 'FD');

            // Role stripe
            var rRgb = hexToRgb(node.role_color);
            doc.setFillColor(rRgb.r, rRgb.g, rRgb.b);
            var stripeH = Math.max(ts(4), 0.5);
            doc.rect(cx + cr, cy, cw - cr * 2, stripeH, 'F');

            // Name
            doc.setFontSize(Math.max(fs(11.5), 4));
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(25, 25, 30);
            var name = node.name || '';
            if (name.length > 20) name = name.substring(0, 18) + '..';
            doc.text(name, cx + cw / 2, cy + ts(18), { align: 'center' });

            // Type
            doc.setFontSize(Math.max(fs(8.5), 2.5));
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(120, 125, 150);
            var typeStr = node.device_type || '';
            if (typeStr.length > 24) typeStr = typeStr.substring(0, 22) + '..';
            doc.text(typeStr, cx + cw / 2, cy + ts(30), { align: 'center' });

            // Separator
            doc.setDrawColor(225, 225, 230);
            doc.setLineWidth(0.1);
            doc.line(cx + ts(4), cy + ts(HEADER_H - 1), cx + cw - ts(4), cy + ts(HEADER_H - 1));

            // Ports
            (node.ports || []).forEach(function(port, i) {
                var py = cy + ts(HEADER_H + i * (PORT_H + PORT_GAP));
                var ph = ts(PORT_H);

                // Alternating row
                doc.setFillColor(i % 2 === 0 ? 247 : 252, i % 2 === 0 ? 247 : 252, i % 2 === 0 ? 250 : 254);
                doc.rect(cx, py, cw, ph, 'F');

                // Accent bar
                var pRgb = hexToRgb(portColorHex(port));
                doc.setFillColor(pRgb.r, pRgb.g, pRgb.b);
                doc.rect(cx, py + ts(2), Math.max(ts(3), 0.3), Math.max(ph - ts(4), 1), 'F');

                // Port name
                doc.setFontSize(Math.max(fs(10), 2.5));
                doc.setFont('courier', 'normal');
                doc.setTextColor(35, 35, 45);
                var pn = port.name;
                if (pn.length > 14) pn = pn.substring(0, 12) + '..';
                doc.text(pn, cx + ts(10), py + ph * 0.65);

                // Speed text
                var badge = portBadge(port);
                if (badge) {
                    doc.setFontSize(Math.max(fs(9), 2));
                    doc.setFont('helvetica', 'bold');
                    doc.setTextColor(pRgb.r, pRgb.g, pRgb.b);
                    doc.text(badge, cx + cw - ts(8), py + ph * 0.65, { align: 'right' });
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

    window.TopologyPDF = TopologyPDF;
})();
