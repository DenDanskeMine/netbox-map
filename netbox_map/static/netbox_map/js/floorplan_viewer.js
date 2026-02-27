/**
 * FloorPlan Viewer - Renders the interactive floor plan grid on a canvas.
 * Supports pan/zoom, click selection, hover tooltips, and color coding.
 */
(function() {
    'use strict';

    const container = document.getElementById('floorplan-container');
    if (!container) return;

    const canvas = document.getElementById('floorplan-canvas');
    const ctx = canvas.getContext('2d');

    // Read configuration from data attributes
    const gridWidth = parseInt(container.dataset.gridWidth, 10);
    const gridHeight = parseInt(container.dataset.gridHeight, 10);
    const tileSize = parseInt(container.dataset.tileSize, 10);
    const backgroundImageUrl = container.dataset.backgroundImage || null;
    var detailBaseUrl = container.dataset.detailBaseUrl || '/plugins/map/marker-detail/';

    // Parse tile data
    let tiles = [];
    try {
        tiles = JSON.parse(container.dataset.tiles || '[]');
    } catch (e) {
        console.error('Failed to parse tile data:', e);
    }

    // Parse popover field configuration (supports dict per tile type or flat array for backward compat)
    var defaultPopoverFields = ['label', 'object_info', 'primary_ip', 'utilization', 'position', 'size'];
    var popoverConfig = {};
    try {
        var pf = JSON.parse(container.dataset.popoverFields || '{}');
        if (Array.isArray(pf)) {
            // Backward compat: flat array = default config for all types
            popoverConfig = {'default': pf.length > 0 ? pf : defaultPopoverFields};
        } else if (typeof pf === 'object' && pf !== null) {
            popoverConfig = pf;
        }
    } catch (e) {
        // keep defaults
    }
    if (!popoverConfig['default']) {
        popoverConfig['default'] = defaultPopoverFields;
    }

    // World dimensions (the full grid in pixels)
    const worldWidth = gridWidth * tileSize;
    const worldHeight = gridHeight * tileSize;

    let selectedTile = null;
    let bgImg = null;

    // ===== Type configuration from server (dynamic, includes custom types) =====
    var TYPE_CONFIGS = [];
    try {
        TYPE_CONFIGS = JSON.parse(container.dataset.typeConfigs || '[]');
    } catch (e) {
        console.error('Failed to parse type configs:', e);
    }
    // Build lookup maps from TYPE_CONFIGS
    var TYPE_COLOR_MAP = {};
    var TYPE_NAME_MAP = {};
    var ALL_TYPES = [];
    TYPE_CONFIGS.forEach(function(tc) {
        ALL_TYPES.push(tc.slug);
        TYPE_COLOR_MAP[tc.slug] = tc.color;
        TYPE_NAME_MAP[tc.slug] = tc.name;
    });

    // ===== Visible Types (toggle filtering) =====
    var visibleTypes = new Set(ALL_TYPES);
    var showFOV = true;

    // ===== Pan / Zoom State =====
    var zoom = 1;
    var panX = 0;       // pan offset in screen pixels
    var panY = 0;
    var MIN_ZOOM = 0.15;
    var MAX_ZOOM = 5;

    // Panning state
    var isPanning = false;
    var panStartX = 0;
    var panStartY = 0;
    var panStartOffsetX = 0;
    var panStartOffsetY = 0;
    var didPan = false;  // track if a real pan occurred (to avoid click after drag)

    // Tile drag state (edit mode only)
    var editMode = container.dataset.editMode === 'true';
    var isDraggingTile = false;
    var dragTile = null;
    var dragOrigX = 0;
    var dragOrigY = 0;

    /**
     * Resize the canvas to fill its container, using devicePixelRatio for crispness.
     */
    function resizeCanvas() {
        var cw = container.clientWidth;
        var ch = container.clientHeight || Math.min(worldHeight, window.innerHeight * 0.75);
        var dpr = window.devicePixelRatio || 1;
        canvas.width = cw * dpr;
        canvas.height = ch * dpr;
        canvas.style.width = cw + 'px';
        canvas.style.height = ch + 'px';
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    /**
     * Fit the entire grid into view.
     */
    function fitToView() {
        var cw = container.clientWidth;
        var ch = parseFloat(canvas.style.height);
        var scaleX = cw / worldWidth;
        var scaleY = ch / worldHeight;
        zoom = Math.min(scaleX, scaleY) * 0.95;  // 5% padding
        zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
        // Center the grid
        panX = (cw - worldWidth * zoom) / 2;
        panY = (ch - worldHeight * zoom) / 2;
    }

    /**
     * Convert screen (mouse) coordinates to world (grid pixel) coordinates.
     */
    function screenToWorld(sx, sy) {
        return {
            x: (sx - panX) / zoom,
            y: (sy - panY) / zoom
        };
    }

    /**
     * Get color based on utilization percentage using a smooth gradient.
     */
    function getUtilizationColor(utilization) {
        if (utilization === null || utilization === undefined) {
            return '#6b6b80';
        }
        var pct = Math.min(utilization, 100) / 100;
        var hue = 120 * (1 - pct);
        var sat = 70 + pct * 15;
        var light = 42 - pct * 10;
        return 'hsl(' + hue + ', ' + sat + '%, ' + light + '%)';
    }

    /**
     * Get color for non-rack tile types.
     */
    function getTileTypeColor(tileType) {
        return TYPE_COLOR_MAP[tileType] || '#6b6b80';
    }

    /**
     * Determine text color based on background brightness.
     */
    function getTextColor(bgColor) {
        if (bgColor.startsWith('hsl')) {
            var match = bgColor.match(/hsl\((\d+),\s*([\d.]+)%,\s*([\d.]+)%\)/);
            if (match) {
                return parseFloat(match[3]) > 50 ? '#1a1a2e' : '#e8e8f0';
            }
            return '#e8e8f0';
        }
        var hex = bgColor.replace('#', '');
        var r = parseInt(hex.substring(0, 2), 16);
        var g = parseInt(hex.substring(2, 4), 16);
        var b = parseInt(hex.substring(4, 6), 16);
        var luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        return luminance > 0.45 ? '#1a1a2e' : '#e8e8f0';
    }

    /**
     * Draw the grid background (in world space — transform already applied).
     */
    function drawGrid() {
        if (!bgImg) {
            ctx.fillStyle = '#16192b';
            ctx.fillRect(0, 0, worldWidth, worldHeight);
        }

        ctx.strokeStyle = bgImg ? 'rgba(255, 255, 255, 0.12)' : 'rgba(255, 255, 255, 0.06)';
        ctx.lineWidth = 1 / zoom;  // keep lines 1px on screen regardless of zoom

        for (var x = 0; x <= gridWidth; x++) {
            ctx.beginPath();
            ctx.moveTo(x * tileSize, 0);
            ctx.lineTo(x * tileSize, worldHeight);
            ctx.stroke();
        }
        for (var y = 0; y <= gridHeight; y++) {
            ctx.beginPath();
            ctx.moveTo(0, y * tileSize);
            ctx.lineTo(worldWidth, y * tileSize);
            ctx.stroke();
        }
    }

    /**
     * Draw a rounded rectangle.
     */
    function roundRect(x, y, w, h, r) {
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
    }

    /**
     * Draw a single tile on the canvas (world space).
     */
    function drawTile(tile) {
        var x = tile.x * tileSize;
        var y = tile.y * tileSize;
        var w = tile.w * tileSize;
        var h = tile.h * tileSize;
        var gap = 2;
        var radius = 4;

        var fillColor;
        if (tile.type === 'rack') {
            fillColor = getUtilizationColor(tile.utilization);
        } else {
            fillColor = getTileTypeColor(tile.type);
        }

        roundRect(x + gap, y + gap, w - gap * 2, h - gap * 2, radius);
        ctx.fillStyle = fillColor;
        ctx.fill();

        var isSelected = selectedTile && selectedTile.id === tile.id;
        if (isSelected) {
            ctx.strokeStyle = '#00d4ff';
            ctx.lineWidth = 2.5 / zoom;
            ctx.shadowColor = '#00d4ff';
            ctx.shadowBlur = 8 / zoom;
        } else {
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
            ctx.lineWidth = 1 / zoom;
            ctx.shadowColor = 'transparent';
            ctx.shadowBlur = 0;
        }
        roundRect(x + gap, y + gap, w - gap * 2, h - gap * 2, radius);
        ctx.stroke();
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;

        // Label text — fixed font size relative to tile, no auto-scaling
        var textColor = getTextColor(fillColor);
        ctx.fillStyle = textColor;
        var fontSize = tileSize / 3.5;
        ctx.font = '600 ' + fontSize + 'px -apple-system, "Segoe UI", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        var label = tile.label || '';
        var centerX = x + w / 2;
        var centerY = y + h / 2;

        if (label.length > 0) {
            // Clip text to tile bounds so it never bleeds outside
            ctx.save();
            ctx.beginPath();
            ctx.rect(x + gap, y + gap, w - gap * 2, h - gap * 2);
            ctx.clip();

            if (tile.type === 'rack' && tile.utilization !== null && tile.utilization !== undefined && h > tileSize * 0.8) {
                ctx.fillText(label, centerX, centerY - fontSize * 0.5);
            } else {
                ctx.fillText(label, centerX, centerY);
            }
            ctx.restore();
        }

        if (tile.type === 'rack' && tile.utilization !== null && tile.utilization !== undefined && h > tileSize * 0.8) {
            var smallFont = tileSize / 4.5;
            ctx.font = smallFont + 'px -apple-system, "Segoe UI", sans-serif';
            ctx.globalAlpha = 0.7;
            ctx.save();
            ctx.beginPath();
            ctx.rect(x + gap, y + gap, w - gap * 2, h - gap * 2);
            ctx.clip();
            ctx.fillText(Math.round(tile.utilization) + '%', centerX, centerY + fontSize * 0.6);
            ctx.restore();
            ctx.globalAlpha = 1.0;
        }

        // Draw direction arrow on camera tiles
        if (tile.type === 'camera') {
            var arrowLen = Math.min(w, h) * 0.2;
            var dirRad = ((tile.fov_direction || 0) - 90) * Math.PI / 180;
            var arrowX = centerX + Math.cos(dirRad) * arrowLen;
            var arrowY = centerY + Math.sin(dirRad) * arrowLen;
            ctx.save();
            ctx.strokeStyle = textColor;
            ctx.lineWidth = 2 / zoom;
            ctx.globalAlpha = 0.7;
            ctx.beginPath();
            ctx.moveTo(centerX, centerY);
            ctx.lineTo(arrowX, arrowY);
            ctx.stroke();
            // Arrow head
            var headLen = arrowLen * 0.4;
            var headAngle = 0.5;
            ctx.beginPath();
            ctx.moveTo(arrowX, arrowY);
            ctx.lineTo(arrowX - Math.cos(dirRad - headAngle) * headLen, arrowY - Math.sin(dirRad - headAngle) * headLen);
            ctx.moveTo(arrowX, arrowY);
            ctx.lineTo(arrowX - Math.cos(dirRad + headAngle) * headLen, arrowY - Math.sin(dirRad + headAngle) * headLen);
            ctx.stroke();
            ctx.restore();
        }

    }

    /**
     * Draw camera FOV cone (semi-transparent wedge from tile center).
     */
    function drawCameraFOV(tile) {
        if (tile.type !== 'camera') return;

        var direction = (tile.fov_direction || 0);
        var angle = (tile.fov_angle || 90);
        var distance = (tile.fov_distance || 5);

        var cx = (tile.x + tile.w / 2) * tileSize;
        var cy = (tile.y + tile.h / 2) * tileSize;
        var radius = distance * tileSize;

        // Convert: 0=north/up → canvas 0=east/right
        var dirRad = (direction - 90) * Math.PI / 180;
        var halfAngleRad = (angle / 2) * Math.PI / 180;
        var startAngle = dirRad - halfAngleRad;
        var endAngle = dirRad + halfAngleRad;

        ctx.save();
        // Fill
        ctx.globalAlpha = 0.15;
        ctx.fillStyle = '#ff4444';
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, radius, startAngle, endAngle, false);
        ctx.closePath();
        ctx.fill();
        // Border
        ctx.globalAlpha = 0.4;
        ctx.strokeStyle = '#ff4444';
        ctx.lineWidth = 1.5 / zoom;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, radius, startAngle, endAngle, false);
        ctx.closePath();
        ctx.stroke();
        ctx.restore();
    }

    /**
     * Full render of the canvas.
     */
    function render() {
        var dpr = window.devicePixelRatio || 1;
        var cw = parseFloat(canvas.style.width);
        var ch = parseFloat(canvas.style.height);

        // Reset transform and clear
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        // Clear entire canvas with dark background
        ctx.fillStyle = '#0d0f1a';
        ctx.fillRect(0, 0, cw, ch);

        // Apply pan/zoom transform
        ctx.translate(panX, panY);
        ctx.scale(zoom, zoom);

        // Draw background image if present
        if (bgImg) {
            ctx.drawImage(bgImg, 0, 0, worldWidth, worldHeight);
        }

        drawGrid();

        // Draw FOV cones for camera tiles (underneath tiles)
        if (showFOV) {
            for (var fi = 0; fi < tiles.length; fi++) {
                if (tiles[fi].type === 'camera' && visibleTypes.has('camera')) {
                    drawCameraFOV(tiles[fi]);
                }
            }
        }

        // Draw visible tiles only
        for (var i = 0; i < tiles.length; i++) {
            if (visibleTypes.has(tiles[i].type)) {
                drawTile(tiles[i]);
            }
        }

        // Reset transform
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        // Draw zoom indicator
        ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.font = '11px -apple-system, "Segoe UI", sans-serif';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'bottom';
        ctx.fillText(Math.round(zoom * 100) + '%', cw - 8, ch - 6);
    }

    /**
     * Find tile at world coordinates.
     */
    function findTileAt(wx, wy) {
        var gridX = Math.floor(wx / tileSize);
        var gridY = Math.floor(wy / tileSize);

        for (var i = 0; i < tiles.length; i++) {
            var t = tiles[i];
            if (!visibleTypes.has(t.type)) continue;  // skip hidden types
            if (gridX >= t.x && gridX < t.x + t.w &&
                gridY >= t.y && gridY < t.y + t.h) {
                return t;
            }
        }
        return null;
    }

    /**
     * Update the selection status bar and detail panel.
     */
    function updateDetailPanel(tile) {
        var panel = document.getElementById('tile-detail-panel');
        var statusBar = document.getElementById('selection-status');

        if (!tile) {
            if (panel) {
                panel.classList.add('d-none');
                panel.dataset.selectedTileId = '';
            }
            if (statusBar) {
                statusBar.innerHTML = '<span class="text-muted">Click a tile to select</span>';
            }
            var deleteBtn = document.getElementById('delete-tile-btn');
            if (deleteBtn) deleteBtn.disabled = true;
            var enrichedEl = document.getElementById('fp-enriched-detail');
            if (enrichedEl) enrichedEl.innerHTML = '';
            return;
        }

        if (statusBar) {
            var html = '<span class="text-muted">Selected</span> &nbsp;&triangleright;&nbsp; ';
            html += '<strong>' + (tile.label || tile.type) + '</strong>';
            html += ' &nbsp; <span class="text-muted">X,Y:</span> ' + tile.x + ', ' + tile.y;
            if (tile.w > 1 || tile.h > 1) {
                html += ' &nbsp; <span class="text-muted">Size:</span> ' + tile.w + '&times;' + tile.h;
            }
            if (tile.utilization !== null && tile.utilization !== undefined) {
                html += ' &nbsp; <span class="text-muted">Util:</span> ' + Math.round(tile.utilization) + '%';
            }
            if (tile.object_type) {
                html += ' &nbsp; <span class="text-muted">' + tile.object_type + ':</span> ';
                html += '<strong>' + (tile.object_name || '') + '</strong>';
            }
            if (tile.primary_ip) {
                html += ' &nbsp; <span class="text-muted">IP:</span> ' + tile.primary_ip;
            }
            if (tile.object_url) {
                html += ' &nbsp; <a href="' + tile.object_url + '" class="text-info">View &rarr;</a>';
            }
            statusBar.innerHTML = html;
        }

        // Hide label editor when switching tiles
        var labelForm = document.getElementById('edit-label-form');
        if (labelForm) labelForm.classList.add('d-none');

        if (panel) {
            panel.classList.remove('d-none');
            panel.dataset.selectedTileId = tile.id;

            document.getElementById('tile-detail-name').textContent = tile.label || '-';
            document.getElementById('tile-detail-position').textContent = 'X: ' + tile.x + ', Y: ' + tile.y;
            document.getElementById('tile-detail-size').textContent = tile.w + ' x ' + tile.h;
            document.getElementById('tile-detail-type').textContent = tile.type;

            var utilEl = document.getElementById('tile-detail-utilization');
            if (utilEl) {
                utilEl.textContent = (tile.utilization !== null && tile.utilization !== undefined)
                    ? Math.round(tile.utilization) + '%' : '-';
            }

            var objectTypeEl = document.getElementById('tile-detail-object-type');
            if (objectTypeEl) objectTypeEl.textContent = tile.object_type || '-';

            var ipEl = document.getElementById('tile-detail-ip');
            var ipRow = document.getElementById('tile-detail-ip-row');
            if (ipEl) ipEl.textContent = tile.primary_ip || '-';
            if (ipRow) ipRow.style.display = tile.primary_ip ? '' : 'none';

            var objectLinkEl = document.getElementById('tile-detail-object-link');
            if (objectLinkEl) {
                if (tile.object_url) {
                    objectLinkEl.innerHTML = '<a href="' + tile.object_url + '">' +
                        (tile.object_name || tile.object_type || 'Object') + '</a>';
                } else {
                    objectLinkEl.textContent = '-';
                }
            }

            // Show linked floor plan info
            var fpLinkRow = document.getElementById('tile-detail-fplink-row');
            var fpLinkEl = document.getElementById('tile-detail-fplink');
            if (fpLinkRow && fpLinkEl) {
                if (tile.linked_floorplan_url && tile.linked_floorplan_name) {
                    fpLinkRow.style.display = '';
                    fpLinkEl.innerHTML = '<a href="' + tile.linked_floorplan_url + '">' +
                        tile.linked_floorplan_name + '</a>';
                } else {
                    fpLinkRow.style.display = 'none';
                    fpLinkEl.textContent = '-';
                }
            }
        }

        // Fetch enriched detail via AJAX
        var enrichedEl = document.getElementById('fp-enriched-detail');
        if (enrichedEl) {
            if (tile.object_type_model && tile.object_id) {
                enrichedEl.innerHTML = '<div class="sidebar-detail-loading">Loading details\u2026</div>';
                fetch(detailBaseUrl + tile.object_type_model + '/' + tile.object_id + '/')
                    .then(function(r) {
                        if (!r.ok) throw new Error('HTTP ' + r.status);
                        return r.json();
                    })
                    .then(function(detail) {
                        if (selectedTile !== tile) return;
                        var html = '';
                        if (detail.mac_address) {
                            html += '<div class="sidebar-detail-list">';
                            html += '<div class="detail-row"><span class="detail-label">MAC</span>';
                            html += '<span class="detail-value"><code>' + detail.mac_address + '</code></span></div></div>';
                        }
                        if (detail.standard_fields && detail.standard_fields.length) {
                            html += '<div class="sidebar-section-title">Details</div>';
                            html += '<div class="sidebar-detail-list">';
                            for (var i = 0; i < detail.standard_fields.length; i++) {
                                var f = detail.standard_fields[i];
                                html += '<div class="detail-row"><span class="detail-label">' + f.label + '</span>';
                                html += '<span class="detail-value">' + f.value + '</span></div>';
                            }
                            html += '</div>';
                        }
                        if (detail.custom_fields && detail.custom_fields.length) {
                            html += '<div class="sidebar-section-title">Custom Fields</div>';
                            html += '<div class="sidebar-detail-list">';
                            for (var j = 0; j < detail.custom_fields.length; j++) {
                                var cf = detail.custom_fields[j];
                                html += '<div class="detail-row"><span class="detail-label">' + cf.label + '</span>';
                                html += '<span class="detail-value">' + cf.value + '</span></div>';
                            }
                            html += '</div>';
                        }
                        enrichedEl.innerHTML = html;
                    })
                    .catch(function() {
                        if (selectedTile === tile) enrichedEl.innerHTML = '';
                    });
            } else {
                enrichedEl.innerHTML = '';
            }
        }

        // Show/hide camera FOV edit panel
        var fovPanel = document.getElementById('camera-fov-edit-panel');
        if (fovPanel) {
            if (tile.type === 'camera') {
                fovPanel.classList.remove('d-none');
                var dirInput = document.getElementById('edit-fov-direction');
                var angleInput = document.getElementById('edit-fov-angle');
                var distInput = document.getElementById('edit-fov-distance');
                if (dirInput) dirInput.value = tile.fov_direction || 0;
                if (angleInput) angleInput.value = tile.fov_angle || 90;
                if (distInput) distInput.value = tile.fov_distance || 5;
            } else {
                fovPanel.classList.add('d-none');
            }
        }

        // Show resize panel in edit mode
        var resizePanel = document.getElementById('resize-tile-panel');
        if (resizePanel) {
            resizePanel.classList.remove('d-none');
            var resizeW = document.getElementById('resize-width-input');
            var resizeH = document.getElementById('resize-height-input');
            if (resizeW) resizeW.value = tile.w;
            if (resizeH) resizeH.value = tile.h;
        }

        var deleteBtn = document.getElementById('delete-tile-btn');
        if (deleteBtn) deleteBtn.disabled = false;
    }

    // ===== Camera FOV Live Preview + Save =====

    var fovDirInput = document.getElementById('edit-fov-direction');
    var fovAngleInput = document.getElementById('edit-fov-angle');
    var fovDistInput = document.getElementById('edit-fov-distance');
    var saveFovBtn = document.getElementById('save-fov-btn');

    // Live preview: update the FOV cone in real time as inputs change
    function onFovInputChange() {
        if (!selectedTile || selectedTile.type !== 'camera') return;
        selectedTile.fov_direction = parseInt(fovDirInput.value, 10) || 0;
        selectedTile.fov_angle = parseInt(fovAngleInput.value, 10) || 90;
        selectedTile.fov_distance = parseInt(fovDistInput.value, 10) || 5;
        render();
    }

    if (fovDirInput) fovDirInput.addEventListener('input', onFovInputChange);
    if (fovAngleInput) fovAngleInput.addEventListener('input', onFovInputChange);
    if (fovDistInput) fovDistInput.addEventListener('input', onFovInputChange);

    // Save: persist the current FOV values to the server
    if (saveFovBtn) {
        saveFovBtn.addEventListener('click', function() {
            if (!selectedTile || selectedTile.type !== 'camera') return;

            var tileApiUrl = container.dataset.apiUrl;
            var csrf = container.dataset.csrfToken;

            var payload = {
                fov_direction: selectedTile.fov_direction,
                fov_angle: selectedTile.fov_angle,
                fov_distance: selectedTile.fov_distance
            };

            saveFovBtn.disabled = true;
            saveFovBtn.textContent = 'Saving...';

            fetch(tileApiUrl + selectedTile.id + '/', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf },
                body: JSON.stringify(payload)
            })
            .then(function(r) {
                if (r.ok) {
                    saveFovBtn.innerHTML = '<i class="mdi mdi-check"></i> Saved!';
                    saveFovBtn.classList.remove('btn-primary');
                    saveFovBtn.classList.add('btn-success');
                    setTimeout(function() {
                        saveFovBtn.innerHTML = '<i class="mdi mdi-check"></i> Save';
                        saveFovBtn.classList.remove('btn-success');
                        saveFovBtn.classList.add('btn-primary');
                        saveFovBtn.disabled = false;
                    }, 1500);
                } else {
                    r.text().then(function(text) {
                        console.error('FOV save error:', text);
                        alert('Error saving FOV: ' + text);
                    });
                    saveFovBtn.innerHTML = '<i class="mdi mdi-check"></i> Save';
                    saveFovBtn.disabled = false;
                }
            })
            .catch(function(err) {
                console.error('FOV save network error:', err);
                alert('Network error: ' + err.message);
                saveFovBtn.innerHTML = '<i class="mdi mdi-check"></i> Save';
                saveFovBtn.disabled = false;
            });
        });
    }

    // ===== Rack Elevation SVG Display =====

    var rackElevationPanel = document.getElementById('rack-elevation-panel');
    var rackElevationSvgContainer = document.getElementById('rack-elevation-svg');
    var rackElevationLoading = document.getElementById('rack-elevation-loading');
    var rackElevationTitle = document.getElementById('rack-elevation-title');
    var rackFaceFrontBtn = document.getElementById('rack-face-front');
    var rackFaceRearBtn = document.getElementById('rack-face-rear');
    var currentRackId = null;
    var currentRackFace = 'front';

    function loadRackElevation(rackId, face) {
        if (!rackElevationPanel || !rackElevationSvgContainer) return;

        rackElevationLoading.classList.remove('d-none');
        rackElevationSvgContainer.innerHTML = '';

        var url = '/api/dcim/racks/' + rackId + '/elevation/?render=svg&face=' + face +
                  '&include_images=true&expand_devices=true';

        fetch(url, { credentials: 'same-origin' })
        .then(function(response) {
            if (!response.ok) throw new Error('Failed to load rack elevation');
            return response.text();
        })
        .then(function(svgText) {
            rackElevationLoading.classList.add('d-none');
            rackElevationSvgContainer.innerHTML = svgText;

            var svg = rackElevationSvgContainer.querySelector('svg');
            if (svg) {
                var origW = svg.getAttribute('width');
                var origH = svg.getAttribute('height');
                if (origW && origH) {
                    svg.setAttribute('viewBox', '0 0 ' + origW + ' ' + origH);
                }
                svg.removeAttribute('width');
                svg.removeAttribute('height');
                svg.style.maxHeight = '75vh';
                svg.style.width = 'auto';
                svg.style.height = 'auto';
                svg.style.display = 'block';
                svg.style.margin = '0 auto';
            }
        })
        .catch(function(err) {
            rackElevationLoading.classList.add('d-none');
            rackElevationSvgContainer.innerHTML =
                '<div class="text-danger text-center py-3">Error loading rack elevation: ' +
                err.message + '</div>';
        });
    }

    function updateRackElevation(tile) {
        if (!rackElevationPanel) return;

        if (!tile || tile.object_type_model !== 'rack' || !tile.object_id) {
            rackElevationPanel.classList.add('d-none');
            currentRackId = null;
            return;
        }

        rackElevationPanel.classList.remove('d-none');

        if (rackElevationTitle) {
            rackElevationTitle.textContent = (tile.label || 'Rack') + ' — Elevation';
        }

        if (currentRackId !== tile.object_id) {
            currentRackId = tile.object_id;
            currentRackFace = 'front';
            if (rackFaceFrontBtn) rackFaceFrontBtn.classList.add('active');
            if (rackFaceRearBtn) rackFaceRearBtn.classList.remove('active');
            loadRackElevation(currentRackId, currentRackFace);
        }
    }

    if (rackFaceFrontBtn) {
        rackFaceFrontBtn.addEventListener('click', function() {
            if (currentRackFace === 'front' || !currentRackId) return;
            currentRackFace = 'front';
            rackFaceFrontBtn.classList.add('active');
            rackFaceRearBtn.classList.remove('active');
            loadRackElevation(currentRackId, 'front');
        });
    }
    if (rackFaceRearBtn) {
        rackFaceRearBtn.addEventListener('click', function() {
            if (currentRackFace === 'rear' || !currentRackId) return;
            currentRackFace = 'rear';
            rackFaceRearBtn.classList.add('active');
            rackFaceFrontBtn.classList.remove('active');
            loadRackElevation(currentRackId, 'rear');
        });
    }

    // ===== Pan / Zoom Event Handlers =====

    /**
     * Get mouse position relative to the canvas element (screen coords).
     */
    function getMousePos(e) {
        var rect = canvas.getBoundingClientRect();
        return {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top
        };
    }

    /**
     * Mouse wheel zoom — zoom towards cursor position.
     */
    canvas.addEventListener('wheel', function(e) {
        e.preventDefault();
        var pos = getMousePos(e);

        // World point under cursor before zoom
        var wx = (pos.x - panX) / zoom;
        var wy = (pos.y - panY) / zoom;

        // Adjust zoom (gentle step per scroll tick)
        var delta = e.deltaY < 0 ? 1.05 : 1 / 1.05;
        var newZoom = zoom * delta;
        newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, newZoom));

        // Adjust pan so the world point stays under the cursor
        panX = pos.x - wx * newZoom;
        panY = pos.y - wy * newZoom;
        zoom = newZoom;

        render();
    }, { passive: false });

    /**
     * Middle-click or left-click drag to pan. In edit mode, dragging on a tile moves it.
     */
    canvas.addEventListener('mousedown', function(e) {
        if (e.button === 1) {
            // Middle button always pans
            isPanning = true;
            didPan = false;
            panStartX = e.clientX;
            panStartY = e.clientY;
            panStartOffsetX = panX;
            panStartOffsetY = panY;
            e.preventDefault();
            canvas.style.cursor = 'grabbing';
            return;
        }

        if (e.button === 0) {
            var pos = getMousePos(e);
            var world = screenToWorld(pos.x, pos.y);
            var tileUnder = findTileAt(world.x, world.y);

            if (editMode && tileUnder) {
                // Start tile drag (edit mode only)
                isDraggingTile = true;
                dragTile = tileUnder;
                dragOrigX = tileUnder.x;
                dragOrigY = tileUnder.y;
                didPan = false;
                panStartX = e.clientX;
                panStartY = e.clientY;
            } else {
                // Pan on empty space
                isPanning = true;
                didPan = false;
                panStartX = e.clientX;
                panStartY = e.clientY;
                panStartOffsetX = panX;
                panStartOffsetY = panY;
            }
        }
    });

    window.addEventListener('mousemove', function(e) {
        // Tile drag
        if (isDraggingTile && dragTile) {
            var dx = e.clientX - panStartX;
            var dy = e.clientY - panStartY;
            if (!didPan && Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
            didPan = true;
            canvas.style.cursor = 'move';

            // Calculate new grid position
            var cellDx = Math.round(dx / (tileSize * zoom));
            var cellDy = Math.round(dy / (tileSize * zoom));
            var newX = Math.max(0, Math.min(gridWidth - dragTile.w, dragOrigX + cellDx));
            var newY = Math.max(0, Math.min(gridHeight - dragTile.h, dragOrigY + cellDy));

            if (dragTile.x !== newX || dragTile.y !== newY) {
                dragTile.x = newX;
                dragTile.y = newY;
                render();
            }
            return;
        }

        // Pan
        if (!isPanning) return;
        var dx = e.clientX - panStartX;
        var dy = e.clientY - panStartY;

        if (!didPan && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
        didPan = true;
        canvas.style.cursor = 'grabbing';

        panX = panStartOffsetX + dx;
        panY = panStartOffsetY + dy;
        render();
    });

    window.addEventListener('mouseup', function(e) {
        // Finish tile drag — PATCH the new position
        if (isDraggingTile && dragTile && didPan) {
            var tileId = dragTile.id;
            var newX = dragTile.x;
            var newY = dragTile.y;
            isDraggingTile = false;
            canvas.style.cursor = '';

            // Only PATCH if position actually changed
            if (newX !== dragOrigX || newY !== dragOrigY) {
                fetch(apiUrl + tileId + '/', {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrfToken },
                    body: JSON.stringify({ x_position: newX, y_position: newY })
                })
                .then(function(r) {
                    if (!r.ok) {
                        // Revert on failure
                        dragTile.x = dragOrigX;
                        dragTile.y = dragOrigY;
                        render();
                        return r.json().then(function(err) { alert('Move failed: ' + JSON.stringify(err)); });
                    }
                })
                .catch(function(err) {
                    dragTile.x = dragOrigX;
                    dragTile.y = dragOrigY;
                    render();
                    alert('Network error: ' + err.message);
                });
            }
            dragTile = null;
            return;
        }

        if (isDraggingTile) {
            isDraggingTile = false;
            dragTile = null;
        }

        if (isPanning) {
            isPanning = false;
            canvas.style.cursor = '';
        }
    });

    /**
     * Click to select tile (only if we didn't pan or drag).
     */
    canvas.addEventListener('click', function(e) {
        if (didPan) return;  // was a drag/pan, not a click

        var pos = getMousePos(e);
        var world = screenToWorld(pos.x, pos.y);

        selectedTile = findTileAt(world.x, world.y);

        // Navigate to linked floor plan when clicking a floorplan_link tile (view mode only)
        if (selectedTile && selectedTile.type === 'floorplan_link' && selectedTile.linked_floorplan_url && !editMode) {
            window.location.href = selectedTile.linked_floorplan_url;
            return;
        }

        render();
        updateDetailPanel(selectedTile);
        updateRackElevation(selectedTile);
        highlightSidebarItem(selectedTile ? selectedTile.id : -1);
    });

    /**
     * Hover popover — styled HTML overlay positioned near cursor.
     */
    var popoverEl = document.getElementById('tile-popover');
    var popoverVisible = false;

    function showPopover(tile, mouseX, mouseY) {
        if (!popoverEl) return;

        // Resolve the field list for this tile type
        var typeKey = tile.type || 'default';
        var activeFields = popoverConfig[typeKey] || popoverConfig['default'];

        var lines = [];
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
            }
        }

        // Fallback: always show at least the label
        if (lines.length === 0) {
            lines.push('<strong>' + (tile.label || tile.type) + '</strong>');
        }

        popoverEl.innerHTML = lines.join('<br>');
        popoverEl.style.display = 'block';

        // Position with edge-flip to stay within container
        var cRect = container.getBoundingClientRect();
        var offsetX = 14;
        var offsetY = 14;
        var left = mouseX + offsetX;
        var top = mouseY + offsetY;

        // Measure after making visible
        var pw = popoverEl.offsetWidth;
        var ph = popoverEl.offsetHeight;

        if (left + pw > cRect.width) {
            left = mouseX - pw - 6;
        }
        if (top + ph > cRect.height) {
            top = mouseY - ph - 6;
        }
        if (left < 0) left = 4;
        if (top < 0) top = 4;

        popoverEl.style.left = left + 'px';
        popoverEl.style.top = top + 'px';
        popoverVisible = true;
    }

    function hidePopover() {
        if (popoverEl) {
            popoverEl.style.display = 'none';
        }
        popoverVisible = false;
    }

    canvas.addEventListener('mousemove', function(e) {
        if (isPanning || isDraggingTile) {
            hidePopover();
            return;
        }

        var pos = getMousePos(e);
        var world = screenToWorld(pos.x, pos.y);

        var tile = findTileAt(world.x, world.y);
        canvas.style.cursor = tile ? 'pointer' : 'default';
        canvas.title = '';

        if (tile) {
            showPopover(tile, pos.x, pos.y);
        } else {
            hidePopover();
        }
    });

    canvas.addEventListener('mouseleave', function() {
        hidePopover();
    });

    // ===== Zoom Controls =====

    var zoomInBtn = document.getElementById('zoom-in-btn');
    var zoomOutBtn = document.getElementById('zoom-out-btn');
    var zoomResetBtn = document.getElementById('zoom-reset-btn');

    if (zoomInBtn) {
        zoomInBtn.addEventListener('click', function() {
            var cw = parseFloat(canvas.style.width);
            var ch = parseFloat(canvas.style.height);
            var cx = cw / 2;
            var cy = ch / 2;
            var wx = (cx - panX) / zoom;
            var wy = (cy - panY) / zoom;
            zoom = Math.min(MAX_ZOOM, zoom * 1.3);
            panX = cx - wx * zoom;
            panY = cy - wy * zoom;
            render();
        });
    }
    if (zoomOutBtn) {
        zoomOutBtn.addEventListener('click', function() {
            var cw = parseFloat(canvas.style.width);
            var ch = parseFloat(canvas.style.height);
            var cx = cw / 2;
            var cy = ch / 2;
            var wx = (cx - panX) / zoom;
            var wy = (cy - panY) / zoom;
            zoom = Math.max(MIN_ZOOM, zoom / 1.3);
            panX = cx - wx * zoom;
            panY = cy - wy * zoom;
            render();
        });
    }
    if (zoomResetBtn) {
        zoomResetBtn.addEventListener('click', function() {
            fitToView();
            render();
        });
    }

    // ===== PDF Export =====

    var exportPdfBtn = document.getElementById('export-pdf-btn');
    if (exportPdfBtn) {
        exportPdfBtn.addEventListener('click', function() {
            exportPdfBtn.disabled = true;
            exportPdfBtn.innerHTML = '<i class="mdi mdi-loading mdi-spin"></i>';

            setTimeout(function() {
                try {
                    exportPDF();
                } catch (err) {
                    alert('PDF export failed: ' + err.message);
                } finally {
                    exportPdfBtn.disabled = false;
                    exportPdfBtn.innerHTML = '<i class="mdi mdi-file-pdf-box"></i>';
                }
            }, 50);
        });
    }

    function exportPDF() {
        var jsPDF = window.jspdf && window.jspdf.jsPDF;
        if (!jsPDF) {
            alert('PDF library not loaded.');
            return;
        }

        // PDF page: each grid cell = 10mm, plus margin for title/legend
        var MM_PER_CELL = 10;
        var margin = 10;
        var headerH = 12;  // space for title
        var footerH = 8;   // space for legend

        var contentW = gridWidth * MM_PER_CELL;
        var contentH = gridHeight * MM_PER_CELL;
        var pageW = contentW + margin * 2;
        var pageH = contentH + margin * 2 + headerH + footerH;

        // Offscreen canvas: target ~150 DPI relative to PDF
        // 150 DPI = 150/25.4 px per mm ≈ 5.9 px/mm
        // So canvas px = contentMM * 5.9
        var PX_PER_MM = 5.9;
        var targetCanvasW = Math.round(contentW * PX_PER_MM);
        var targetCanvasH = Math.round(contentH * PX_PER_MM);

        // Clamp to browser max (16384) to avoid crash
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

        // Scale: canvas pixels per world pixel
        var scaleX = targetCanvasW / worldWidth;
        var scaleY = targetCanvasH / worldHeight;
        var renderScale = Math.min(scaleX, scaleY);
        offCtx.scale(renderScale, renderScale);

        // Draw background
        if (bgImg) {
            offCtx.drawImage(bgImg, 0, 0, worldWidth, worldHeight);
        } else {
            offCtx.fillStyle = '#16192b';
            offCtx.fillRect(0, 0, worldWidth, worldHeight);
        }

        // Draw grid lines
        offCtx.strokeStyle = bgImg ? 'rgba(255, 255, 255, 0.12)' : 'rgba(255, 255, 255, 0.06)';
        offCtx.lineWidth = 1 / renderScale;
        for (var gx = 0; gx <= gridWidth; gx++) {
            offCtx.beginPath();
            offCtx.moveTo(gx * tileSize, 0);
            offCtx.lineTo(gx * tileSize, worldHeight);
            offCtx.stroke();
        }
        for (var gy = 0; gy <= gridHeight; gy++) {
            offCtx.beginPath();
            offCtx.moveTo(0, gy * tileSize);
            offCtx.lineTo(worldWidth, gy * tileSize);
            offCtx.stroke();
        }

        // Draw FOV cones for camera tiles in PDF
        if (showFOV) {
            for (var ci = 0; ci < tiles.length; ci++) {
                var camTile = tiles[ci];
                if (camTile.type !== 'camera' || !visibleTypes.has('camera')) continue;

                var camDir = (camTile.fov_direction || 0);
                var camAngle = (camTile.fov_angle || 90);
                var camDist = (camTile.fov_distance || 5);
                var camCx = (camTile.x + camTile.w / 2) * tileSize;
                var camCy = (camTile.y + camTile.h / 2) * tileSize;
                var camRadius = camDist * tileSize;
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

        // Draw tiles (only visible types)
        for (var i = 0; i < tiles.length; i++) {
            var tile = tiles[i];
            if (!visibleTypes.has(tile.type)) continue;

            var tx = tile.x * tileSize;
            var ty = tile.y * tileSize;
            var tw = tile.w * tileSize;
            var th = tile.h * tileSize;
            var gap = 2;
            var radius = 4;

            var fillColor;
            if (tile.type === 'rack') {
                fillColor = getUtilizationColor(tile.utilization);
            } else {
                fillColor = getTileTypeColor(tile.type);
            }

            // Rounded rect fill
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

            offCtx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
            offCtx.lineWidth = 1 / renderScale;
            offCtx.stroke();

            // Label text
            var textColor = getTextColor(fillColor);
            offCtx.fillStyle = textColor;
            var fontSize = tileSize / 3.5;
            offCtx.font = '600 ' + fontSize + 'px -apple-system, "Segoe UI", sans-serif';
            offCtx.textAlign = 'center';
            offCtx.textBaseline = 'middle';

            var label = tile.label || '';
            var centerX = tx + tw / 2;
            var centerY = ty + th / 2;

            if (label.length > 0) {
                var maxChars = Math.floor((tw - gap * 4) / (fontSize * 0.55));
                var displayLabel = label.length > maxChars ? label.substring(0, maxChars - 1) + '..' : label;

                if (tile.type === 'rack' && tile.utilization !== null && tile.utilization !== undefined && th > tileSize * 0.8) {
                    offCtx.fillText(displayLabel, centerX, centerY - fontSize * 0.5);
                } else {
                    offCtx.fillText(displayLabel, centerX, centerY);
                }
            }

            if (tile.type === 'rack' && tile.utilization !== null && tile.utilization !== undefined && th > tileSize * 0.8) {
                var smallFont = tileSize / 4.5;
                offCtx.font = smallFont + 'px -apple-system, "Segoe UI", sans-serif';
                offCtx.globalAlpha = 0.7;
                offCtx.fillText(Math.round(tile.utilization) + '%', centerX, centerY + fontSize * 0.6);
                offCtx.globalAlpha = 1.0;
            }
        }

        // Convert to JPEG
        var imgData = offCanvas.toDataURL('image/jpeg', 0.95);

        // Create PDF with custom page size matching the grid
        var landscape = pageW > pageH;
        var pdf = new jsPDF({
            orientation: landscape ? 'landscape' : 'portrait',
            unit: 'mm',
            format: landscape ? [pageH, pageW] : [pageW, pageH]
        });

        // Title
        var fpName = document.title || 'Floor Plan';
        pdf.setFontSize(10);
        pdf.setTextColor(60, 60, 60);
        pdf.text(fpName, margin, margin + 5);

        // Date
        pdf.setFontSize(7);
        pdf.setTextColor(140, 140, 140);
        pdf.text('Exported: ' + new Date().toLocaleString(), pageW - margin, margin + 5, { align: 'right' });

        // Place image filling the content area
        pdf.addImage(imgData, 'JPEG', margin, margin + headerH, contentW, contentH);

        // Legend at bottom
        var legendY = margin + headerH + contentH + 2;
        pdf.setFontSize(6);
        pdf.setTextColor(120, 120, 120);
        var legendItems = [];
        for (var ti = 0; ti < ALL_TYPES.length; ti++) {
            if (visibleTypes.has(ALL_TYPES[ti])) {
                legendItems.push(TYPE_NAME_MAP[ALL_TYPES[ti]] || ALL_TYPES[ti]);
            }
        }
        pdf.text('Visible: ' + legendItems.join(', '), margin, legendY + 3);
        pdf.text('Tiles: ' + tiles.filter(function(t) { return visibleTypes.has(t.type); }).length + ' / ' + tiles.length +
                 '  |  Grid: ' + gridWidth + ' x ' + gridHeight, pageW - margin, legendY + 3, { align: 'right' });

        // Download
        var safeName = (fpName || 'floorplan').replace(/[^a-zA-Z0-9_\- ]/g, '').trim() || 'floorplan';
        pdf.save(safeName + '.pdf');
    }

    // ===== Label Editing =====

    var editLabelBtn = document.getElementById('edit-label-btn');
    var editLabelForm = document.getElementById('edit-label-form');
    var editLabelInput = document.getElementById('edit-label-input');
    var saveLabelBtn = document.getElementById('save-label-btn');
    var cancelLabelBtn = document.getElementById('cancel-label-btn');
    var apiUrl = container.dataset.apiUrl;
    var csrfToken = container.dataset.csrfToken;

    function showLabelEditor() {
        if (!selectedTile || !editLabelForm) return;
        editLabelInput.value = selectedTile.label || '';
        editLabelForm.classList.remove('d-none');
        editLabelInput.focus();
    }

    function hideLabelEditor() {
        if (editLabelForm) editLabelForm.classList.add('d-none');
    }

    function saveLabel() {
        if (!selectedTile) return;
        var newLabel = editLabelInput.value.trim();

        fetch(apiUrl + selectedTile.id + '/', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrfToken },
            body: JSON.stringify({ label: newLabel })
        })
        .then(function(r) {
            if (!r.ok) throw new Error('Failed to update label');
            return r.json();
        })
        .then(function() {
            selectedTile.label = newLabel;
            hideLabelEditor();
            document.getElementById('tile-detail-name').textContent = newLabel || '-';
            render();
        })
        .catch(function(err) {
            alert('Error: ' + err.message);
        });
    }

    if (editLabelBtn) {
        editLabelBtn.addEventListener('click', showLabelEditor);
    }
    if (saveLabelBtn) {
        saveLabelBtn.addEventListener('click', saveLabel);
    }
    if (cancelLabelBtn) {
        cancelLabelBtn.addEventListener('click', hideLabelEditor);
    }
    if (editLabelInput) {
        editLabelInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') saveLabel();
            if (e.key === 'Escape') hideLabelEditor();
        });
    }

    /**
     * Handle floor plan selector change.
     */
    var selector = document.getElementById('floorplan-selector');
    if (selector) {
        selector.addEventListener('change', function() {
            var fpId = this.value;
            var editMode = container.dataset.editMode === 'true';
            var currentPath = window.location.pathname;
            var url = currentPath.replace(/\/\d+\/visualization\/?.*$/, '/' + fpId + '/visualization/');
            if (editMode) {
                url += '?edit=true';
            }
            window.location.href = url;
        });
    }

    // ===== Sidebar: Searchable Tile List =====

    var tileListEl = document.getElementById('tile-list');
    var tileSearchInput = document.getElementById('tile-search-input');
    var tileCountEl = document.getElementById('tile-count');

    // Reuse the dynamic TYPE_COLOR_MAP built from data-type-configs

    // ===== Rack Device Expansion =====

    var rackDevicesMap = {};     // rackId -> [{id, name, url, ip, position}]
    var rackDevicesLoaded = false;
    var expandedRacks = new Set();

    function loadAllRackDevices(callback) {
        if (rackDevicesLoaded) { callback(); return; }

        var rackIds = [];
        for (var i = 0; i < tiles.length; i++) {
            if (tiles[i].object_type_model === 'rack' && tiles[i].object_id) {
                if (rackIds.indexOf(tiles[i].object_id) === -1) {
                    rackIds.push(tiles[i].object_id);
                }
            }
        }

        if (rackIds.length === 0) { rackDevicesLoaded = true; callback(); return; }

        var params = rackIds.map(function(id) { return 'rack_id=' + id; }).join('&');
        fetch('/api/dcim/devices/?' + params + '&limit=1000', {
            credentials: 'same-origin',
            headers: { 'Accept': 'application/json' }
        })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            var results = data.results || [];
            rackDevicesMap = {};
            for (var i = 0; i < results.length; i++) {
                var d = results[i];
                var rackId = d.rack ? d.rack.id : null;
                if (!rackId) continue;
                if (!rackDevicesMap[rackId]) rackDevicesMap[rackId] = [];

                var ip = null;
                if (d.primary_ip4 && d.primary_ip4.address) ip = d.primary_ip4.address.split('/')[0];
                else if (d.primary_ip6 && d.primary_ip6.address) ip = d.primary_ip6.address.split('/')[0];

                rackDevicesMap[rackId].push({
                    id: d.id,
                    name: d.display || d.name || ('Device #' + d.id),
                    url: d.display_url || ('/dcim/devices/' + d.id + '/'),
                    ip: ip,
                    position: d.position
                });
            }
            // Sort by U position descending within each rack
            for (var rid in rackDevicesMap) {
                rackDevicesMap[rid].sort(function(a, b) {
                    return (b.position || 0) - (a.position || 0);
                });
            }
            rackDevicesLoaded = true;
            callback();
        })
        .catch(function(err) {
            console.error('Failed to load rack devices:', err);
            rackDevicesLoaded = true;
            callback();
        });
    }

    // ===== Type Toggle Buttons =====

    var toggleContainer = document.getElementById('type-toggles');
    if (toggleContainer) {
        var toggleBtns = toggleContainer.querySelectorAll('.type-toggle[data-type]');
        for (var ti = 0; ti < toggleBtns.length; ti++) {
            toggleBtns[ti].addEventListener('click', (function(btn) {
                return function() {
                    var type = btn.dataset.type;
                    if (visibleTypes.has(type)) {
                        visibleTypes.delete(type);
                        btn.classList.remove('active');
                    } else {
                        visibleTypes.add(type);
                        btn.classList.add('active');
                    }
                    // Deselect tile if its type is now hidden
                    if (selectedTile && !visibleTypes.has(selectedTile.type)) {
                        selectedTile = null;
                        updateDetailPanel(null);
                        updateRackElevation(null);
                    }
                    render();
                    buildSidebar();
                };
            })(toggleBtns[ti]));
        }
    }

    // FOV toggle
    var fovToggle = document.getElementById('fov-toggle');
    if (fovToggle) {
        fovToggle.addEventListener('click', function() {
            showFOV = !showFOV;
            if (showFOV) {
                fovToggle.classList.add('active');
            } else {
                fovToggle.classList.remove('active');
            }
            render();
        });
    }

    /**
     * Zoom and pan to center a specific tile in the viewport.
     */
    function zoomToTile(tile) {
        var cw = parseFloat(canvas.style.width);
        var ch = parseFloat(canvas.style.height);
        // Tile center in world coords
        var tileCenterX = (tile.x + tile.w / 2) * tileSize;
        var tileCenterY = (tile.y + tile.h / 2) * tileSize;
        // Zoom level: show roughly 10x10 tiles around the target
        var targetZoom = Math.min(cw, ch) / (tileSize * 10);
        targetZoom = Math.max(0.5, Math.min(MAX_ZOOM, targetZoom));
        zoom = targetZoom;
        panX = cw / 2 - tileCenterX * zoom;
        panY = ch / 2 - tileCenterY * zoom;

        selectedTile = tile;
        render();
        updateDetailPanel(tile);
        updateRackElevation(tile);
        highlightSidebarItem(tile.id);
    }

    /**
     * Highlight the active item in the sidebar.
     */
    function highlightSidebarItem(tileId) {
        if (!tileListEl) return;
        var items = tileListEl.querySelectorAll('.sidebar-tile-item');
        for (var i = 0; i < items.length; i++) {
            if (parseInt(items[i].dataset.tileId) === tileId) {
                items[i].classList.add('active');
                items[i].scrollIntoView({ block: 'nearest' });
            } else {
                items[i].classList.remove('active');
            }
        }
    }

    /**
     * Build/rebuild the sidebar tile list based on search + filter.
     * Rack tiles with linked racks show a collapsible list of devices.
     */
    function buildSidebar() {
        if (!tileListEl) return;

        // Lazy-load rack devices on first call
        if (!rackDevicesLoaded) {
            loadAllRackDevices(function() { buildSidebar(); });
            return;
        }

        var query = tileSearchInput ? tileSearchInput.value.toLowerCase().trim() : '';

        var filtered = tiles.filter(function(t) {
            if (!visibleTypes.has(t.type)) return false;
            if (query) {
                var text = (t.label || '').toLowerCase() + ' ' + (t.type || '').toLowerCase() + ' ' + (t.object_name || '').toLowerCase();
                if (text.indexOf(query) !== -1) return true;
                // Also match devices inside rack
                if (t.object_type_model === 'rack' && t.object_id && rackDevicesMap[t.object_id]) {
                    var devs = rackDevicesMap[t.object_id];
                    for (var d = 0; d < devs.length; d++) {
                        var dText = (devs[d].name || '').toLowerCase() + ' ' + (devs[d].ip || '').toLowerCase();
                        if (dText.indexOf(query) !== -1) return true;
                    }
                }
                return false;
            }
            return true;
        });

        // Sort: by label, then by position
        filtered.sort(function(a, b) {
            var la = (a.label || '').toLowerCase();
            var lb = (b.label || '').toLowerCase();
            if (la < lb) return -1;
            if (la > lb) return 1;
            return (a.y * 10000 + a.x) - (b.y * 10000 + b.x);
        });

        if (tileCountEl) {
            tileCountEl.textContent = filtered.length + ' / ' + tiles.length;
        }

        var html = '';
        for (var i = 0; i < filtered.length; i++) {
            var t = filtered[i];
            var color = t.type === 'rack' ? getUtilizationColor(t.utilization) : (TYPE_COLOR_MAP[t.type] || '#6b6b80');
            var isActive = selectedTile && selectedTile.id === t.id;
            var rackDevices = (t.object_type_model === 'rack' && t.object_id) ? (rackDevicesMap[t.object_id] || []) : [];
            var hasDevices = rackDevices.length > 0;
            var isExpanded = expandedRacks.has(t.id);

            // Auto-expand if search matches a device inside this rack
            if (query && hasDevices) {
                for (var d = 0; d < rackDevices.length; d++) {
                    var dText = (rackDevices[d].name || '').toLowerCase() + ' ' + (rackDevices[d].ip || '').toLowerCase();
                    if (dText.indexOf(query) !== -1) { isExpanded = true; break; }
                }
            }

            html += '<div class="sidebar-tile-item' + (isActive ? ' active' : '') + '" data-tile-id="' + t.id + '">';
            if (hasDevices) {
                html += '<span class="rack-expand-toggle" data-tile-id="' + t.id + '">' +
                    (isExpanded ? '&#9662;' : '&#9656;') + '</span>';
            }
            html += '<div class="sidebar-tile-dot" style="background:' + color + '"></div>';
            html += '<div class="sidebar-tile-names">';
            html += '<span class="sidebar-tile-label" title="' + (t.label || t.type) + '">' + (t.label || '<em>' + t.type + '</em>') + '</span>';
            if (t.object_name && t.object_name !== t.label) {
                html += '<span class="sidebar-tile-object" title="' + t.object_name + '">' + t.object_name + '</span>';
            }
            html += '</div>';
            if (hasDevices) {
                html += '<span class="rack-device-count">' + rackDevices.length + 'd</span>';
            }
            if (t.primary_ip) {
                html += '<span class="sidebar-tile-ip">' + t.primary_ip + '</span>';
            }
            html += '<span class="sidebar-tile-type">' + t.type + '</span>';
            html += '<span class="sidebar-tile-pos">' + t.x + ',' + t.y + '</span>';
            html += '</div>';

            // Expanded device sub-list
            if (hasDevices && isExpanded) {
                html += '<div class="rack-devices-list">';
                for (var di = 0; di < rackDevices.length; di++) {
                    var dev = rackDevices[di];
                    // When searching, only show matching devices
                    if (query) {
                        var devMatch = (dev.name || '').toLowerCase().indexOf(query) !== -1 ||
                                       (dev.ip || '').toLowerCase().indexOf(query) !== -1;
                        if (!devMatch) continue;
                    }
                    html += '<div class="rack-device-item' + (query ? ' search-match' : '') + '">';
                    html += '<i class="mdi mdi-server rack-device-icon"></i>';
                    html += '<span class="rack-device-name">';
                    if (dev.url) {
                        html += '<a href="' + dev.url + '" title="' + dev.name + '">' + dev.name + '</a>';
                    } else {
                        html += dev.name;
                    }
                    html += '</span>';
                    if (dev.ip) html += '<span class="rack-device-ip">' + dev.ip + '</span>';
                    if (dev.position) html += '<span class="rack-device-pos">U' + dev.position + '</span>';
                    html += '</div>';
                }
                html += '</div>';
            }
        }

        tileListEl.innerHTML = html;

        // Click handlers for tile items (zoom to tile)
        var items = tileListEl.querySelectorAll('.sidebar-tile-item');
        for (var j = 0; j < items.length; j++) {
            items[j].addEventListener('click', (function(item) {
                return function(e) {
                    if (e.target.closest('.rack-expand-toggle')) return;
                    var id = parseInt(item.dataset.tileId);
                    for (var k = 0; k < tiles.length; k++) {
                        if (tiles[k].id === id) {
                            zoomToTile(tiles[k]);
                            break;
                        }
                    }
                };
            })(items[j]));
        }

        // Click handlers for expand toggles
        var toggles = tileListEl.querySelectorAll('.rack-expand-toggle');
        for (var ti = 0; ti < toggles.length; ti++) {
            toggles[ti].addEventListener('click', (function(toggle) {
                return function(e) {
                    e.stopPropagation();
                    var tileId = parseInt(toggle.dataset.tileId);
                    if (expandedRacks.has(tileId)) {
                        expandedRacks.delete(tileId);
                    } else {
                        expandedRacks.add(tileId);
                    }
                    buildSidebar();
                };
            })(toggles[ti]));
        }
    }

    if (tileSearchInput) {
        tileSearchInput.addEventListener('input', buildSidebar);
    }

    // ===== Initialization =====

    resizeCanvas();
    fitToView();

    // Re-fit on window resize
    var resizeTimer;
    window.addEventListener('resize', function() {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(function() {
            resizeCanvas();
            fitToView();
            render();
        }, 100);
    });

    // Focus on a specific tile if ?tile=ID is in the URL
    function focusTileFromURL() {
        var params = new URLSearchParams(window.location.search);
        var tileId = parseInt(params.get('tile'));
        if (!isNaN(tileId)) {
            for (var i = 0; i < tiles.length; i++) {
                if (tiles[i].id === tileId) {
                    zoomToTile(tiles[i]);
                    // Hide the "Select a tile" placeholder directly
                    var placeholder = document.getElementById('sidebar-no-selection');
                    if (placeholder) placeholder.style.display = 'none';
                    return;
                }
            }
        }
    }

    // Load background image if specified
    if (backgroundImageUrl) {
        bgImg = new Image();
        bgImg.onload = function() {
            render();
            buildSidebar();
            focusTileFromURL();
        };
        bgImg.src = backgroundImageUrl;
    } else {
        render();
        buildSidebar();
        focusTileFromURL();
    }

    // Export for editor module
    window.floorplanViewer = {
        tiles: tiles,
        render: render,
        findTileAt: findTileAt,
        tileSize: tileSize,
        canvas: canvas,
        screenToWorld: screenToWorld,
        gridWidth: gridWidth,
        gridHeight: gridHeight,
        buildSidebar: buildSidebar,
        updateDetailPanel: updateDetailPanel,
        visibleTypes: visibleTypes,
        getSelectedTile: function() { return selectedTile; }
    };
})();
