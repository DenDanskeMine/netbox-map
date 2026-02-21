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

    // Parse tile data
    let tiles = [];
    try {
        tiles = JSON.parse(container.dataset.tiles || '[]');
    } catch (e) {
        console.error('Failed to parse tile data:', e);
    }

    // World dimensions (the full grid in pixels)
    const worldWidth = gridWidth * tileSize;
    const worldHeight = gridHeight * tileSize;

    let selectedTile = null;
    let bgImg = null;

    // ===== Visible Types (toggle filtering) =====
    var ALL_TYPES = ['rack', 'aisle', 'wall', 'column', 'door', 'cooling', 'power', 'empty', 'reserved', 'ap', 'camera', 'printer'];
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
        var colors = {
            'aisle':    '#3a3a50',
            'wall':     '#5c5c6e',
            'column':   '#6e6e80',
            'door':     '#1a8a7a',
            'cooling':  '#1890b0',
            'power':    '#c89a20',
            'empty':    '#2a2a3e',
            'reserved': '#b06820',
            'ap':       '#7b42c8',
            'camera':   '#c42020',
            'printer':  '#e67e22'
        };
        return colors[tileType] || '#6b6b80';
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

        // Label text — scale with tile size, no hard cap
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
            var maxChars = Math.floor((w - gap * 4) / (fontSize * 0.55));
            var displayLabel = label.length > maxChars ? label.substring(0, maxChars - 1) + '..' : label;

            if (tile.type === 'rack' && tile.utilization !== null && tile.utilization !== undefined && h > tileSize * 0.8) {
                ctx.fillText(displayLabel, centerX, centerY - fontSize * 0.5);
            } else {
                ctx.fillText(displayLabel, centerX, centerY);
            }
        }

        if (tile.type === 'rack' && tile.utilization !== null && tile.utilization !== undefined && h > tileSize * 0.8) {
            var smallFont = tileSize / 4.5;
            ctx.font = smallFont + 'px -apple-system, "Segoe UI", sans-serif';
            ctx.globalAlpha = 0.7;
            ctx.fillText(Math.round(tile.utilization) + '%', centerX, centerY + fontSize * 0.6);
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

            var objectLinkEl = document.getElementById('tile-detail-object-link');
            if (objectLinkEl) {
                if (tile.object_url) {
                    objectLinkEl.innerHTML = '<a href="' + tile.object_url + '">' +
                        (tile.object_type || 'Object') + '</a>';
                } else {
                    objectLinkEl.textContent = '-';
                }
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
        render();
        updateDetailPanel(selectedTile);
        updateRackElevation(selectedTile);
        highlightSidebarItem(selectedTile ? selectedTile.id : -1);
    });

    /**
     * Hover for cursor change and tooltip.
     */
    canvas.addEventListener('mousemove', function(e) {
        if (isPanning) return;

        var pos = getMousePos(e);
        var world = screenToWorld(pos.x, pos.y);

        var tile = findTileAt(world.x, world.y);
        canvas.style.cursor = tile ? 'pointer' : 'default';
        if (tile) {
            // Show label on hover, fall back to tile type
            var tooltipText = tile.label || tile.type;
            if (tile.utilization !== null && tile.utilization !== undefined) {
                tooltipText += ' (' + Math.round(tile.utilization) + '%)';
            }
            canvas.title = tooltipText;
        } else {
            canvas.title = '';
        }
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
        var typeNames = {
            'rack': 'Rack', 'ap': 'AP', 'cooling': 'Cooling', 'power': 'Power',
            'aisle': 'Aisle', 'wall': 'Wall', 'door': 'Door', 'column': 'Column',
            'empty': 'Empty', 'reserved': 'Reserved', 'camera': 'Camera', 'printer': 'Printer'
        };
        for (var ti = 0; ti < ALL_TYPES.length; ti++) {
            if (visibleTypes.has(ALL_TYPES[ti])) {
                legendItems.push(typeNames[ALL_TYPES[ti]] || ALL_TYPES[ti]);
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
            var url = '/plugins/floorplan/floorplans/' + fpId + '/visualization/';
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

    var TYPE_COLORS = {
        'rack': '#6b6b80', 'aisle': '#3a3a50', 'wall': '#5c5c6e', 'column': '#6e6e80',
        'door': '#1a8a7a', 'cooling': '#1890b0', 'power': '#c89a20', 'empty': '#2a2a3e',
        'reserved': '#b06820', 'ap': '#7b42c8', 'camera': '#c42020', 'printer': '#e67e22'
    };

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
     */
    function buildSidebar() {
        if (!tileListEl) return;

        var query = tileSearchInput ? tileSearchInput.value.toLowerCase().trim() : '';

        var filtered = tiles.filter(function(t) {
            if (!visibleTypes.has(t.type)) return false;  // respect type toggles
            if (query) {
                var text = (t.label || '').toLowerCase() + ' ' + (t.type || '').toLowerCase();
                if (text.indexOf(query) === -1) return false;
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
            var color = t.type === 'rack' ? getUtilizationColor(t.utilization) : (TYPE_COLORS[t.type] || '#6b6b80');
            var isActive = selectedTile && selectedTile.id === t.id;
            html += '<div class="sidebar-tile-item' + (isActive ? ' active' : '') + '" data-tile-id="' + t.id + '">';
            html += '<div class="sidebar-tile-dot" style="background:' + color + '"></div>';
            html += '<span class="sidebar-tile-label">' + (t.label || '<em>' + t.type + '</em>') + '</span>';
            html += '<span class="sidebar-tile-type">' + t.type + '</span>';
            html += '<span class="sidebar-tile-pos">' + t.x + ',' + t.y + '</span>';
            html += '</div>';
        }

        tileListEl.innerHTML = html;

        // Click handlers
        var items = tileListEl.querySelectorAll('.sidebar-tile-item');
        for (var j = 0; j < items.length; j++) {
            items[j].addEventListener('click', (function(item) {
                return function() {
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

    // Load background image if specified
    if (backgroundImageUrl) {
        bgImg = new Image();
        bgImg.onload = function() {
            render();
            buildSidebar();
        };
        bgImg.src = backgroundImageUrl;
    } else {
        render();
        buildSidebar();
    }

    // Export for editor module
    window.floorplanViewer = {
        tiles: tiles,
        render: render,
        findTileAt: findTileAt,
        tileSize: tileSize,
        canvas: canvas,
        screenToWorld: screenToWorld,
        getSelectedTile: function() { return selectedTile; }
    };
})();
