/**
 * FloorplanApp Main — Entry point: reads data attributes, creates instances, wires events.
 * Must be loaded after all other floorplan_*.js modules (except floorplan_editor.js).
 */
(function(App) {
    'use strict';

    var container = document.getElementById('floorplan-container');
    if (!container) return;

    var canvas = document.getElementById('floorplan-canvas');
    if (!canvas) return;

    // ─── Parse Configuration ──────────────────────────────────────

    var config = App.parseConfig(container);
    var tiles = App.parseTiles(container);

    // ─── Create Shared EventBus and State ─────────────────────────

    var events = new App.EventBus();
    var state = new App.State(config, tiles, events);

    // ─── Initialize Modules ───────────────────────────────────────

    var renderer = new App.Renderer(state, events);
    renderer.init(container, canvas);

    var interaction = new App.Interaction(state, events, renderer);
    var sidebar = new App.Sidebar(state, events, interaction);
    var detail = new App.Detail(state, events, interaction);
    var popover = new App.Popover(state, events);
    var panels = new App.Panels(state, events);
    var pdf = new App.PDF(state, events, renderer);

    // Initialize sidebar divider
    sidebar.initDivider();

    // ─── Window Resize Handling ───────────────────────────────────

    var resizeTimer;
    window.addEventListener('resize', function() {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(function() {
            renderer.resize();
            renderer.fitToView();
            events.emit('render');
        }, 100);
    });

    // ─── Focus Tile from URL ──────────────────────────────────────

    function focusTileFromURL() {
        var params = new URLSearchParams(window.location.search);
        var tileId = parseInt(params.get('tile'));
        if (!isNaN(tileId)) {
            var tile = state.findTileById(tileId);
            if (tile) {
                state.selectTile(tile);
                interaction.zoomToTile(tile);
                // Hide the placeholder directly
                var placeholder = document.getElementById('sidebar-no-selection');
                if (placeholder) placeholder.style.display = 'none';
            }
        }
    }

    // ─── Start ────────────────────────────────────────────────────

    renderer.loadBackgroundImage(function() {
        renderer.fitToView();
        renderer.render();
        sidebar.build();
        focusTileFromURL();
    });

    // ─── Export for Editor Module ─────────────────────────────────
    // The editor module needs access to state and the API.
    window.floorplanViewer = {
        state: state,
        events: events,
        renderer: renderer,
        interaction: interaction,
        tiles: state.tiles,
        render: function() { events.emit('render'); },
        buildSidebar: function() { sidebar.build(); },
        tileSize: state.tileSize,
        canvas: canvas,
        gridWidth: state.gridWidth,
        gridHeight: state.gridHeight,
        getSelectedTile: function() { return state.selectedTile; },
        selectTile: function(tile) { state.selectTile(tile); },
        deselectTile: function() { state.deselectTile(); },
        findTileAt: function(wx, wy) { return renderer.findTileAt(wx, wy); },
        screenToWorld: function(sx, sy) { return renderer.screenToWorld(sx, sy); },
    };

})(window.FloorplanApp);
