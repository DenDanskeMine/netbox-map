/**
 * FloorPlan Editor - Extends the viewer with tile placement, deletion, and object linking.
 * Loaded only when edit mode is active (?edit=true).
 */
(function() {
    'use strict';

    var container = document.getElementById('floorplan-container');
    if (!container || container.dataset.editMode !== 'true') return;

    var canvas = document.getElementById('floorplan-canvas');
    var tileSize = parseInt(container.dataset.tileSize, 10);
    var apiUrl = container.dataset.apiUrl;
    var floorplanId = parseInt(container.dataset.floorplanId, 10);
    var siteId = parseInt(container.dataset.siteId, 10);
    var csrfToken = container.dataset.csrfToken;

    // Settings persistence key
    var STORAGE_KEY = 'floorplan_editor_settings';


    /**
     * Save current toolbar settings to sessionStorage.
     */
    function saveSettings() {
        var settings = {
            tileType: document.getElementById('tile-type-select').value,
            label: document.getElementById('tile-label-input').value,
            width: document.getElementById('tile-width-input').value,
            height: document.getElementById('tile-height-input').value,
            fovDirection: document.getElementById('tile-fov-direction-input') ? document.getElementById('tile-fov-direction-input').value : '0',
            fovAngle: document.getElementById('tile-fov-angle-input') ? document.getElementById('tile-fov-angle-input').value : '90',
            fovDistance: document.getElementById('tile-fov-distance-input') ? document.getElementById('tile-fov-distance-input').value : '5'
        };
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    }

    /**
     * Restore toolbar settings from sessionStorage.
     */
    function restoreSettings() {
        var stored = sessionStorage.getItem(STORAGE_KEY);
        if (!stored) return;
        try {
            var settings = JSON.parse(stored);
            if (settings.tileType) {
                document.getElementById('tile-type-select').value = settings.tileType;
            }
            if (settings.label !== undefined) {
                document.getElementById('tile-label-input').value = settings.label;
            }
            if (settings.width) {
                document.getElementById('tile-width-input').value = settings.width;
            }
            if (settings.height) {
                document.getElementById('tile-height-input').value = settings.height;
            }
            if (settings.fovDirection && document.getElementById('tile-fov-direction-input')) {
                document.getElementById('tile-fov-direction-input').value = settings.fovDirection;
            }
            if (settings.fovAngle && document.getElementById('tile-fov-angle-input')) {
                document.getElementById('tile-fov-angle-input').value = settings.fovAngle;
            }
            if (settings.fovDistance && document.getElementById('tile-fov-distance-input')) {
                document.getElementById('tile-fov-distance-input').value = settings.fovDistance;
            }
        } catch (e) {
            // Ignore parse errors
        }
    }

    // Restore settings on load
    restoreSettings();

    // ===== Camera FOV Controls Toggle =====
    var tileTypeSelect = document.getElementById('tile-type-select');
    var cameraFovControls = document.getElementById('camera-fov-controls');

    function toggleCameraFovControls() {
        if (!cameraFovControls) return;
        if (tileTypeSelect && tileTypeSelect.value === 'camera') {
            cameraFovControls.classList.remove('d-none');
            cameraFovControls.classList.add('d-flex');
        } else {
            cameraFovControls.classList.add('d-none');
            cameraFovControls.classList.remove('d-flex');
        }
    }

    if (tileTypeSelect) {
        tileTypeSelect.addEventListener('change', function() {
            toggleCameraFovControls();
            saveSettings();
        });
        // Initial check on load
        toggleCameraFovControls();
    }

    /**
     * Check if a grid position is already occupied by any tile.
     */
    function isPositionOccupied(gridX, gridY, newWidth, newHeight) {
        var viewer = window.floorplanViewer;
        if (!viewer) return false;

        for (var i = 0; i < viewer.tiles.length; i++) {
            var t = viewer.tiles[i];
            if (gridX < t.x + t.w && gridX + newWidth > t.x &&
                gridY < t.y + t.h && gridY + newHeight > t.y) {
                // Only block if this tile is actually known and visible
                if (viewer.visibleTypes && !viewer.visibleTypes.has(t.type)) continue;
                return true;
            }
        }
        return false;
    }

    /**
     * Create a tile via the REST API.
     */
    function createTile(gridX, gridY) {
        var tileType = document.getElementById('tile-type-select').value;
        var label = document.getElementById('tile-label-input').value;
        var tileWidth = parseInt(document.getElementById('tile-width-input').value, 10) || 1;
        var tileHeight = parseInt(document.getElementById('tile-height-input').value, 10) || 1;

        // Check bounds
        var gridWidth = parseInt(container.dataset.gridWidth, 10);
        var gridHeight = parseInt(container.dataset.gridHeight, 10);
        if (gridX + tileWidth > gridWidth || gridY + tileHeight > gridHeight) {
            alert('Tile would exceed grid boundaries.');
            return;
        }

        // Check overlap
        if (isPositionOccupied(gridX, gridY, tileWidth, tileHeight)) {
            alert('Position is already occupied by another tile.');
            return;
        }

        // Save settings before the request
        saveSettings();

        var data = {
            floorplan: floorplanId,
            x_position: gridX,
            y_position: gridY,
            width: tileWidth,
            height: tileHeight,
            tile_type: tileType,
            label: label,
            status: 'active',
            orientation: 0
        };

        // Include FOV fields for camera tiles
        if (tileType === 'camera') {
            var fovDirInput = document.getElementById('tile-fov-direction-input');
            var fovAngleInput = document.getElementById('tile-fov-angle-input');
            var fovDistInput = document.getElementById('tile-fov-distance-input');
            data.fov_direction = parseInt(fovDirInput ? fovDirInput.value : 0, 10) || 0;
            data.fov_angle = parseInt(fovAngleInput ? fovAngleInput.value : 90, 10) || 90;
            data.fov_distance = parseInt(fovDistInput ? fovDistInput.value : 5, 10) || 5;
        }

        fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': csrfToken
            },
            body: JSON.stringify(data)
        })
        .then(function(response) {
            if (response.ok) {
                return response.json().then(function(newTile) {
                    var viewer = window.floorplanViewer;
                    if (viewer) {
                        viewer.tiles.push({
                            id: newTile.id,
                            x: newTile.x_position,
                            y: newTile.y_position,
                            w: newTile.width,
                            h: newTile.height,
                            label: newTile.label || '',
                            type: newTile.tile_type,
                            status: newTile.status,
                            orientation: newTile.orientation,
                            object_type: null,
                            object_url: null,
                            utilization: null,
                            linked_floorplan_id: null,
                            linked_floorplan_name: null,
                            linked_floorplan_url: null,
                            fov_direction: newTile.fov_direction || 0,
                            fov_angle: newTile.fov_angle || 90,
                            fov_distance: newTile.fov_distance || 5
                        });
                        viewer.render();
                    }
                });
            } else {
                return response.json().then(function(err) {
                    alert('Error creating tile: ' + JSON.stringify(err));
                });
            }
        })
        .catch(function(err) {
            alert('Network error: ' + err.message);
        });
    }

    /**
     * Delete a tile via the REST API.
     */
    function deleteTile(tileId) {
        if (!confirm('Delete this tile?')) return;

        fetch(apiUrl + tileId + '/', {
            method: 'DELETE',
            headers: {
                'X-CSRFToken': csrfToken
            }
        })
        .then(function(response) {
            if (response.ok || response.status === 204) {
                var viewer = window.floorplanViewer;
                if (viewer) {
                    viewer.tiles = viewer.tiles.filter(function(t) { return t.id !== parseInt(tileId); });
                    viewer.render();
                    clearSelection();
                }
            } else {
                alert('Error deleting tile.');
            }
        })
        .catch(function(err) {
            alert('Network error: ' + err.message);
        });
    }

    /**
     * Clear the current tile selection UI.
     */
    function clearSelection() {
        var panel = document.getElementById('tile-detail-panel');
        if (panel) {
            panel.classList.add('d-none');
            panel.dataset.selectedTileId = '';
        }
        var statusBar = document.getElementById('selection-status');
        if (statusBar) {
            statusBar.innerHTML = '<span class="text-muted">Click a tile to select</span>';
        }
        var deleteBtn = document.getElementById('delete-tile-btn');
        if (deleteBtn) deleteBtn.disabled = true;

        // Hide link panels
        var linkPanel = document.getElementById('link-object-panel');
        if (linkPanel) linkPanel.classList.add('d-none');
        var fpLinkPanel = document.getElementById('link-floorplan-panel');
        if (fpLinkPanel) fpLinkPanel.classList.add('d-none');
    }

    // ===== Object Linking is handled by the inline script in the template =====
    // (Tom Select with AJAX search - see floorplan_visualization.html)

    // ===== Resize Tile =====

    var resizeBtn = document.getElementById('resize-tile-btn');
    var resizeWidthInput = document.getElementById('resize-width-input');
    var resizeHeightInput = document.getElementById('resize-height-input');

    /**
     * Check if a grid position is occupied by any tile other than the given one.
     */
    function isPositionOccupiedExcept(gridX, gridY, newWidth, newHeight, excludeId) {
        var viewer = window.floorplanViewer;
        if (!viewer) return false;

        for (var i = 0; i < viewer.tiles.length; i++) {
            var t = viewer.tiles[i];
            if (t.id === excludeId) continue;
            if (gridX < t.x + t.w && gridX + newWidth > t.x &&
                gridY < t.y + t.h && gridY + newHeight > t.y) {
                if (viewer.visibleTypes && !viewer.visibleTypes.has(t.type)) continue;
                return true;
            }
        }
        return false;
    }

    if (resizeBtn) {
        resizeBtn.addEventListener('click', function() {
            var viewer = window.floorplanViewer;
            if (!viewer) return;
            var tile = viewer.getSelectedTile();
            if (!tile) { alert('No tile selected.'); return; }

            var newW = parseInt(resizeWidthInput.value, 10);
            var newH = parseInt(resizeHeightInput.value, 10);

            // Clamp to 1-10
            newW = Math.max(1, Math.min(10, newW || 1));
            newH = Math.max(1, Math.min(10, newH || 1));
            resizeWidthInput.value = newW;
            resizeHeightInput.value = newH;

            // No change
            if (newW === tile.w && newH === tile.h) return;

            // Check grid boundary
            if (tile.x + newW > viewer.gridWidth || tile.y + newH > viewer.gridHeight) {
                alert('Tile would exceed grid boundaries.');
                return;
            }

            // Check overlap (skip self)
            if (isPositionOccupiedExcept(tile.x, tile.y, newW, newH, tile.id)) {
                alert('Resize would overlap with another tile.');
                return;
            }

            // Optimistic update
            var origW = tile.w;
            var origH = tile.h;
            tile.w = newW;
            tile.h = newH;
            viewer.render();

            resizeBtn.disabled = true;
            resizeBtn.textContent = 'Saving...';

            fetch(apiUrl + tile.id + '/', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrfToken },
                body: JSON.stringify({ width: newW, height: newH })
            })
            .then(function(r) {
                if (r.ok) {
                    // Update detail panel size display
                    var sizeEl = document.getElementById('tile-detail-size');
                    if (sizeEl) sizeEl.textContent = newW + ' x ' + newH;
                    resizeBtn.innerHTML = '<i class="mdi mdi-check"></i> Saved!';
                    resizeBtn.classList.remove('btn-primary');
                    resizeBtn.classList.add('btn-success');
                    if (viewer.buildSidebar) viewer.buildSidebar();
                    setTimeout(function() {
                        resizeBtn.innerHTML = '<i class="mdi mdi-resize"></i> Resize';
                        resizeBtn.classList.remove('btn-success');
                        resizeBtn.classList.add('btn-primary');
                        resizeBtn.disabled = false;
                    }, 1500);
                } else {
                    // Revert on failure
                    tile.w = origW;
                    tile.h = origH;
                    viewer.render();
                    r.json().then(function(err) {
                        alert('Resize failed: ' + JSON.stringify(err));
                    });
                    resizeBtn.innerHTML = '<i class="mdi mdi-resize"></i> Resize';
                    resizeBtn.disabled = false;
                }
            })
            .catch(function(err) {
                tile.w = origW;
                tile.h = origH;
                viewer.render();
                alert('Network error: ' + err.message);
                resizeBtn.innerHTML = '<i class="mdi mdi-resize"></i> Resize';
                resizeBtn.disabled = false;
            });
        });
    }

    // ===== Canvas Event Handlers =====

    // Double-click to add tile (uses viewer's screenToWorld for pan/zoom support)
    canvas.addEventListener('dblclick', function(e) {
        var viewer = window.floorplanViewer;
        var rect = canvas.getBoundingClientRect();
        var sx = e.clientX - rect.left;
        var sy = e.clientY - rect.top;

        var gridX, gridY;
        if (viewer && viewer.screenToWorld) {
            var world = viewer.screenToWorld(sx, sy);
            gridX = Math.floor(world.x / tileSize);
            gridY = Math.floor(world.y / tileSize);
        } else {
            var scaleX = canvas.width / rect.width;
            var scaleY = canvas.height / rect.height;
            gridX = Math.floor((sx * scaleX) / tileSize);
            gridY = Math.floor((sy * scaleY) / tileSize);
        }

        createTile(gridX, gridY);
    });

    // Delete button
    var deleteBtn = document.getElementById('delete-tile-btn');
    if (deleteBtn) {
        deleteBtn.addEventListener('click', function() {
            var panel = document.getElementById('tile-detail-panel');
            var tileId = panel.dataset.selectedTileId;
            if (tileId) {
                deleteTile(tileId);
            }
        });
    }
})();
