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

    // API endpoint mapping for each object type
    var API_ENDPOINTS = {
        'dcim.rack': '/api/dcim/racks/',
        'dcim.device': '/api/dcim/devices/',
        'dcim.powerpanel': '/api/dcim/power-panels/',
        'dcim.powerfeed': '/api/dcim/power-feeds/'
    };

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

    // ===== Object Linking =====

    var linkPanel = document.getElementById('link-object-panel');
    var linkTypeSelect = document.getElementById('link-object-type');
    var linkObjectSelect = document.getElementById('link-object-select');
    var linkBtn = document.getElementById('link-object-btn');
    var unlinkBtn = document.getElementById('unlink-object-btn');
    var linkStatus = document.getElementById('link-status');
    var linkCurrent = document.getElementById('link-current');

    /**
     * Show the link panel when a tile is selected.
     * Called by the viewer via a custom event or override.
     */
    function onTileSelected(tile) {
        var fpLinkPanel = document.getElementById('link-floorplan-panel');

        if (!tile) {
            if (linkPanel) linkPanel.classList.add('d-none');
            if (fpLinkPanel) fpLinkPanel.classList.add('d-none');
            return;
        }

        // Show floorplan link panel only for floorplan_link tiles
        if (fpLinkPanel) {
            if (tile.type === 'floorplan_link') {
                fpLinkPanel.classList.remove('d-none');
            } else {
                fpLinkPanel.classList.add('d-none');
            }
        }

        // Show object link panel
        if (linkPanel) linkPanel.classList.remove('d-none');

        // Show current linked object
        if (tile.object_type && tile.object_url) {
            linkCurrent.innerHTML = 'Currently linked: <strong>' + tile.object_type + '</strong>' +
                ' &mdash; <a href="' + tile.object_url + '">' + (tile.label || 'View') + '</a>';
            unlinkBtn.disabled = false;
        } else {
            linkCurrent.textContent = 'No object linked to this tile.';
            unlinkBtn.disabled = true;
        }

        linkStatus.textContent = '';
    }

    // Hook into the viewer's click handler to show/hide link panel
    if (canvas && linkPanel) {
        canvas.addEventListener('click', function() {
            // Small delay to let the viewer update selectedTile
            setTimeout(function() {
                var viewer = window.floorplanViewer;
                if (viewer) {
                    onTileSelected(viewer.getSelectedTile());
                }
            }, 50);
        });
    }

    // When object type changes, fetch available objects from the API
    if (linkTypeSelect) {
        linkTypeSelect.addEventListener('change', function() {
            var objectType = this.value;
            linkObjectSelect.innerHTML = '<option value="">-- Loading... --</option>';
            linkObjectSelect.disabled = true;
            linkBtn.disabled = true;

            if (!objectType) {
                linkObjectSelect.innerHTML = '<option value="">-- Select object type first --</option>';
                return;
            }

            var endpoint = API_ENDPOINTS[objectType];
            if (!endpoint) return;

            // Build query - filter by site for racks/devices/power-panels
            var url = endpoint + '?limit=500&brief=true';
            if (objectType === 'dcim.rack' || objectType === 'dcim.device' || objectType === 'dcim.powerpanel') {
                url += '&site_id=' + siteId;
            }

            fetch(url, {
                headers: { 'Accept': 'application/json' }
            })
            .then(function(response) { return response.json(); })
            .then(function(data) {
                var results = data.results || [];
                linkObjectSelect.innerHTML = '<option value="">-- Select ' +
                    objectType.split('.')[1] + ' (' + results.length + ') --</option>';

                results.forEach(function(obj) {
                    var option = document.createElement('option');
                    option.value = obj.id;
                    option.textContent = obj.display || obj.name || ('ID: ' + obj.id);
                    linkObjectSelect.appendChild(option);
                });

                linkObjectSelect.disabled = false;
            })
            .catch(function(err) {
                linkObjectSelect.innerHTML = '<option value="">-- Error loading --</option>';
                console.error('Failed to fetch objects:', err);
            });
        });
    }

    // Enable link button when an object is selected
    if (linkObjectSelect) {
        linkObjectSelect.addEventListener('change', function() {
            linkBtn.disabled = !this.value;
        });
    }

    // Link button: PATCH the tile with the selected object
    if (linkBtn) {
        linkBtn.addEventListener('click', function() {
            var panel = document.getElementById('tile-detail-panel');
            var tileId = panel ? panel.dataset.selectedTileId : null;
            if (!tileId) {
                alert('No tile selected.');
                return;
            }

            var objectType = linkTypeSelect.value;
            var objectId = parseInt(linkObjectSelect.value, 10);
            if (!objectType || !objectId) {
                alert('Select an object type and object.');
                return;
            }

            linkStatus.textContent = 'Linking...';
            linkBtn.disabled = true;

            fetch(apiUrl + tileId + '/', {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': csrfToken
                },
                body: JSON.stringify({
                    assigned_object_type: objectType,
                    assigned_object_id: objectId
                })
            })
            .then(function(response) {
                if (response.ok) {
                    return response.json().then(function(updated) {
                        linkStatus.textContent = 'Linked!';
                        linkStatus.className = 'small text-success ms-2';

                        // Update the tile in the viewer
                        var viewer = window.floorplanViewer;
                        if (viewer) {
                            var selectedText = linkObjectSelect.options[linkObjectSelect.selectedIndex].textContent;
                            for (var i = 0; i < viewer.tiles.length; i++) {
                                if (viewer.tiles[i].id === parseInt(tileId)) {
                                    viewer.tiles[i].object_type = objectType.split('.')[1];
                                    viewer.tiles[i].object_url = updated.assigned_object ? updated.assigned_object.url : null;
                                    viewer.tiles[i].utilization = updated.utilization;
                                    if (!viewer.tiles[i].label) {
                                        viewer.tiles[i].label = selectedText;
                                    }
                                    break;
                                }
                            }
                            viewer.render();
                            onTileSelected(viewer.getSelectedTile());
                        }

                        setTimeout(function() {
                            linkStatus.textContent = '';
                            linkStatus.className = 'small text-muted ms-2';
                        }, 2000);
                    });
                } else {
                    return response.json().then(function(err) {
                        linkStatus.textContent = 'Error!';
                        linkStatus.className = 'small text-danger ms-2';
                        alert('Error linking object: ' + JSON.stringify(err));
                    });
                }
            })
            .catch(function(err) {
                linkStatus.textContent = 'Error!';
                linkStatus.className = 'small text-danger ms-2';
                alert('Network error: ' + err.message);
            });
        });
    }

    // Unlink button: PATCH the tile to remove the linked object
    if (unlinkBtn) {
        unlinkBtn.addEventListener('click', function() {
            var panel = document.getElementById('tile-detail-panel');
            var tileId = panel ? panel.dataset.selectedTileId : null;
            if (!tileId) return;

            linkStatus.textContent = 'Unlinking...';
            unlinkBtn.disabled = true;

            fetch(apiUrl + tileId + '/', {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': csrfToken
                },
                body: JSON.stringify({
                    assigned_object_type: null,
                    assigned_object_id: null
                })
            })
            .then(function(response) {
                if (response.ok) {
                    linkStatus.textContent = 'Unlinked!';
                    linkStatus.className = 'small text-success ms-2';

                    // Update the tile in the viewer
                    var viewer = window.floorplanViewer;
                    if (viewer) {
                        for (var i = 0; i < viewer.tiles.length; i++) {
                            if (viewer.tiles[i].id === parseInt(tileId)) {
                                viewer.tiles[i].object_type = null;
                                viewer.tiles[i].object_url = null;
                                viewer.tiles[i].utilization = null;
                                break;
                            }
                        }
                        viewer.render();
                        onTileSelected(viewer.getSelectedTile());
                    }

                    setTimeout(function() {
                        linkStatus.textContent = '';
                        linkStatus.className = 'small text-muted ms-2';
                    }, 2000);
                } else {
                    alert('Error unlinking object.');
                }
            })
            .catch(function(err) {
                alert('Network error: ' + err.message);
            });
        });
    }

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
