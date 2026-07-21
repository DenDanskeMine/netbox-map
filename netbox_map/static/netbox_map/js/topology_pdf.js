/* NetBox Map — Topology PDF Export */
/* Converts the already-rendered topology SVG straight to a vector PDF via
 * svg2pdf.js, instead of replaying it as thousands of manual jsPDF draw
 * calls. Custom header/footer chrome (title, legend) is still drawn by hand
 * since it isn't part of the on-screen SVG. */

(function() {
    'use strict';

    function hexToRgb(hex) {
        if (!hex) return { r: 108, g: 117, b: 125 };
        hex = hex.replace('#', '');
        if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
        var n = parseInt(hex, 16);
        if (isNaN(n)) return { r: 108, g: 117, b: 125 };
        return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
    }

    function edgeSourceId(e) { return typeof e.source === 'object' ? e.source.id : e.source; }
    function edgeTargetId(e) { return typeof e.target === 'object' ? e.target.id : e.target; }

    /* The on-screen SVG uses the Material Design Icons webfont for role
     * icons (Node view) and the pin indicator (pinned cards) — all of which
     * live at codepoints above U+FFFF (the Supplementary Private Use Area).
     * jsPDF's own TTF embedding only implements cmap format 4 (BMP-only —
     * its cmap subtable parser has no case for format 12), so it can never
     * resolve these glyphs directly, and registering the full 1.3MB webfont
     * produces a PDF with a corrupt/empty embedded font instead (its ~7500
     * glyphs also force the "long" loca table format, which trips up naive
     * TTF embedding same as jsPDF's).
     *
     * mdi-pdf-icons.ttf works around both problems: it's a tiny subset (the
     * ~20 icons this plugin actually uses) with its cmap rewritten onto
     * sequential BMP Private-Use-Area codepoints (U+E000+) that jsPDF's
     * parser can read. ICON_CODEPOINT_MAP below remaps each icon's real MDI
     * codepoint to its matching PUA codepoint in the *cloned* SVG right
     * before conversion — the on-screen SVG keeps using the real webfont
     * and real codepoints untouched. Regenerate both via
     * build_pdf_icon_font.py at the repo root if new icons are added. */
    var ICON_CODEPOINT_MAP = {
        '\u{F0003}': '\uE000', '\u{F0079}': '\uE001', '\u{F0100}': '\uE002',
        '\u{F018D}': '\uE003', '\u{F01BC}': '\uE004', '\u{F0200}': '\uE005',
        '\u{F02CA}': '\uE006', '\u{F0317}': '\uE007', '\u{F035B}': '\uE008',
        '\u{F0361}': '\uE009', '\u{F0379}': '\uE00A', '\u{F03F2}': '\uE00B',
        '\u{F0403}': '\uE00C', '\u{F0427}': '\uE00D', '\u{F042A}': '\uE00E',
        '\u{F0430}': '\uE00F', '\u{F048B}': '\uE010', '\u{F059F}': '\uE011',
        '\u{F08C6}': '\uE012', '\u{F099D}': '\uE013', '\u{F0BC4}': '\uE014',
        '\u{F109B}': '\uE015', '\u{F11E2}': '\uE016',
    };

    // Resolve the font's URL relative to this script's own <script src>,
    // rather than hardcoding /static/... — robust regardless of how NetBox
    // is mounted or whether static file hashing is ever added later.
    // document.currentScript only reflects *this* script during synchronous,
    // non-module, non-dynamically-inserted execution — true for a plain
    // <script src> tag, but fragile in general, so fall back to scanning
    // all script tags on the page for one whose src matches this file.
    var PDF_ICON_FONT_URL = (function() {
        var script = document.currentScript;
        if (!script || !script.src) {
            var scripts = document.querySelectorAll('script[src*="topology_pdf.js"]');
            script = scripts.length > 0 ? scripts[scripts.length - 1] : null;
        }
        if (script && script.src) {
            return script.src.replace(/\/js\/topology_pdf\.js(\?.*)?$/, '/fonts/mdi-pdf-icons.ttf');
        }
        return null;
    })();

    function arrayBufferToBase64(buf) {
        var bytes = new Uint8Array(buf);
        var chunkSize = 8192;
        var chunks = [];
        for (var i = 0; i < bytes.length; i += chunkSize) {
            chunks.push(String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize)));
        }
        return btoa(chunks.join(''));
    }

    // The font-family name used for remapped icon glyphs in the exported
    // SVG clone. Deliberately *not* 'Material Design Icons' (the name the
    // on-screen font uses): svg2pdf measures text width by creating a
    // hidden DOM <text> node styled with the element's own font-family and
    // reading the browser's own layout metrics (see getMeasurementTextNode
    // in svg2pdf.umd.min.js) — it does not ask jsPDF at all for this. If the
    // clone kept claiming 'Material Design Icons', the browser would
    // resolve that name to the *real*, full MDI webfont (registered
    // site-wide by NetBox core) to measure it — which has no glyph for our
    // remapped Private-Use-Area codepoints, so the browser fell back to
    // some unrelated notdef/default width instead of this font's real
    // (uniform, 512/512em) advance width. Glyph *shapes* still came out
    // correct because those are drawn straight from jsPDF's own embedded
    // copy of this font, so this bug only ever showed up as mispositioned
    // (not misshapen) icons — worst on asymmetric glyphs like the phone
    // icon, invisible on symmetric ones like the monitor icon, which is
    // what made it easy to mistake for the glyph's own artwork at first.
    // Using a name unique to this font, and registering a matching
    // FontFace so the *browser* can resolve and measure it too, makes both
    // halves (jsPDF's rendering and svg2pdf's browser-side measurement)
    // agree on the same real metrics.
    var PDF_ICON_FONT_FAMILY = 'MDI PDF Icons';

    // jsPDF's "middle"/"central" text baseline computes its vertical shift
    // generically from font-size and line-height factor alone (see
    // jspdf.umd.min.js, jsPDF.text()'s baseline switch) — it never reads
    // the embedded font's own OS/2 vertical metrics, so the shift it
    // applies undershoots this font's true center-above-baseline and every
    // icon renders measurably too high. Calibrated empirically against this
    // exact font/pipeline by rendering known glyphs and measuring the pixel
    // offset directly (not derived from theory, which undershot the real
    // effect by ~5x) — recalibrate with the same method if mdi-pdf-icons.ttf
    // is rebuilt from a different source font.
    var PDF_ICON_VERTICAL_CORRECTION_EM = 0.088;

    // Fetching + base64-encoding the (tiny, ~4KB) font only needs to happen
    // once per page load — cache the promise across exports. jsPDF fonts
    // are registered per-document though, so registerMdiFont() below still
    // runs for every new jsPDF instance, just reusing this cached data.
    var _mdiFontDataPromise = null;
    function getMdiFontData() {
        if (_mdiFontDataPromise) return _mdiFontDataPromise;
        if (!PDF_ICON_FONT_URL) {
            console.warn('PDF export: could not resolve mdi-pdf-icons.ttf URL (no matching <script> tag found) — icons will render as garbage instead of vector glyphs.');
            _mdiFontDataPromise = Promise.resolve(null);
            return _mdiFontDataPromise;
        }
        console.log('PDF export: loading icon font from', PDF_ICON_FONT_URL);
        _mdiFontDataPromise = fetch(PDF_ICON_FONT_URL)
            .then(function(r) {
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.arrayBuffer();
            })
            .then(function(buf) {
                console.log('PDF export: icon font loaded,', buf.byteLength, 'bytes');
                return { arrayBuffer: buf, base64: arrayBufferToBase64(buf) };
            })
            .catch(function(e) {
                console.error('PDF export: failed to load icon font from ' + PDF_ICON_FONT_URL + ' — icons will render as garbage instead of vector glyphs:', e);
                return null;
            });
        return _mdiFontDataPromise;
    }

    // Register the icon font with jsPDF (so it can draw the glyph outlines
    // into the PDF) *and* with the browser's own font registry (so
    // svg2pdf's DOM-based text-width measurement resolves the same real
    // metrics instead of silently falling back — see PDF_ICON_FONT_FAMILY
    // above). Both must be done before doc.svg() runs.
    var _browserFontLoadPromise = null;
    function registerMdiFont(doc, fontData) {
        if (!fontData) return Promise.resolve();
        doc.addFileToVFS('MaterialDesignIconsPdf.ttf', fontData.base64);
        doc.addFont('MaterialDesignIconsPdf.ttf', PDF_ICON_FONT_FAMILY, 'normal');
        if (!_browserFontLoadPromise) {
            var fontFace = new FontFace(PDF_ICON_FONT_FAMILY, fontData.arrayBuffer);
            document.fonts.add(fontFace);
            _browserFontLoadPromise = fontFace.load().catch(function(e) {
                console.error('PDF export: browser FontFace registration failed — icon centering may be off:', e);
            });
        }
        return _browserFontLoadPromise;
    }

    // Rewrite icon glyphs in the cloned SVG from their real MDI codepoint to
    // the matching PUA codepoint in mdi-pdf-icons.ttf (see block comment
    // above), and force their styling inline. Text elements not using an
    // icon font, or using a glyph outside ICON_CODEPOINT_MAP, are untouched.
    //
    // svg2pdf only reads <style>/<link> elements that are descendants of the
    // SVG root passed to it — it never consults the page's own linked
    // stylesheets. .node-icon gets its font-family, fill, size and
    // positioning entirely from topology.css (an external, page-level
    // stylesheet) with no inline attributes at all, so none of that would
    // be visible to svg2pdf: wrong/default font (the original bug — garbled
    // glyphs) *and* wrong color/position (icons rendering dim and
    // off-center once the codepoint itself was fixed). liveRoot (the actual
    // on-screen SVG, still attached and fully styled) is used to read the
    // real applied values via getComputedStyle so this doesn't hardcode
    // anything that could drift from topology.css — including which value
    // is correct for the current dark/light theme.
    function remapIconGlyphs(root, liveRoot) {
        var liveIcon = liveRoot.querySelector('.node-icon');
        var iconStyle = liveIcon ? getComputedStyle(liveIcon) : null;

        var els = root.querySelectorAll('.node-icon, [font-family="Material Design Icons"]');
        for (var i = 0; i < els.length; i++) {
            var el = els[i];
            var text = el.textContent;
            var mapped = ICON_CODEPOINT_MAP[text];
            if (!mapped) continue;
            el.textContent = mapped;
            el.setAttribute('font-family', PDF_ICON_FONT_FAMILY);
            if (el.classList.contains('node-icon') && iconStyle) {
                el.setAttribute('text-anchor', iconStyle.getPropertyValue('text-anchor') || 'middle');
                // svg2pdf only reads the older SVG 1.1 "alignment-baseline"
                // property for vertical text positioning — it has no
                // handling at all for "dominant-baseline" (the modern CSS
                // Text 3 / SVG2 property topology.css actually uses), so it
                // was silently ignored and every icon fell back to default
                // (roughly baseline-aligned, i.e. shifted up-left instead
                // of centered) regardless of what dominant-baseline said.
                el.setAttribute('dominant-baseline', iconStyle.getPropertyValue('dominant-baseline') || 'central');
                el.setAttribute('alignment-baseline', iconStyle.getPropertyValue('dominant-baseline') || 'central');
                el.setAttribute('fill', iconStyle.getPropertyValue('fill'));
                el.setAttribute('font-size', iconStyle.getPropertyValue('font-size'));
                // jsPDF's "middle"/"central" baseline vertical offset (the
                // PDF_ICON_VERTICAL_CORRECTION_EM constant below) is a fixed
                // fraction of font-size, not derived from this font's real
                // OS/2 vertical metrics — it renders glyphs measurably too
                // high. Empirically calibrated against this exact font/
                // pipeline (see calibrate_pdf_icon_vertical_offset.py).
                el.setAttribute('dy', PDF_ICON_VERTICAL_CORRECTION_EM + 'em');
            }
        }
    }

    /* ===== Constructor ===== */

    function TopologyPDF(state, renderer) {
        this.state = state;
        this.renderer = renderer;
        var btn = document.getElementById('topo-export-pdf');
        if (!btn) return;
        var self = this;
        self._exportBtn = btn;
        btn.addEventListener('click', function() {
            var icon = btn.querySelector('i');
            var origClass = icon.className;
            var origText = btn.textContent;
            self._origIconClass = origClass;
            self._origBtnText = origText;
            icon.className = 'mdi mdi-loading mdi-spin';
            btn.disabled = true;
            // Yield once so the spinner paints before heavy work starts
            setTimeout(function() {
                Promise.resolve()
                    .then(function() { return self.exportPDF(); })
                    .catch(function(e) {
                        console.error('PDF export error:', e);
                        alert('PDF export failed: ' + (e && e.message ? e.message : e));
                    })
                    .then(function() {
                        icon.className = origClass;
                        btn.disabled = false;
                        // Reset text node next to the icon (preserves icon element)
                        self._setExportProgress(null);
                    });
            }, 50);
        });
    }

    /* Update the export button label with progress text. Pass null to clear. */
    TopologyPDF.prototype._setExportProgress = function(text) {
        var btn = this._exportBtn;
        if (!btn) return;
        var icon = btn.querySelector('i');
        // Replace the text-node sibling of the icon, keep the icon
        for (var i = btn.childNodes.length - 1; i >= 0; i--) {
            var n = btn.childNodes[i];
            if (n.nodeType === Node.TEXT_NODE) btn.removeChild(n);
        }
        if (text) btn.appendChild(document.createTextNode(' ' + text));
    };

    TopologyPDF.prototype.exportPDF = function() {
        if (this.state.topologyMode === 'apps') {
            return this.exportAppPDF();
        }
        return this._exportNetworkPDF();
    };

    /* svg2pdf.js measures text width by creating a hidden <svg><text> node
     * (position:absolute; visibility:hidden) and appending it straight to
     * document.body — then caches it on its own internal render context
     * for reuse *within that context* but never removes it afterward. Since
     * an <svg> with no explicit width/height gets a default 300x150 intrinsic
     * box, every export leaves a permanent, invisible element sitting off
     * <body>, inflating the page's scrollable width (visible as empty
     * horizontal scroll space that grows with each export). We can't patch
     * the vendored/minified library, so snapshot body's children before
     * conversion and sweep away anything new it left behind afterward. */
    function snapshotBodyChildren() {
        return new Set(document.body.children);
    }

    function sweepLeakedBodyChildren(before) {
        var current = Array.prototype.slice.call(document.body.children);
        for (var i = 0; i < current.length; i++) {
            if (!before.has(current[i])) document.body.removeChild(current[i]);
        }
    }

    /* Clone the live, already-rendered <g> (edges + node cards/circles) and
     * strip its pan/zoom transform so the clone is in plain "data space",
     * independent of whatever the user currently has panned/zoomed to.
     * getBBox() on the live group is used for sizing — it ignores the
     * element's own transform, so it already reports the full data-space
     * extent regardless of current pan/zoom or which view (Stencil/Node) is
     * currently rendered. */
    function cloneSvgForExport(rendererSvg, rendererG) {
        var bbox = null;
        try { bbox = rendererG.getBBox(); } catch (e) { /* empty/detached SVG */ }
        if (!bbox || bbox.width === 0 || bbox.height === 0) return null;

        var pad = 20;
        var x0 = bbox.x - pad, y0 = bbox.y - pad;
        var w = bbox.width + pad * 2, h = bbox.height + pad * 2;

        var clone = rendererSvg.cloneNode(true);
        var cloneG = clone.querySelector('g');
        if (cloneG) cloneG.removeAttribute('transform');
        remapIconGlyphs(clone, rendererSvg);
        clone.setAttribute('viewBox', x0 + ' ' + y0 + ' ' + w + ' ' + h);
        clone.setAttribute('width', w);
        clone.setAttribute('height', h);
        clone.style.position = 'fixed';
        clone.style.left = '-99999px';
        clone.style.top = '0';
        document.body.appendChild(clone);

        return { element: clone, width: w, height: h };
    }

    /* ===== Network Topology PDF Export ===== */

    TopologyPDF.prototype._exportNetworkPDF = function() {
        var jsPDF = window.jspdf && window.jspdf.jsPDF;
        if (!jsPDF) { alert('jsPDF not loaded'); return; }
        if (!jsPDF.API || typeof jsPDF.API.svg !== 'function') { alert('svg2pdf not loaded'); return; }
        var self = this;

        var state = this.state;
        var nodeData = this.renderer._stencilNodeData;
        if (!nodeData || nodeData.length === 0) { alert('No topology data to export'); return; }

        // Filter to what's currently visible, for the header count and size
        // warning only — the SVG conversion itself just captures whatever's
        // actually on screen, so it doesn't need this list.
        var visibleNodes = nodeData.filter(function(n) { return !state.hiddenNodes.has(n.id); });
        if (state.visibleRoles && state.visibleRoles.size > 0) {
            var roles = {};
            nodeData.forEach(function(n) { if (n.role) roles[n.role] = true; });
            if (state.visibleRoles.size < Object.keys(roles).length) {
                visibleNodes = visibleNodes.filter(function(n) {
                    return !n.role || state.visibleRoles.has(n.role);
                });
            }
        }
        var visibleIds = new Set(visibleNodes.map(function(n) { return n.id; }));
        var visibleEdges = state.edges.filter(function(e) {
            return visibleIds.has(edgeSourceId(e)) && visibleIds.has(edgeTargetId(e));
        });

        if (visibleNodes.length === 0) { alert('No visible devices to export'); return; }

        // Warn on very large exports — a file-size/legibility heads-up now,
        // not a render-time one: we convert the already-rendered SVG in a
        // single svg2pdf call instead of replaying thousands of manual
        // jsPDF draw calls per device/port, which used to scale badly
        // enough to freeze the tab for minutes on topologies like this one
        // (609 devices / ~1500 ports).
        if (visibleNodes.length + visibleEdges.length > 800) {
            var ok = confirm(
                'This topology has ' + visibleNodes.length + ' devices and '
                + visibleEdges.length + ' cables. The exported PDF may be large. Continue?'
            );
            if (!ok) return Promise.resolve();
        }

        var bodyChildrenBefore = snapshotBodyChildren();
        var clonedSvg = cloneSvgForExport(self.renderer.svg.node(), self.renderer.g.node());
        if (!clonedSvg) {
            alert('Nothing to export — the topology canvas is empty.');
            return Promise.resolve();
        }
        var svgW = clonedSvg.width, svgH = clonedSvg.height;

        // Page setup
        var margin = 15, hdrH = 18, ftrH = 14;
        var format = visibleNodes.length > 30 ? 'a3' : 'a4';
        var orientation = (svgW / Math.max(svgH, 1)) > 0.9 ? 'landscape' : 'portrait';

        var doc = new jsPDF({ orientation: orientation, unit: 'mm', format: format, compress: true });
        var pageW = doc.internal.pageSize.getWidth();
        var pageH = doc.internal.pageSize.getHeight();
        var bodyW = pageW - margin * 2;
        var bodyH = pageH - margin * 2 - hdrH - ftrH;
        var scale = Math.min(bodyW / svgW, bodyH / svgH);
        var drawW = svgW * scale, drawH = svgH * scale;
        var offsetX = margin + (bodyW - drawW) / 2;
        var offsetY = margin + hdrH + (bodyH - drawH) / 2;

        // ===== Header =====
        doc.setFontSize(13);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(30, 30, 30);
        doc.text('Network Topology', margin, margin + 10);

        doc.setFontSize(7.5);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(130, 130, 130);
        doc.text('Exported: ' + new Date().toLocaleString(), pageW - margin, margin + 6, { align: 'right' });
        doc.text(visibleNodes.length + ' devices  ·  ' + visibleEdges.length + ' cables', pageW - margin, margin + 11, { align: 'right' });
        doc.setDrawColor(210, 210, 210);
        doc.setLineWidth(0.2);
        doc.line(margin, margin + hdrH - 2, pageW - margin, margin + hdrH - 2);

        self._setExportProgress('Rendering…');

        return getMdiFontData()
            .then(function(fontData) {
                return registerMdiFont(doc, fontData);
            })
            .then(function() {
                return doc.svg(clonedSvg.element, { x: offsetX, y: offsetY, width: drawW, height: drawH });
            })
            .finally(function() {
                document.body.removeChild(clonedSvg.element);
                sweepLeakedBodyChildren(bodyChildrenBefore);
            })
            .then(function() {
                self._setExportProgress('Finalizing…');
                drawNetworkFooter();
                doc.save('Network_Topology.pdf');
            });

        function drawNetworkFooter() {
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
        }
    };

    /* ===== Application Topology PDF Export ===== */

    TopologyPDF.prototype.exportAppPDF = function() {
        var jsPDF = window.jspdf && window.jspdf.jsPDF;
        if (!jsPDF) { alert('jsPDF not loaded'); return; }
        if (!jsPDF.API || typeof jsPDF.API.svg !== 'function') { alert('svg2pdf not loaded'); return; }
        var self = this;

        var state = this.state;
        var nodeData = this.renderer._stencilNodeData;
        if (!nodeData || nodeData.length === 0) { alert('No topology data to export'); return; }

        // Filter to apps only, for the header count and size warning
        var nodes = nodeData.filter(function(n) {
            return n.node_type === 'application' && !state.hiddenNodes.has(n.id);
        });
        var nodeIds = new Set(nodes.map(function(n) { return n.id; }));
        var edges = (state.edges || []).filter(function(e) {
            return e.edge_type === 'dependency' &&
                nodeIds.has(edgeSourceId(e)) && nodeIds.has(edgeTargetId(e));
        });

        if (nodes.length === 0) { alert('No visible apps to export'); return; }

        if (nodes.length + edges.length > 800) {
            var ok = confirm(
                'This topology has ' + nodes.length + ' apps and '
                + edges.length + ' dependencies. The exported PDF may be large. Continue?'
            );
            if (!ok) return Promise.resolve();
        }

        var bodyChildrenBefore = snapshotBodyChildren();
        var clonedSvg = cloneSvgForExport(self.renderer.svg.node(), self.renderer.g.node());
        if (!clonedSvg) {
            alert('Nothing to export — the topology canvas is empty.');
            return Promise.resolve();
        }
        var svgW = clonedSvg.width, svgH = clonedSvg.height;

        // Page setup
        var margin = 15, hdrH = 18, ftrH = 14;
        var format = nodes.length > 25 ? 'a3' : 'a4';
        var orientation = (svgW / Math.max(svgH, 1)) > 0.9 ? 'landscape' : 'portrait';

        var doc = new jsPDF({ orientation: orientation, unit: 'mm', format: format, compress: true });
        var pageW = doc.internal.pageSize.getWidth();
        var pageH = doc.internal.pageSize.getHeight();
        var bodyW = pageW - margin * 2;
        var bodyH = pageH - margin * 2 - hdrH - ftrH;
        var scale = Math.min(bodyW / svgW, bodyH / svgH);
        var drawW = svgW * scale, drawH = svgH * scale;
        var offsetX = margin + (bodyW - drawW) / 2;
        var offsetY = margin + hdrH + (bodyH - drawH) / 2;

        // ── Header ──
        doc.setFontSize(13);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(30, 30, 30);
        doc.text('Application Topology', margin, margin + 10);

        doc.setFontSize(7.5);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(130, 130, 130);
        doc.text('Exported: ' + new Date().toLocaleString(), pageW - margin, margin + 6, { align: 'right' });
        doc.text(nodes.length + ' apps  ·  ' + edges.length + ' dependencies', pageW - margin, margin + 11, { align: 'right' });
        doc.setDrawColor(210, 210, 210);
        doc.setLineWidth(0.2);
        doc.line(margin, margin + hdrH - 2, pageW - margin, margin + hdrH - 2);

        self._setExportProgress('Rendering…');

        return getMdiFontData()
            .then(function(fontData) {
                return registerMdiFont(doc, fontData);
            })
            .then(function() {
                return doc.svg(clonedSvg.element, { x: offsetX, y: offsetY, width: drawW, height: drawH });
            })
            .finally(function() {
                document.body.removeChild(clonedSvg.element);
                sweepLeakedBodyChildren(bodyChildrenBefore);
            })
            .then(function() {
                self._setExportProgress('Finalizing…');
                drawAppFooter();
                doc.save('Application_Topology.pdf');
            });

        function drawAppFooter() {
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
        }
    };

    window.TopologyPDF = TopologyPDF;
})();
