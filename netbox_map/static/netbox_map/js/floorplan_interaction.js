/**
 * FloorplanApp Interaction — Pan, zoom, click-to-select, tile drag (edit mode).
 * Depends on: floorplan_core.js, floorplan_renderer.js
 */
(function(App) {
    'use strict';

    function Interaction(state, events, renderer) {
        this.state = state;
        this.events = events;
        this.renderer = renderer;
        this.canvas = renderer.canvas;
        this.container = renderer.container;

        // Drag / pan state
        this._isPanning = false;
        this._didDrag = false;
        this._panStartX = 0;
        this._panStartY = 0;
        this._panStartOffsetX = 0;
        this._panStartOffsetY = 0;

        // Tile drag state (edit mode)
        this._isDraggingTile = false;
        this._dragTile = null;
        this._dragOrigX = 0;
        this._dragOrigY = 0;

        // Tile resize state (edit mode — drag the corner handle)
        this._isResizingTile = false;
        this._resizeTile = null;
        this._resizeOrigW = 0;
        this._resizeOrigH = 0;

        // Tile rotate state (edit mode — drag the offset circle handle)
        this._isRotatingTile = false;
        this._rotateTile = null;
        this._rotateOrigOrient = 0;

        this._bindEvents();
    }

    // ─── Mouse helpers ────────────────────────────────────────────

    Interaction.prototype._getMousePos = function(e) {
        var rect = this.canvas.getBoundingClientRect();
        return {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top
        };
    };

    /** Which handle (if any) of the currently-selected tile is under this world point. */
    Interaction.prototype._handleAt = function(wx, wy) {
        var s = this.state;
        if (!s.editMode || !s.selectedTile) return null;
        if (!s.visibleTypes.has(s.selectedTile.type)) return null;

        var handles = this.renderer.getTileHandles(s.selectedTile);

        var rot = handles.rotate;
        var rdx = wx - rot.x, rdy = wy - rot.y;
        // Slightly generous hit radius (2x drawn size) — a tiny circle is hard to hit precisely.
        if (rdx * rdx + rdy * rdy <= (rot.radius * 2) * (rot.radius * 2)) return 'rotate';

        var rs = handles.resize;
        if (wx >= rs.x - rs.halfSize * 2 && wx <= rs.x + rs.halfSize * 2 &&
            wy >= rs.y - rs.halfSize * 2 && wy <= rs.y + rs.halfSize * 2) return 'resize';

        return null;
    };

    // ─── Event Binding ────────────────────────────────────────────

    Interaction.prototype._bindEvents = function() {
        var self = this;
        var canvas = this.canvas;

        // Wheel zoom — zoom toward cursor
        canvas.addEventListener('wheel', function(e) {
            e.preventDefault();
            self._onWheel(e);
        }, { passive: false });

        // Mouse down — start pan or tile drag
        canvas.addEventListener('mousedown', function(e) {
            self._onMouseDown(e);
        });

        // Mouse move — pan, tile drag, or hover
        window.addEventListener('mousemove', function(e) {
            self._onMouseMove(e);
        });

        // Mouse up — finish pan or tile drag
        window.addEventListener('mouseup', function(e) {
            self._onMouseUp(e);
        });

        // Click — select tile (only if we didn't drag)
        canvas.addEventListener('click', function(e) {
            self._onClick(e);
        });

        // Mouse move on canvas — hover for popover + cursor
        canvas.addEventListener('mousemove', function(e) {
            self._onCanvasHover(e);
        });

        // Mouse leave — hide popover
        canvas.addEventListener('mouseleave', function() {
            self.events.emit('hover', { tile: null, x: 0, y: 0 });
        });

        // Zoom control buttons
        this._bindZoomButtons();
    };

    // ─── Wheel Zoom ───────────────────────────────────────────────

    Interaction.prototype._onWheel = function(e) {
        var s = this.state;
        var pos = this._getMousePos(e);

        // World point under cursor before zoom
        var wx = (pos.x - s.panX) / s.zoom;
        var wy = (pos.y - s.panY) / s.zoom;

        // Adjust zoom (gentle step per scroll tick)
        var delta = e.deltaY < 0 ? 1.05 : 1 / 1.05;
        var newZoom = s.zoom * delta;
        newZoom = Math.max(s.MIN_ZOOM, Math.min(s.MAX_ZOOM, newZoom));

        // Adjust pan so the world point stays under the cursor
        s.panX = pos.x - wx * newZoom;
        s.panY = pos.y - wy * newZoom;
        s.zoom = newZoom;

        this.events.emit('render');
    };

    // ─── Mouse Down ───────────────────────────────────────────────

    Interaction.prototype._onMouseDown = function(e) {
        var s = this.state;

        if (e.button === 1) {
            // Middle button always pans
            this._isPanning = true;
            this._didDrag = false;
            this._panStartX = e.clientX;
            this._panStartY = e.clientY;
            this._panStartOffsetX = s.panX;
            this._panStartOffsetY = s.panY;
            e.preventDefault();
            this.canvas.style.cursor = 'grabbing';
            return;
        }

        if (e.button === 0) {
            var pos = this._getMousePos(e);
            var world = this.renderer.screenToWorld(pos.x, pos.y);

            var handle = this._handleAt(world.x, world.y);
            if (handle === 'resize') {
                this._isResizingTile = true;
                this._resizeTile = s.selectedTile;
                this._resizeOrigW = s.selectedTile.w;
                this._resizeOrigH = s.selectedTile.h;
                this._didDrag = false;
                return;
            }
            if (handle === 'rotate') {
                this._isRotatingTile = true;
                this._rotateTile = s.selectedTile;
                this._rotateOrigOrient = s.selectedTile.orientation || 0;
                this._didDrag = false;
                return;
            }

            var tileUnder = this.renderer.findTileAt(world.x, world.y);

            if (s.editMode && tileUnder) {
                // Start tile drag (edit mode only)
                this._isDraggingTile = true;
                this._dragTile = tileUnder;
                this._dragOrigX = tileUnder.x;
                this._dragOrigY = tileUnder.y;
                this._didDrag = false;
                this._panStartX = e.clientX;
                this._panStartY = e.clientY;
            } else {
                // Pan on empty space (or any left-click in view mode)
                this._isPanning = true;
                this._didDrag = false;
                this._panStartX = e.clientX;
                this._panStartY = e.clientY;
                this._panStartOffsetX = s.panX;
                this._panStartOffsetY = s.panY;
            }
        }
    };

    // ─── Mouse Move ───────────────────────────────────────────────

    Interaction.prototype._onMouseMove = function(e) {
        var s = this.state;

        // Tile resize (edit mode — drag the corner handle)
        if (this._isResizingTile && this._resizeTile) {
            this._didDrag = true;
            this.canvas.style.cursor = 'nwse-resize';
            var tile = this._resizeTile;
            var pos = this._getMousePos(e);
            var world = this.renderer.screenToWorld(pos.x, pos.y);

            var newW = Math.round((world.x - tile.x * s.tileSize) / s.tileSize);
            var newH = Math.round((world.y - tile.y * s.tileSize) / s.tileSize);
            newW = Math.max(1, Math.min(s.tileMaxSize, s.gridWidth - tile.x, newW));
            newH = Math.max(1, Math.min(s.tileMaxSize, s.gridHeight - tile.y, newH));

            if ((newW !== tile.w || newH !== tile.h) &&
                !App.isPositionOccupied(s, tile.x, tile.y, newW, newH, tile.id)) {
                tile.w = newW;
                tile.h = newH;
                this.events.emit('render');
            }
            return;
        }

        // Tile rotate (edit mode — drag the offset circle handle)
        if (this._isRotatingTile && this._rotateTile) {
            this._didDrag = true;
            this.canvas.style.cursor = 'grabbing';
            var rtile = this._rotateTile;
            var rpos = this._getMousePos(e);
            var rworld = this.renderer.screenToWorld(rpos.x, rpos.y);
            var center = this.renderer.getTileHandles(rtile).center;

            var angleDeg = Math.atan2(rworld.y - center.y, rworld.x - center.x) * 180 / Math.PI;
            // The rotate handle rests above the tile (world "up", atan2 = -90°);
            // treat that as orientation 0 and increase clockwise as the handle
            // is dragged clockwise, snapped to the four steps the field supports.
            var rotFromUp = ((angleDeg + 90) % 360 + 360) % 360;
            var snapped = Math.round(rotFromUp / 90) * 90 % 360;

            if (snapped !== (rtile.orientation || 0)) {
                rtile.orientation = snapped;
                this.events.emit('render');
            }
            return;
        }

        // Tile drag (edit mode)
        if (this._isDraggingTile && this._dragTile) {
            var dx = e.clientX - this._panStartX;
            var dy = e.clientY - this._panStartY;
            if (!this._didDrag && Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
            this._didDrag = true;
            this.canvas.style.cursor = 'move';

            // Calculate new grid position
            var cellDx = Math.round(dx / (s.tileSize * s.zoom));
            var cellDy = Math.round(dy / (s.tileSize * s.zoom));
            var newX = Math.max(0, Math.min(s.gridWidth - this._dragTile.w, this._dragOrigX + cellDx));
            var newY = Math.max(0, Math.min(s.gridHeight - this._dragTile.h, this._dragOrigY + cellDy));

            if ((this._dragTile.x !== newX || this._dragTile.y !== newY) &&
                !App.isPositionOccupied(s, newX, newY, this._dragTile.w, this._dragTile.h, this._dragTile.id)) {
                this._dragTile.x = newX;
                this._dragTile.y = newY;
                this.events.emit('render');
            }
            return;
        }

        // Pan
        if (!this._isPanning) return;
        var dx = e.clientX - this._panStartX;
        var dy = e.clientY - this._panStartY;

        if (!this._didDrag && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
        this._didDrag = true;
        this.canvas.style.cursor = 'grabbing';

        s.panX = this._panStartOffsetX + dx;
        s.panY = this._panStartOffsetY + dy;
        this.events.emit('render');
    };

    // ─── Mouse Up ─────────────────────────────────────────────────

    Interaction.prototype._onMouseUp = function(e) {
        var s = this.state;

        // Finish tile resize — PATCH the new size
        if (this._isResizingTile && this._resizeTile) {
            var rtile = this._resizeTile;
            var newW = rtile.w, newH = rtile.h;
            var origW = this._resizeOrigW, origH = this._resizeOrigH;
            this._isResizingTile = false;
            this._resizeTile = null;
            this.canvas.style.cursor = '';

            if (newW !== origW || newH !== origH) {
                var self = this;
                App.patchTileFields(s, this.events, rtile, { w: newW, h: newH })
                .then(function() {
                    self.events.emit('sidebar:rebuild');
                    App.pushFieldHistory(s, self.events, rtile, { w: newW, h: newH }, { w: origW, h: origH });
                }).catch(function(err) {
                    rtile.w = origW;
                    rtile.h = origH;
                    self.events.emit('render');
                    alert('Resize failed: ' + (err.detail ? JSON.stringify(err.detail) : err.message));
                });
            }
            return;
        }

        // Finish tile rotate — PATCH the new orientation
        if (this._isRotatingTile && this._rotateTile) {
            var otile = this._rotateTile;
            var newOrient = otile.orientation || 0;
            var origOrient = this._rotateOrigOrient;
            this._isRotatingTile = false;
            this._rotateTile = null;
            this.canvas.style.cursor = '';

            if (newOrient !== origOrient) {
                var oself = this;
                App.patchTileFields(s, this.events, otile, { orientation: newOrient })
                .then(function() {
                    App.pushFieldHistory(s, oself.events, otile, { orientation: newOrient }, { orientation: origOrient });
                }).catch(function(err) {
                    otile.orientation = origOrient;
                    oself.events.emit('render');
                    alert('Rotate failed: ' + (err.detail ? JSON.stringify(err.detail) : err.message));
                });
            }
            return;
        }

        // Finish tile drag — PATCH the new position
        if (this._isDraggingTile && this._dragTile && this._didDrag) {
            var tile = this._dragTile;
            var newX = tile.x;
            var newY = tile.y;
            var origX = this._dragOrigX;
            var origY = this._dragOrigY;
            this._isDraggingTile = false;
            this.canvas.style.cursor = '';

            // Only PATCH if position actually changed
            if (newX !== origX || newY !== origY) {
                var self = this;
                App.patchTileFields(s, this.events, tile, { x: newX, y: newY })
                .then(function() {
                    App.pushFieldHistory(s, self.events, tile, { x: newX, y: newY }, { x: origX, y: origY });
                }).catch(function(err) {
                    // Revert on failure
                    tile.x = origX;
                    tile.y = origY;
                    self.events.emit('render');
                    alert('Move failed: ' + (err.detail ? JSON.stringify(err.detail) : err.message));
                });
            }
            this._dragTile = null;
            return;
        }

        if (this._isDraggingTile) {
            this._isDraggingTile = false;
            this._dragTile = null;
        }

        if (this._isPanning) {
            this._isPanning = false;
            this.canvas.style.cursor = '';
        }
    };

    // ─── Click to Select ──────────────────────────────────────────

    Interaction.prototype._onClick = function(e) {
        if (this._didDrag) return; // was a drag/pan, not a click

        var s = this.state;
        var pos = this._getMousePos(e);
        var world = this.renderer.screenToWorld(pos.x, pos.y);
        var tile = this.renderer.findTileAt(world.x, world.y);

        // Navigate to linked floor plan when clicking a floorplan_link tile (view mode only)
        if (tile && tile.type === 'floorplan_link' && tile.linked_floorplan_url && !s.editMode) {
            window.location.href = tile.linked_floorplan_url;
            return;
        }

        if (tile) {
            s.selectTile(tile);
        } else {
            s.deselectTile();
        }
    };

    // ─── Canvas Hover ─────────────────────────────────────────────

    Interaction.prototype._onCanvasHover = function(e) {
        if (this._isPanning || this._isDraggingTile || this._isResizingTile || this._isRotatingTile) {
            this.events.emit('hover', { tile: null, x: 0, y: 0 });
            return;
        }

        var pos = this._getMousePos(e);
        var world = this.renderer.screenToWorld(pos.x, pos.y);

        var handle = this._handleAt(world.x, world.y);
        if (handle === 'resize') {
            this.canvas.style.cursor = 'nwse-resize';
            this.events.emit('hover', { tile: null, x: 0, y: 0 });
            return;
        }
        if (handle === 'rotate') {
            this.canvas.style.cursor = 'grab';
            this.events.emit('hover', { tile: null, x: 0, y: 0 });
            return;
        }

        var tile = this.renderer.findTileAt(world.x, world.y);

        this.canvas.style.cursor = tile ? 'pointer' : 'default';

        this.events.emit('hover', { tile: tile, x: pos.x, y: pos.y });
    };

    // ─── Zoom Buttons ─────────────────────────────────────────────

    Interaction.prototype._bindZoomButtons = function() {
        var self = this;
        var s = this.state;

        var zoomInBtn = document.getElementById('zoom-in-btn');
        var zoomOutBtn = document.getElementById('zoom-out-btn');
        var zoomResetBtn = document.getElementById('zoom-reset-btn');

        if (zoomInBtn) {
            zoomInBtn.addEventListener('click', function() {
                self._zoomAtCenter(1.3);
            });
        }
        if (zoomOutBtn) {
            zoomOutBtn.addEventListener('click', function() {
                self._zoomAtCenter(1 / 1.3);
            });
        }
        if (zoomResetBtn) {
            zoomResetBtn.addEventListener('click', function() {
                self.renderer.fitToView();
                self.events.emit('render');
            });
        }
    };

    /** Zoom by a factor centered on the canvas. */
    Interaction.prototype._zoomAtCenter = function(factor) {
        var s = this.state;
        var cw = parseFloat(this.canvas.style.width);
        var ch = parseFloat(this.canvas.style.height);
        var cx = cw / 2;
        var cy = ch / 2;

        var wx = (cx - s.panX) / s.zoom;
        var wy = (cy - s.panY) / s.zoom;

        s.zoom = Math.max(s.MIN_ZOOM, Math.min(s.MAX_ZOOM, s.zoom * factor));
        s.panX = cx - wx * s.zoom;
        s.panY = cy - wy * s.zoom;

        this.events.emit('render');
    };

    /** Programmatically zoom to center a specific tile. */
    Interaction.prototype.zoomToTile = function(tile) {
        var s = this.state;
        var ts = s.tileSize;
        var cw = parseFloat(this.canvas.style.width);
        var ch = parseFloat(this.canvas.style.height);

        // Center the tile
        var tileCx = (tile.x + tile.w / 2) * ts;
        var tileCy = (tile.y + tile.h / 2) * ts;

        // Set a reasonable zoom level
        s.zoom = Math.max(s.MIN_ZOOM, Math.min(s.MAX_ZOOM, 1.5));
        s.panX = cw / 2 - tileCx * s.zoom;
        s.panY = ch / 2 - tileCy * s.zoom;

        this.events.emit('render');
    };

    App.Interaction = Interaction;

})(window.FloorplanApp);
