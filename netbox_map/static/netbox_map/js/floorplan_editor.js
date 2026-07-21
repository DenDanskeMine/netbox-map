/**
 * FloorPlan Editor — Tile placement, deletion, resize.
 * Loaded only when edit mode is active (?edit=true).
 * Depends on: floorplan_core.js, floorplan_main.js (via window.floorplanViewer)
 */
(function(App) {
    'use strict';

    var viewer = window.floorplanViewer;
    if (!viewer || !viewer.state.editMode) return;

    var state = viewer.state;
    var events = viewer.events;
    var canvas = viewer.canvas;

    // Settings persistence key
    var STORAGE_KEY = 'floorplan_editor_settings';

    // ─── Chip Type Helpers ──────────────────────────────────────────

    function getActiveType() {
        var active = document.querySelector('.fp-type-chip.active');
        return active ? active.getAttribute('data-type') : '';
    }

    function setActiveType(slug) {
        var chips = document.querySelectorAll('.fp-type-chip');
        for (var i = 0; i < chips.length; i++) {
            if (chips[i].getAttribute('data-type') === slug) {
                chips[i].classList.add('active');
            } else {
                chips[i].classList.remove('active');
            }
        }
    }

    // Wire click handlers on chips
    var chipContainer = document.getElementById('fp-type-chips');
    if (chipContainer) {
        chipContainer.addEventListener('click', function(e) {
            var chip = e.target.closest('.fp-type-chip');
            if (!chip) return;
            setActiveType(chip.getAttribute('data-type'));
            toggleCameraFovControls();
            saveSettings();
        });
    }

    // ─── Settings Persistence ─────────────────────────────────────

    function saveSettings() {
        var settings = {
            tileType: getActiveType(),
            label: document.getElementById('tile-label-input').value,
            width: document.getElementById('tile-width-input').value,
            height: document.getElementById('tile-height-input').value,
            orientation: document.getElementById('tile-orientation-select') ? document.getElementById('tile-orientation-select').value : '0',
            fovDirection: document.getElementById('tile-fov-direction-input') ? document.getElementById('tile-fov-direction-input').value : '0',
            fovAngle: document.getElementById('tile-fov-angle-input') ? document.getElementById('tile-fov-angle-input').value : '90',
            fovDistance: document.getElementById('tile-fov-distance-input') ? document.getElementById('tile-fov-distance-input').value : '5'
        };
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    }

    function restoreSettings() {
        var stored = sessionStorage.getItem(STORAGE_KEY);
        if (!stored) return;
        try {
            var settings = JSON.parse(stored);
            if (settings.tileType) {
                setActiveType(settings.tileType);
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
            if (settings.orientation) {
                var orientSel = document.getElementById('tile-orientation-select');
                if (orientSel) orientSel.value = settings.orientation;
            }
            if (settings.fovDirection) {
                var dirNum = document.getElementById('tile-fov-direction-input');
                var dirSlider = document.getElementById('tile-fov-direction-slider');
                if (dirNum) dirNum.value = settings.fovDirection;
                if (dirSlider) dirSlider.value = settings.fovDirection;
            }
            if (settings.fovAngle) {
                var angNum = document.getElementById('tile-fov-angle-input');
                var angSlider = document.getElementById('tile-fov-angle-slider');
                if (angNum) angNum.value = settings.fovAngle;
                if (angSlider) angSlider.value = settings.fovAngle;
            }
            if (settings.fovDistance) {
                var distNum = document.getElementById('tile-fov-distance-input');
                var distSlider = document.getElementById('tile-fov-distance-slider');
                if (distNum) distNum.value = settings.fovDistance;
                if (distSlider) distSlider.value = settings.fovDistance;
            }
        } catch (e) {
            // Ignore parse errors
        }
    }

    restoreSettings();

    // ─── Toolbar Slider ↔ Number Sync ────────────────────────────

    function syncToolbarPair(sliderId, numberId) {
        var slider = document.getElementById(sliderId);
        var number = document.getElementById(numberId);
        if (!slider || !number) return;
        // Init slider from number (restored settings)
        slider.value = number.value;
        slider.addEventListener('input', function() {
            number.value = slider.value;
            saveSettings();
        });
        number.addEventListener('input', function() {
            slider.value = number.value;
            saveSettings();
        });
    }

    syncToolbarPair('tile-fov-direction-slider', 'tile-fov-direction-input');
    syncToolbarPair('tile-fov-angle-slider', 'tile-fov-angle-input');
    syncToolbarPair('tile-fov-distance-slider', 'tile-fov-distance-input');

    // ─── Camera FOV Controls Toggle ───────────────────────────────

    var cameraFovControls = document.getElementById('camera-fov-controls');

    function toggleCameraFovControls() {
        if (!cameraFovControls) return;
        if (getActiveType() === 'camera') {
            cameraFovControls.classList.remove('d-none');
            cameraFovControls.classList.add('d-flex');
        } else {
            cameraFovControls.classList.add('d-none');
            cameraFovControls.classList.remove('d-flex');
        }
    }

    toggleCameraFovControls();

    // ─── Collision Detection ──────────────────────────────────────

    function isPositionOccupied(gridX, gridY, newWidth, newHeight, excludeId) {
        return App.isPositionOccupied(state, gridX, gridY, newWidth, newHeight, excludeId);
    }

    // ─── Create/Delete Primitives ───────────────────────────────────
    // Shared by the toolbar's double-click-to-place flow, copy/paste, and
    // undo/redo (a delete's undo re-creates the tile; a create's undo
    // deletes it) — see floorplan_hotkeys.js. Keeping these as the one path
    // that talks to the API means every caller's tiles look the same to
    // history, no matter how they were created.

    /** Snapshot a client-side tile into a payload createTileFromPayload() can replay. */
    function tileToCreatePayload(tile) {
        var payload = {
            floorplan: state.floorplanId,
            x_position: tile.x,
            y_position: tile.y,
            width: tile.w,
            height: tile.h,
            tile_type: tile.type,
            label: tile.label || '',
            status: tile.status || 'active',
            orientation: tile.orientation || 0,
        };
        if (tile.type === 'camera') {
            payload.fov_direction = tile.fov_direction || 0;
            payload.fov_angle = tile.fov_angle || 90;
            payload.fov_distance = tile.fov_distance || 5;
        }
        // object_type_model is the bare model name (e.g. "device") per
        // _serialize_tile in views.py; every ASSIGNABLE_MODELS entry lives
        // under dcim (see FloorPlanTileSerializer's assigned_object_type
        // queryset), so this reconstruction is safe.
        if (tile.object_type_model && tile.object_id) {
            payload.assigned_object_type = 'dcim.' + tile.object_type_model;
            payload.assigned_object_id = tile.object_id;
        }
        if (tile.linked_floorplan_id) {
            payload.linked_floorplan = tile.linked_floorplan_id;
        }
        return payload;
    }

    /** Convert an API tile response into the shape state.tiles/the renderer expect. */
    function apiTileToClientTile(newTile) {
        return {
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
            object_type_model: null,
            object_name: null,
            object_id: null,
            object_url: null,
            utilization: null,
            primary_ip: null,
            linked_floorplan_id: null,
            linked_floorplan_name: null,
            linked_floorplan_url: null,
            fov_direction: newTile.fov_direction || 0,
            fov_angle: newTile.fov_angle || 90,
            fov_distance: newTile.fov_distance || 5,
            drop_port_count: 0
        };
    }

    /** POST a tile payload, add it to state, and return the new client tile. Does NOT touch history. */
    function createTileFromPayload(payload) {
        var api = new App.API(state);
        return api.post(state.apiUrl, payload).then(function(newTile) {
            var clientTile = apiTileToClientTile(newTile);
            state.addTile(clientTile);
            events.emit('sidebar:rebuild');
            return clientTile;
        });
    }

    /** DELETE a tile by id and remove it from state. Does NOT touch history. */
    function deleteTileById(tileId) {
        var api = new App.API(state);
        return api.del(state.apiUrl + tileId + '/').then(function() {
            state.removeTile(tileId);
            events.emit('sidebar:rebuild');
        });
    }

    App.createTileFromPayload = createTileFromPayload;
    App.deleteTileById = deleteTileById;
    App.tileToCreatePayload = tileToCreatePayload;

    // ─── Create Tile (toolbar double-click-to-place) ────────────────

    function createTile(gridX, gridY) {
        var tileType = getActiveType();
        var label = document.getElementById('tile-label-input').value;
        var tileWidth = parseInt(document.getElementById('tile-width-input').value, 10) || 1;
        var tileHeight = parseInt(document.getElementById('tile-height-input').value, 10) || 1;

        if (gridX + tileWidth > state.gridWidth || gridY + tileHeight > state.gridHeight) {
            alert('Tile would exceed grid boundaries.');
            return;
        }

        if (isPositionOccupied(gridX, gridY, tileWidth, tileHeight)) {
            alert('Position is already occupied by another tile.');
            return;
        }

        saveSettings();

        var orientSelect = document.getElementById('tile-orientation-select');
        var orientation = parseInt(orientSelect ? orientSelect.value : 0, 10) || 0;

        var data = {
            floorplan: state.floorplanId,
            x_position: gridX,
            y_position: gridY,
            width: tileWidth,
            height: tileHeight,
            tile_type: tileType,
            label: label,
            status: 'active',
            orientation: orientation
        };

        if (tileType === 'camera') {
            var fovDirInput = document.getElementById('tile-fov-direction-input');
            var fovAngleInput = document.getElementById('tile-fov-angle-input');
            var fovDistInput = document.getElementById('tile-fov-distance-input');
            data.fov_direction = parseInt(fovDirInput ? fovDirInput.value : 0, 10) || 0;
            data.fov_angle = parseInt(fovAngleInput ? fovAngleInput.value : 90, 10) || 90;
            data.fov_distance = parseInt(fovDistInput ? fovDistInput.value : 5, 10) || 5;
        }

        createTileFromPayload(data)
        .then(function(clientTile) {
            App.pushCreateHistory(state, { id: clientTile.id }, data);
        })
        .catch(function(err) {
            alert('Error creating tile: ' + (err.detail ? JSON.stringify(err.detail) : err.message));
        });
    }

    // ─── Delete Tile ──────────────────────────────────────────────

    /** options.confirm defaults to true (button flow); keyboard Delete passes false since undo covers it. */
    function deleteTile(tileId, options) {
        var confirmFirst = !options || options.confirm !== false;
        if (confirmFirst && !confirm('Delete this tile?')) return;

        tileId = parseInt(tileId, 10);
        var tile = state.findTileById(tileId);
        if (!tile) return;
        var payload = tileToCreatePayload(tile);
        var holder = { id: tileId };

        deleteTileById(holder.id)
        .then(function() {
            App.pushDeleteHistory(state, holder, payload);
        })
        .catch(function(err) {
            alert('Error deleting tile: ' + (err.detail ? JSON.stringify(err.detail) : err.message));
        });
    }
    App.deleteTile = deleteTile;

    // ─── Resize Tile ──────────────────────────────────────────────

    var resizeBtn = document.getElementById('resize-tile-btn');
    var resizeWidthInput = document.getElementById('resize-width-input');
    var resizeHeightInput = document.getElementById('resize-height-input');

    if (resizeBtn) {
        resizeBtn.addEventListener('click', function() {
            var tile = state.selectedTile;
            if (!tile) { alert('No tile selected.'); return; }

            var newW = parseInt(resizeWidthInput.value, 10);
            var newH = parseInt(resizeHeightInput.value, 10);

            newW = Math.max(1, Math.min(state.tileMaxSize, newW || 1));
            newH = Math.max(1, Math.min(state.tileMaxSize, newH || 1));
            resizeWidthInput.value = newW;
            resizeHeightInput.value = newH;

            if (newW === tile.w && newH === tile.h) return;

            if (tile.x + newW > state.gridWidth || tile.y + newH > state.gridHeight) {
                alert('Tile would exceed grid boundaries.');
                return;
            }

            if (isPositionOccupied(tile.x, tile.y, newW, newH, tile.id)) {
                alert('Resize would overlap with another tile.');
                return;
            }

            // Optimistic update
            var origW = tile.w;
            var origH = tile.h;
            tile.w = newW;
            tile.h = newH;
            events.emit('render');

            resizeBtn.disabled = true;
            resizeBtn.textContent = 'Saving...';

            var api = new App.API(state);
            api.patch(state.apiUrl + tile.id + '/', { width: newW, height: newH })
            .then(function() {
                var sizeEl = document.getElementById('tile-detail-size');
                if (sizeEl) sizeEl.textContent = newW + ' x ' + newH;
                resizeBtn.innerHTML = '<i class="mdi mdi-check"></i> Saved!';
                resizeBtn.classList.remove('btn-primary');
                resizeBtn.classList.add('btn-success');
                events.emit('tile:update', tile);
                events.emit('sidebar:rebuild');
                App.pushFieldHistory(state, events, tile, { w: newW, h: newH }, { w: origW, h: origH });
                setTimeout(function() {
                    resizeBtn.innerHTML = '<i class="mdi mdi-resize"></i> Resize';
                    resizeBtn.classList.remove('btn-success');
                    resizeBtn.classList.add('btn-primary');
                    resizeBtn.disabled = false;
                }, 1500);
            })
            .catch(function(err) {
                tile.w = origW;
                tile.h = origH;
                events.emit('render');
                alert('Resize failed: ' + (err.detail ? JSON.stringify(err.detail) : err.message));
                resizeBtn.innerHTML = '<i class="mdi mdi-resize"></i> Resize';
                resizeBtn.disabled = false;
            });
        });
    }

    // ─── Orientation Change ──────────────────────────────────────

    var orientBtn = document.getElementById('orientation-tile-btn');
    var orientSelect = document.getElementById('orientation-select');

    if (orientBtn) {
        orientBtn.addEventListener('click', function() {
            var tile = state.selectedTile;
            if (!tile) { alert('No tile selected.'); return; }

            var newOrient = parseInt(orientSelect.value, 10);
            if (newOrient === (tile.orientation || 0)) return;

            var origOrient = tile.orientation || 0;
            tile.orientation = newOrient;
            events.emit('render');

            orientBtn.disabled = true;
            orientBtn.textContent = 'Saving...';

            var api = new App.API(state);
            api.patch(state.apiUrl + tile.id + '/', { orientation: newOrient })
            .then(function() {
                orientBtn.innerHTML = '<i class="mdi mdi-check"></i> Saved!';
                orientBtn.classList.remove('btn-primary');
                orientBtn.classList.add('btn-success');
                events.emit('tile:update', tile);
                App.pushFieldHistory(state, events, tile, { orientation: newOrient }, { orientation: origOrient });
                setTimeout(function() {
                    orientBtn.innerHTML = '<i class="mdi mdi-rotate-right"></i> Set';
                    orientBtn.classList.remove('btn-success');
                    orientBtn.classList.add('btn-primary');
                    orientBtn.disabled = false;
                }, 1500);
            })
            .catch(function(err) {
                tile.orientation = origOrient;
                events.emit('render');
                alert('Orientation change failed: ' + (err.detail ? JSON.stringify(err.detail) : err.message));
                orientBtn.innerHTML = '<i class="mdi mdi-rotate-right"></i> Set';
                orientBtn.disabled = false;
            });
        });
    }

    // ─── Canvas Event Handlers ────────────────────────────────────

    // Double-click to add tile
    canvas.addEventListener('dblclick', function(e) {
        var rect = canvas.getBoundingClientRect();
        var sx = e.clientX - rect.left;
        var sy = e.clientY - rect.top;
        var world = viewer.screenToWorld(sx, sy);
        var gridX = Math.floor(world.x / state.tileSize);
        var gridY = Math.floor(world.y / state.tileSize);

        createTile(gridX, gridY);
    });

    // Delete button
    var deleteBtn = document.getElementById('delete-tile-btn');
    if (deleteBtn) {
        deleteBtn.addEventListener('click', function() {
            var tile = state.selectedTile;
            if (tile) {
                deleteTile(tile.id);
            }
        });
    }

})(window.FloorplanApp);
