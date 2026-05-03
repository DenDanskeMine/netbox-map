/**
 * FloorplanApp PDF — PDF export using jsPDF on offscreen canvas.
 * Depends on: floorplan_core.js
 */
(function(App) {
    'use strict';

    var FONT_FAMILY = '-apple-system, "Segoe UI", sans-serif';

    function PDF(state, events, renderer) {
        this.state = state;
        this.events = events;
        this.renderer = renderer;

        var self = this;
        var exportPdfBtn = document.getElementById('export-pdf-btn');
        if (exportPdfBtn) {
            exportPdfBtn.addEventListener('click', function() {
                exportPdfBtn.disabled = true;
                exportPdfBtn.innerHTML = '<i class="mdi mdi-loading mdi-spin"></i>';

                setTimeout(function() {
                    try {
                        self.exportPDF();
                    } catch (err) {
                        alert('PDF export failed: ' + err.message);
                    } finally {
                        exportPdfBtn.disabled = false;
                        exportPdfBtn.innerHTML = '<i class="mdi mdi-file-pdf-box"></i>';
                    }
                }, 50);
            });
        }
    }

    PDF.prototype.exportPDF = function() {
        var jsPDF = window.jspdf && window.jspdf.jsPDF;
        if (!jsPDF) {
            alert('PDF library not loaded.');
            return;
        }

        var s = this.state;
        var MM_PER_CELL = 10;
        var margin = 10;
        var headerH = 12;
        var footerH = 8;

        var contentW = s.gridWidth * MM_PER_CELL;
        var contentH = s.gridHeight * MM_PER_CELL;
        var pageW = contentW + margin * 2;
        var pageH = contentH + margin * 2 + headerH + footerH;

        // Offscreen canvas at ~150 DPI
        var PX_PER_MM = 5.9;
        var targetCanvasW = Math.round(contentW * PX_PER_MM);
        var targetCanvasH = Math.round(contentH * PX_PER_MM);

        // Clamp to browser max
        var MAX_PX = 16384;
        if (targetCanvasW > MAX_PX || targetCanvasH > MAX_PX) {
            var clampScale = MAX_PX / Math.max(targetCanvasW, targetCanvasH);
            targetCanvasW = Math.round(targetCanvasW * clampScale);
            targetCanvasH = Math.round(targetCanvasH * clampScale);
        }

        var offCanvas = document.createElement('canvas');
        offCanvas.width = targetCanvasW;
        offCanvas.height = targetCanvasH;
        var offCtx = offCanvas.getContext('2d');

        var scaleX = targetCanvasW / s.worldWidth;
        var scaleY = targetCanvasH / s.worldHeight;
        var renderScale = Math.min(scaleX, scaleY);
        offCtx.scale(renderScale, renderScale);

        // Detect theme — resolution order matches the renderer (issue #41):
        //   1. data-bs-theme attribute on <html>
        //   2. NetBox's localStorage 'netbox-color-mode'
        //   3. prefers-color-scheme media query
        //   4. Fallback: light (NetBox's own default)
        var isDark = (function() {
            var attr = document.documentElement && document.documentElement.getAttribute('data-bs-theme');
            if (attr === 'dark') return true;
            if (attr === 'light') return false;
            try {
                var stored = window.localStorage.getItem('netbox-color-mode');
                if (stored === 'dark') return true;
                if (stored === 'light') return false;
            } catch (e) { /* localStorage may be blocked */ }
            if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
                return true;
            }
            return false;
        })();
        var gridBg = isDark ? '#16192b' : '#dfe1e8';
        var gridLine = isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.08)';
        var gridLineImg = isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.15)';
        var tileBorder = isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.15)';

        // Background
        if (this.renderer.bgImg) {
            offCtx.drawImage(this.renderer.bgImg, 0, 0, s.worldWidth, s.worldHeight);
        } else {
            offCtx.fillStyle = gridBg;
            offCtx.fillRect(0, 0, s.worldWidth, s.worldHeight);
        }

        // Grid lines
        offCtx.strokeStyle = this.renderer.bgImg ? gridLineImg : gridLine;
        offCtx.lineWidth = 1 / renderScale;
        for (var gx = 0; gx <= s.gridWidth; gx++) {
            offCtx.beginPath();
            offCtx.moveTo(gx * s.tileSize, 0);
            offCtx.lineTo(gx * s.tileSize, s.worldHeight);
            offCtx.stroke();
        }
        for (var gy = 0; gy <= s.gridHeight; gy++) {
            offCtx.beginPath();
            offCtx.moveTo(0, gy * s.tileSize);
            offCtx.lineTo(s.worldWidth, gy * s.tileSize);
            offCtx.stroke();
        }

        // FOV cones
        if (s.showFOV) {
            for (var ci = 0; ci < s.tiles.length; ci++) {
                var camTile = s.tiles[ci];
                if (camTile.type !== 'camera' || !s.visibleTypes.has('camera')) continue;

                var camDir = camTile.fov_direction || 0;
                var camAngle = camTile.fov_angle || 90;
                var camDist = camTile.fov_distance || 5;
                var camCx = (camTile.x + camTile.w / 2) * s.tileSize;
                var camCy = (camTile.y + camTile.h / 2) * s.tileSize;
                var camRadius = camDist * s.tileSize;
                var camDirRad = (camDir - 90) * Math.PI / 180;
                var camHalfRad = (camAngle / 2) * Math.PI / 180;

                offCtx.save();
                offCtx.globalAlpha = 0.15;
                offCtx.fillStyle = '#ff4444';
                offCtx.beginPath();
                offCtx.moveTo(camCx, camCy);
                offCtx.arc(camCx, camCy, camRadius, camDirRad - camHalfRad, camDirRad + camHalfRad, false);
                offCtx.closePath();
                offCtx.fill();
                offCtx.globalAlpha = 0.4;
                offCtx.strokeStyle = '#ff4444';
                offCtx.lineWidth = 1 / renderScale;
                offCtx.stroke();
                offCtx.restore();
            }
        }

        // Tiles
        for (var i = 0; i < s.tiles.length; i++) {
            var tile = s.tiles[i];
            if (!s.visibleTypes.has(tile.type)) continue;

            var tx = tile.x * s.tileSize;
            var ty = tile.y * s.tileSize;
            var tw = tile.w * s.tileSize;
            var th = tile.h * s.tileSize;
            var gap = 2;
            var radius = 4;

            var fillColor = tile.type === 'rack'
                ? App.getUtilizationColor(tile.utilization)
                : App.getTileColor(tile.type, s.typeColorMap);

            // Rounded rect
            offCtx.beginPath();
            offCtx.moveTo(tx + gap + radius, ty + gap);
            offCtx.lineTo(tx + tw - gap - radius, ty + gap);
            offCtx.quadraticCurveTo(tx + tw - gap, ty + gap, tx + tw - gap, ty + gap + radius);
            offCtx.lineTo(tx + tw - gap, ty + th - gap - radius);
            offCtx.quadraticCurveTo(tx + tw - gap, ty + th - gap, tx + tw - gap - radius, ty + th - gap);
            offCtx.lineTo(tx + gap + radius, ty + th - gap);
            offCtx.quadraticCurveTo(tx + gap, ty + th - gap, tx + gap, ty + th - gap - radius);
            offCtx.lineTo(tx + gap, ty + gap + radius);
            offCtx.quadraticCurveTo(tx + gap, ty + gap, tx + gap + radius, ty + gap);
            offCtx.closePath();
            offCtx.fillStyle = fillColor;
            offCtx.fill();
            offCtx.strokeStyle = tileBorder;
            offCtx.lineWidth = 1 / renderScale;
            offCtx.stroke();

            // Label text with auto-sizing
            var textColor = App.getTextColor(fillColor);
            if (fillColor.startsWith('hsl')) textColor = isDark ? '#e8e8f0' : '#1a1a2e';
            offCtx.fillStyle = textColor;

            var label = tile.label || '';
            var centerX = tx + tw / 2;
            var centerY = ty + th / 2;
            var innerW = tw - gap * 4;
            var innerH = th - gap * 4;

            // Text orientation — swap effective dimensions for 90°/270°
            var orientDeg = tile.orientation || 0;
            var orientRad = orientDeg * Math.PI / 180;
            var textW = (orientDeg === 90 || orientDeg === 270) ? innerH : innerW;
            var textH = (orientDeg === 90 || orientDeg === 270) ? innerW : innerH;
            var effectiveH = (orientDeg === 90 || orientDeg === 270) ? tw : th;

            var hasSecondary = tile.type === 'rack' && tile.utilization !== null && tile.utilization !== undefined && effectiveH > s.tileSize * 0.8;

            if (label.length > 0) {
                offCtx.save();
                offCtx.beginPath();
                offCtx.rect(tx + gap, ty + gap, tw - gap * 2, th - gap * 2);
                offCtx.clip();

                // Translate to center and rotate for text orientation
                offCtx.translate(centerX, centerY);
                offCtx.rotate(orientRad);

                offCtx.textAlign = 'center';
                offCtx.textBaseline = 'middle';

                var maxLabelH = hasSecondary ? textH * 0.55 : textH * 0.8;
                var fit = App.autoFontSize(offCtx, label, textW, maxLabelH, 6, s.tileSize / 2.5);

                if (!fit.fits) {
                    offCtx.font = 'bold ' + fit.size + 'px ' + FONT_FAMILY;
                    label = App.truncateText(offCtx, label, textW);
                } else {
                    offCtx.font = 'bold ' + fit.size + 'px ' + FONT_FAMILY;
                }

                if (hasSecondary) {
                    offCtx.fillText(label, 0, -fit.size * 0.4);
                } else {
                    offCtx.fillText(label, 0, 0);
                }
                offCtx.restore();
            }

            // Secondary text (utilization)
            if (hasSecondary) {
                var secSize = Math.max(6, textH * 0.25);
                secSize = Math.min(secSize, s.tileSize / 3.5);
                offCtx.font = secSize + 'px ' + FONT_FAMILY;
                offCtx.textAlign = 'center';
                offCtx.textBaseline = 'middle';
                offCtx.globalAlpha = 0.7;
                offCtx.save();
                offCtx.beginPath();
                offCtx.rect(tx + gap, ty + gap, tw - gap * 2, th - gap * 2);
                offCtx.clip();
                offCtx.translate(centerX, centerY);
                offCtx.rotate(orientRad);
                var secY = label.length > 0 ? textH * 0.25 : 0;
                offCtx.fillText(Math.round(tile.utilization) + '%', 0, secY);
                offCtx.restore();
                offCtx.globalAlpha = 1.0;
            }
        }

        // Convert to JPEG
        var imgData = offCanvas.toDataURL('image/jpeg', 0.95);

        // Create PDF
        var landscape = pageW > pageH;
        var pdf = new jsPDF({
            orientation: landscape ? 'landscape' : 'portrait',
            unit: 'mm',
            format: landscape ? [pageH, pageW] : [pageW, pageH]
        });

        // Page background for dark mode
        if (isDark) {
            pdf.setFillColor(13, 15, 26);
            pdf.rect(0, 0, landscape ? pageH : pageW, landscape ? pageW : pageH, 'F');
        }

        // Title — strip " | NetBox" suffix
        var fpName = (document.title || 'Floor Plan').replace(/\s*\|\s*NetBox\s*$/, '');
        pdf.setFontSize(10);
        pdf.setTextColor(isDark ? 200 : 60, isDark ? 200 : 60, isDark ? 210 : 60);
        var maxTitleW = pageW - margin * 2 - 50;
        while (pdf.getTextWidth(fpName) > maxTitleW && fpName.length > 10) {
            fpName = fpName.substring(0, fpName.length - 4) + '...';
        }
        pdf.text(fpName, margin, margin + 5);

        // Date
        pdf.setFontSize(7);
        pdf.setTextColor(isDark ? 140 : 140, isDark ? 140 : 140, isDark ? 150 : 140);
        pdf.text('Exported: ' + new Date().toLocaleString(), pageW - margin, margin + 5, { align: 'right' });

        // Image
        pdf.addImage(imgData, 'JPEG', margin, margin + headerH, contentW, contentH);

        // Legend — wrap long text to fit page width
        var legendY = margin + headerH + contentH + 2;
        pdf.setFontSize(5.5);
        pdf.setTextColor(isDark ? 140 : 120, isDark ? 140 : 120, isDark ? 150 : 120);
        var tileCount = s.tiles.filter(function(t) { return s.visibleTypes.has(t.type); }).length;
        var statsLine = 'Tiles: ' + tileCount + '/' + s.tiles.length + '  |  Grid: ' + s.gridWidth + 'x' + s.gridHeight;
        pdf.text(statsLine, pageW - margin, legendY + 3, { align: 'right' });

        var legendItems = [];
        for (var ti = 0; ti < s.allTypes.length; ti++) {
            if (s.visibleTypes.has(s.allTypes[ti])) {
                legendItems.push(s.typeNameMap[s.allTypes[ti]] || s.allTypes[ti]);
            }
        }
        var maxTextW = pageW - margin * 2 - pdf.getTextWidth(statsLine) - 5;
        var visibleText = 'Visible: ' + legendItems.join(', ');
        if (pdf.getTextWidth(visibleText) > maxTextW) {
            visibleText = 'Showing ' + legendItems.length + ' of ' + s.allTypes.length + ' types';
        }
        pdf.text(visibleText, margin, legendY + 3);

        // Download
        var safeName = (fpName || 'floorplan').replace(/[^a-zA-Z0-9_\- ]/g, '').trim() || 'floorplan';
        pdf.save(safeName + '.pdf');
    };

    App.PDF = PDF;

})(window.FloorplanApp);
