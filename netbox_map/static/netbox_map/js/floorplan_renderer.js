/**
 * FloorplanApp Renderer — Canvas rendering: tiles, grid, FOV cones, zoom indicator.
 * Depends on: floorplan_core.js
 */
(function(App) {
    'use strict';

    var FONT_FAMILY = '-apple-system, "Segoe UI", sans-serif';

    function Renderer(state, events) {
        this.state = state;
        this.events = events;
        this.canvas = null;
        this.ctx = null;
        this.container = null;
        this.bgImg = null;
        this._isDark = true; // will be updated on render

        // Listen for render requests
        var self = this;
        events.on('render', function() { self.render(); });
        events.on('tile:select', function() { self.render(); });
        events.on('tile:deselect', function() { self.render(); });
        events.on('tile:update', function() { self.render(); });
        events.on('tile:create', function() { self.render(); });
        events.on('tile:delete', function() { self.render(); });
        events.on('type:toggle', function() { self.render(); });
    }

    Renderer.prototype.init = function(container, canvas) {
        this.container = container;
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.resize();
    };

    /** Resize canvas to fill container, using devicePixelRatio for crispness. */
    Renderer.prototype.resize = function() {
        var s = this.state;
        var cw = this.container.clientWidth;
        var ch = this.container.clientHeight || Math.min(s.worldHeight, window.innerHeight * 0.75);
        var dpr = window.devicePixelRatio || 1;
        this.canvas.width = cw * dpr;
        this.canvas.height = ch * dpr;
        this.canvas.style.width = cw + 'px';
        this.canvas.style.height = ch + 'px';
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    /** Fit entire grid into view with 5% padding. */
    Renderer.prototype.fitToView = function() {
        var s = this.state;
        var cw = this.container.clientWidth;
        var ch = parseFloat(this.canvas.style.height);
        var scaleX = cw / s.worldWidth;
        var scaleY = ch / s.worldHeight;
        s.zoom = Math.min(scaleX, scaleY) * 0.95;
        s.zoom = Math.max(s.MIN_ZOOM, Math.min(s.MAX_ZOOM, s.zoom));
        s.panX = (cw - s.worldWidth * s.zoom) / 2;
        s.panY = (ch - s.worldHeight * s.zoom) / 2;
    };

    /** Convert screen (mouse) coordinates to world (grid pixel) coordinates. */
    Renderer.prototype.screenToWorld = function(sx, sy) {
        var s = this.state;
        return {
            x: (sx - s.panX) / s.zoom,
            y: (sy - s.panY) / s.zoom
        };
    };

    /** Find tile at world coordinates. Returns first matching visible tile or null. */
    Renderer.prototype.findTileAt = function(wx, wy) {
        var s = this.state;
        var tiles = s.tiles;
        for (var i = tiles.length - 1; i >= 0; i--) {
            var t = tiles[i];
            if (!s.visibleTypes.has(t.type)) continue;
            var tx = t.x * s.tileSize;
            var ty = t.y * s.tileSize;
            var tw = t.w * s.tileSize;
            var th = t.h * s.tileSize;
            if (wx >= tx && wx < tx + tw && wy >= ty && wy < ty + th) return t;
        }
        return null;
    };

    // ─── Drawing Helpers ─────────────────────────────────────────

    /** Draw rounded rectangle path. */
    Renderer.prototype._roundRect = function(x, y, w, h, r) {
        var ctx = this.ctx;
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + r);
        ctx.lineTo(x + w, y + h - r);
        ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        ctx.lineTo(x + r, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
    };

    /** Detect current NetBox theme (light vs dark). */
    Renderer.prototype._detectTheme = function() {
        var el = document.documentElement;
        this._isDark = !el || el.getAttribute('data-bs-theme') !== 'light';
    };

    /** Theme-aware canvas colors. */
    Renderer.prototype._colors = function() {
        if (this._isDark) {
            return {
                canvasBg: '#0d0f1a',
                gridBg: '#16192b',
                gridLine: 'rgba(255, 255, 255, 0.06)',
                gridLineImg: 'rgba(255, 255, 255, 0.12)',
                zoomText: 'rgba(255, 255, 255, 0.4)',
                selectStroke: '#00d4ff',
                selectShadow: '#00d4ff',
                normalBorder: 'rgba(255, 255, 255, 0.12)',
            };
        }
        return {
            canvasBg: '#e8eaef',
            gridBg: '#dfe1e8',
            gridLine: 'rgba(0, 0, 0, 0.08)',
            gridLineImg: 'rgba(0, 0, 0, 0.15)',
            zoomText: 'rgba(0, 0, 0, 0.35)',
            selectStroke: '#0d6efd',
            selectShadow: '#0d6efd',
            normalBorder: 'rgba(0, 0, 0, 0.15)',
        };
    };

    /** Get fill color for a tile based on type and utilization. */
    Renderer.prototype._getTileFillColor = function(tile) {
        if (tile.type === 'rack') {
            return App.getUtilizationColor(tile.utilization);
        }
        return App.getTileColor(tile.type, this.state.typeColorMap);
    };

    /** Get text color that contrasts with background. */
    Renderer.prototype._getTextColor = function(bgColor) {
        if (bgColor.startsWith('hsl')) {
            var match = bgColor.match(/hsl\((\d+),\s*([\d.]+)%,\s*([\d.]+)%\)/);
            if (match) return parseFloat(match[3]) > 50 ? '#1a1a2e' : '#e8e8f0';
            return '#e8e8f0';
        }
        return App.getTextColor(bgColor);
    };

    // ─── Tile Rendering ──────────────────────────────────────────

    /** Draw a single tile on the canvas (world space). */
    Renderer.prototype.drawTile = function(tile) {
        var s = this.state;
        var ctx = this.ctx;
        var ts = s.tileSize;
        var x = tile.x * ts;
        var y = tile.y * ts;
        var w = tile.w * ts;
        var h = tile.h * ts;
        var gap = 2;
        var radius = 4;

        var fillColor = this._getTileFillColor(tile);

        // Fill
        this._roundRect(x + gap, y + gap, w - gap * 2, h - gap * 2, radius);
        ctx.fillStyle = fillColor;
        ctx.fill();

        // Border (selected = cyan glow, normal = subtle)
        var isSelected = s.selectedTile && s.selectedTile.id === tile.id;
        var c = this._colors();
        if (isSelected) {
            ctx.strokeStyle = c.selectStroke;
            ctx.lineWidth = 2.5 / s.zoom;
            ctx.shadowColor = c.selectShadow;
            ctx.shadowBlur = 8 / s.zoom;
        } else {
            ctx.strokeStyle = c.normalBorder;
            ctx.lineWidth = 1 / s.zoom;
            ctx.shadowColor = 'transparent';
            ctx.shadowBlur = 0;
        }
        this._roundRect(x + gap, y + gap, w - gap * 2, h - gap * 2, radius);
        ctx.stroke();
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;

        // ── Label text with auto-sizing ──
        var textColor = this._getTextColor(fillColor);
        ctx.fillStyle = textColor;

        var label = tile.label || '';
        var centerX = x + w / 2;
        var centerY = y + h / 2;
        var innerW = w - gap * 4;
        var innerH = h - gap * 4;

        // Text orientation — swap effective dimensions for 90°/270°
        var orientDeg = tile.orientation || 0;
        var orientRad = orientDeg * Math.PI / 180;
        var textW = (orientDeg === 90 || orientDeg === 270) ? innerH : innerW;
        var textH = (orientDeg === 90 || orientDeg === 270) ? innerW : innerH;
        var effectiveH = (orientDeg === 90 || orientDeg === 270) ? w : h;

        // Determine if there's secondary text (utilization %, port count)
        var hasSecondary = false;
        var secondaryText = '';
        if (tile.type === 'rack' && tile.utilization !== null && tile.utilization !== undefined && effectiveH > ts * 0.8) {
            hasSecondary = true;
            secondaryText = Math.round(tile.utilization) + '%';
        } else if (tile.type === 'drop' && tile.drop_port_count && effectiveH > ts * 0.8) {
            hasSecondary = true;
            secondaryText = tile.drop_port_count + ' port' + (tile.drop_port_count !== 1 ? 's' : '');
        }

        if (label.length > 0) {
            ctx.save();
            ctx.beginPath();
            ctx.rect(x + gap, y + gap, w - gap * 2, h - gap * 2);
            ctx.clip();

            // Translate to center and rotate for text orientation
            ctx.translate(centerX, centerY);
            ctx.rotate(orientRad);

            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            // Auto-size: find largest font that fits the effective text width.
            // Both min and max scale with tile size so text fits at any zoom level.
            var maxLabelH = hasSecondary ? textH * 0.55 : textH * 0.8;
            var minFontSize = Math.max(1, Math.floor(ts * 0.08));
            var maxFontSize = Math.max(minFontSize, Math.floor(maxLabelH));
            var fit = App.autoFontSize(ctx, label, textW, maxLabelH, minFontSize, maxFontSize);

            if (!fit.fits) {
                // Text too long even at min size — truncate with ellipsis
                ctx.font = 'bold ' + fit.size + 'px ' + FONT_FAMILY;
                label = App.truncateText(ctx, label, textW);
            } else {
                ctx.font = 'bold ' + fit.size + 'px ' + FONT_FAMILY;
            }

            if (hasSecondary) {
                ctx.fillText(label, 0, -fit.size * 0.4);
            } else {
                ctx.fillText(label, 0, 0);
            }

            ctx.restore();
        }

        // Secondary text (utilization / port count)
        if (hasSecondary && secondaryText) {
            var secSize = Math.max(6, (label.length > 0 ? textH * 0.25 : textH * 0.4));
            secSize = Math.min(secSize, ts / 3.5);
            ctx.font = secSize + 'px ' + FONT_FAMILY;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.globalAlpha = 0.7;
            ctx.save();
            ctx.beginPath();
            ctx.rect(x + gap, y + gap, w - gap * 2, h - gap * 2);
            ctx.clip();
            ctx.translate(centerX, centerY);
            ctx.rotate(orientRad);
            var secY = label.length > 0 ? textH * 0.25 : 0;
            ctx.fillText(secondaryText, 0, secY);
            ctx.restore();
            ctx.globalAlpha = 1.0;
        }

        // Camera direction arrow
        if (tile.type === 'camera') {
            this._drawCameraArrow(tile, centerX, centerY, w, h, textColor);
        }
    };

    /** Draw camera direction indicator arrow on tile. */
    Renderer.prototype._drawCameraArrow = function(tile, cx, cy, w, h, textColor) {
        var ctx = this.ctx;
        var s = this.state;
        var arrowLen = Math.min(w, h) * 0.2;
        var dirRad = ((tile.fov_direction || 0) - 90) * Math.PI / 180;
        var arrowX = cx + Math.cos(dirRad) * arrowLen;
        var arrowY = cy + Math.sin(dirRad) * arrowLen;

        ctx.save();
        ctx.strokeStyle = textColor;
        ctx.lineWidth = 2 / s.zoom;
        ctx.globalAlpha = 0.7;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(arrowX, arrowY);
        ctx.stroke();

        var headLen = arrowLen * 0.4;
        var headAngle = 0.5;
        ctx.beginPath();
        ctx.moveTo(arrowX, arrowY);
        ctx.lineTo(arrowX - Math.cos(dirRad - headAngle) * headLen, arrowY - Math.sin(dirRad - headAngle) * headLen);
        ctx.moveTo(arrowX, arrowY);
        ctx.lineTo(arrowX - Math.cos(dirRad + headAngle) * headLen, arrowY - Math.sin(dirRad + headAngle) * headLen);
        ctx.stroke();
        ctx.restore();
    };

    // ─── FOV Cone ────────────────────────────────────────────────

    /** Draw camera FOV cone (semi-transparent wedge from tile center). */
    Renderer.prototype.drawFOV = function(tile) {
        if (tile.type !== 'camera') return;
        var s = this.state;
        var ctx = this.ctx;
        var ts = s.tileSize;

        var direction = tile.fov_direction || 0;
        var angle = tile.fov_angle || 90;
        var distance = tile.fov_distance || 5;

        var cx = (tile.x + tile.w / 2) * ts;
        var cy = (tile.y + tile.h / 2) * ts;
        var radius = distance * ts;

        var dirRad = (direction - 90) * Math.PI / 180;
        var halfAngleRad = (angle / 2) * Math.PI / 180;
        var startAngle = dirRad - halfAngleRad;
        var endAngle = dirRad + halfAngleRad;

        ctx.save();
        ctx.globalAlpha = 0.15;
        ctx.fillStyle = '#ff4444';
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, radius, startAngle, endAngle, false);
        ctx.closePath();
        ctx.fill();

        ctx.globalAlpha = 0.4;
        ctx.strokeStyle = '#ff4444';
        ctx.lineWidth = 1.5 / s.zoom;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, radius, startAngle, endAngle, false);
        ctx.closePath();
        ctx.stroke();
        ctx.restore();
    };

    // ─── Grid ────────────────────────────────────────────────────

    /** Draw grid lines (world space, transform already applied). */
    Renderer.prototype.drawGrid = function() {
        var s = this.state;
        var ctx = this.ctx;
        var c = this._colors();

        if (!this.bgImg) {
            ctx.fillStyle = c.gridBg;
            ctx.fillRect(0, 0, s.worldWidth, s.worldHeight);
        }

        ctx.strokeStyle = this.bgImg ? c.gridLineImg : c.gridLine;
        ctx.lineWidth = 1 / s.zoom;

        for (var x = 0; x <= s.gridWidth; x++) {
            ctx.beginPath();
            ctx.moveTo(x * s.tileSize, 0);
            ctx.lineTo(x * s.tileSize, s.worldHeight);
            ctx.stroke();
        }
        for (var y = 0; y <= s.gridHeight; y++) {
            ctx.beginPath();
            ctx.moveTo(0, y * s.tileSize);
            ctx.lineTo(s.worldWidth, y * s.tileSize);
            ctx.stroke();
        }
    };

    // ─── Full Render ─────────────────────────────────────────────

    /** Full canvas render: clear → background → grid → FOV → tiles → zoom indicator. */
    Renderer.prototype.render = function() {
        var s = this.state;
        var ctx = this.ctx;
        var dpr = window.devicePixelRatio || 1;
        var cw = parseFloat(this.canvas.style.width);
        var ch = parseFloat(this.canvas.style.height);

        // Detect theme and reset transform
        this._detectTheme();
        var c = this._colors();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = c.canvasBg;
        ctx.fillRect(0, 0, cw, ch);

        // Apply pan/zoom
        ctx.translate(s.panX, s.panY);
        ctx.scale(s.zoom, s.zoom);

        // Background image
        if (this.bgImg) {
            ctx.drawImage(this.bgImg, 0, 0, s.worldWidth, s.worldHeight);
        }

        // Grid
        this.drawGrid();

        // FOV cones (underneath tiles)
        if (s.showFOV) {
            for (var fi = 0; fi < s.tiles.length; fi++) {
                if (s.tiles[fi].type === 'camera' && s.visibleTypes.has('camera')) {
                    this.drawFOV(s.tiles[fi]);
                }
            }
        }

        // Visible tiles
        for (var i = 0; i < s.tiles.length; i++) {
            if (s.visibleTypes.has(s.tiles[i].type)) {
                this.drawTile(s.tiles[i]);
            }
        }

        // Reset transform for UI overlay
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        // Zoom indicator
        ctx.fillStyle = c.zoomText;
        ctx.font = '11px ' + FONT_FAMILY;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'bottom';
        ctx.fillText(Math.round(s.zoom * 100) + '%', cw - 8, ch - 6);
    };

    /** Load background image asynchronously. Calls callback when done (or immediately if none). */
    Renderer.prototype.loadBackgroundImage = function(callback) {
        var self = this;
        if (this.state.backgroundImageUrl) {
            var img = new Image();
            img.onload = function() {
                self.bgImg = img;
                if (callback) callback();
            };
            img.onerror = function() {
                console.warn('Failed to load background image');
                if (callback) callback();
            };
            img.src = this.state.backgroundImageUrl;
        } else {
            if (callback) callback();
        }
    };

    App.Renderer = Renderer;

})(window.FloorplanApp);
