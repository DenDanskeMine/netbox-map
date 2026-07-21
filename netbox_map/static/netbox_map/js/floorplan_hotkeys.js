/**
 * FloorPlan Hotkeys — Delete, undo/redo, copy/paste for the selected tile.
 * Loaded only when edit mode is active (?edit=true), after floorplan_editor.js
 * (needs App.deleteTile/createTileFromPayload/tileToCreatePayload from it).
 * Depends on: floorplan_core.js, floorplan_main.js (via window.floorplanViewer)
 */
(function(App) {
    'use strict';

    var viewer = window.floorplanViewer;
    if (!viewer || !viewer.state.editMode) return;

    var state = viewer.state;
    var events = viewer.events;

    // In-memory clipboard — a single copied tile's re-createable payload,
    // not the OS clipboard. Deliberately excludes assigned_object/
    // linked_floorplan: pasting a duplicate of a tile that represents a
    // specific device/rack shouldn't leave two tiles both claiming it —
    // paste always produces a fresh, unlinked tile of the same
    // type/size/label/status/orientation/FOV.
    var clipboard = null;

    function isTypingTarget(el) {
        if (!el) return false;
        var tag = el.tagName;
        return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
    }

    // ─── Paste placement ────────────────────────────────────────────

    /** Find the nearest free spot for a w×h tile, starting just past the copied tile's position. */
    function findPastePosition(originX, originY, w, h) {
        for (var offset = 1; offset <= 30; offset++) {
            var candidates = [
                [originX + offset, originY + offset],
                [originX + offset, originY],
                [originX, originY + offset]
            ];
            for (var i = 0; i < candidates.length; i++) {
                var x = candidates[i][0], y = candidates[i][1];
                if (x + w > state.gridWidth || y + h > state.gridHeight) continue;
                if (!App.isPositionOccupied(state, x, y, w, h)) return { x: x, y: y };
            }
        }
        return null;
    }

    // ─── Actions ────────────────────────────────────────────────────

    function doDelete() {
        var tile = state.selectedTile;
        if (!tile) return;
        // No confirm() here — Ctrl+Z immediately undoes it, unlike the
        // sidebar's delete button which has no undo path of its own.
        App.deleteTile(tile.id, { confirm: false });
    }

    function doCopy() {
        var tile = state.selectedTile;
        if (!tile) return;
        var payload = App.tileToCreatePayload(tile);
        delete payload.assigned_object_type;
        delete payload.assigned_object_id;
        delete payload.linked_floorplan;
        clipboard = { payload: payload, w: tile.w, h: tile.h, x: tile.x, y: tile.y };
    }

    function doPaste() {
        if (!clipboard) return;
        var pos = findPastePosition(clipboard.x, clipboard.y, clipboard.w, clipboard.h);
        if (!pos) {
            alert('No free space near the copied tile to paste into.');
            return;
        }
        var payload = Object.assign({}, clipboard.payload, {
            x_position: pos.x,
            y_position: pos.y
        });
        App.createTileFromPayload(payload).then(function(clientTile) {
            App.pushCreateHistory(state, { id: clientTile.id }, payload);
            state.selectTile(clientTile);
        }).catch(function(err) {
            alert('Paste failed: ' + (err.detail ? JSON.stringify(err.detail) : err.message));
        });
    }

    // ─── Key Binding ────────────────────────────────────────────────

    document.addEventListener('keydown', function(e) {
        if (isTypingTarget(document.activeElement)) return;

        var mod = e.ctrlKey || e.metaKey;

        if ((e.key === 'Delete' || e.key === 'Del') && !mod) {
            e.preventDefault();
            doDelete();
            return;
        }

        if (mod && (e.key === 'z' || e.key === 'Z')) {
            e.preventDefault();
            if (e.shiftKey) {
                state.history.redo();
            } else {
                state.history.undo();
            }
            return;
        }

        // Ctrl/Cmd+Y as a common alternate redo binding.
        if (mod && (e.key === 'y' || e.key === 'Y')) {
            e.preventDefault();
            state.history.redo();
            return;
        }

        if (mod && (e.key === 'c' || e.key === 'C')) {
            if (!state.selectedTile) return;
            e.preventDefault();
            doCopy();
            return;
        }

        if (mod && (e.key === 'v' || e.key === 'V')) {
            if (!clipboard) return;
            e.preventDefault();
            doPaste();
            return;
        }
    });

})(window.FloorplanApp);
