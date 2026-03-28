/* NetBox Map — Topology Main Entry Point */
/* Wires together all topology modules */

(function(App) {
    'use strict';

    var container = document.getElementById('topology-container');
    if (!container) return;

    var config = App.parseConfig(container);
    var events = new App.EventBus();
    var state = new App.State(config);
    var api = new App.API(state);

    var renderer = new App.Renderer(state, events);
    renderer.init();

    var sidebar = new App.Sidebar(state, events);
    var detail = new App.Detail(state, events);

    var loadingEl = document.getElementById('topology-loading');
    var emptyEl = document.getElementById('topology-empty');

    // Apply saved layout (positions, hidden nodes, port overrides)
    function applySavedLayout() {
        var layout = state.savedLayout;
        if (!layout || typeof layout !== 'object') return;

        for (var nodeId in layout) {
            var data = layout[nodeId];
            if (data.hidden) state.hiddenNodes.add(nodeId);
            if (data.port_overrides) {
                for (var portId in data.port_overrides) {
                    state.portOverrides[portId] = data.port_overrides[portId];
                }
            }
        }
    }

    // Collect current layout for saving
    function collectLayout() {
        var layout = {};
        state.nodes.forEach(function(n) {
            var entry = { x: n.x || 0, y: n.y || 0 };
            if (state.hiddenNodes.has(n.id)) entry.hidden = true;

            // Collect port overrides for this device
            var portOverrides = {};
            (n.ports || []).forEach(function(p) {
                if (state.portOverrides[p.id]) {
                    portOverrides[p.id] = state.portOverrides[p.id];
                }
            });
            if (Object.keys(portOverrides).length > 0) entry.port_overrides = portOverrides;

            layout[n.id] = entry;
        });
        return layout;
    }

    // Wire renderer highlight from sidebar clicks
    events.on('renderer:highlight', function(nodeId) {
        renderer.highlightNode(nodeId);
    });

    // Wire filter visibility
    events.on('filter:applied', function(visibleIds) {
        renderer.filterNodes(visibleIds);
    });

    // Wire hide/show from sidebar
    events.on('node:hidden', function() {
        renderer.applyHiddenNodes(state.hiddenNodes);
    });

    // Load topology data
    function loadTopology() {
        var hasFilters = Object.keys(state.initialFilters).length > 0;

        if (!hasFilters) {
            if (loadingEl) loadingEl.classList.add('d-none');
            if (emptyEl) emptyEl.classList.remove('d-none');
            return;
        }

        if (loadingEl) loadingEl.classList.remove('d-none');
        if (emptyEl) emptyEl.classList.add('d-none');

        var params = new URLSearchParams(state.initialFilters);
        var url = state.topologyUrl + '?' + params.toString();

        api.get(url).then(function(data) {
            if (loadingEl) loadingEl.classList.add('d-none');

            state.nodes = data.nodes;
            state.edges = data.edges;

            if (data.nodes.length === 0) {
                if (emptyEl) {
                    emptyEl.classList.remove('d-none');
                    emptyEl.querySelector('p').textContent = 'No devices found for the selected filters.';
                }
                return;
            }

            // Apply saved layout before rendering
            applySavedLayout();

            renderer.render(data.nodes, data.edges);
            events.emit('data:loaded', data);

            // Apply hidden nodes after render
            if (state.hiddenNodes.size > 0) {
                renderer.applyHiddenNodes(state.hiddenNodes);
            }

            var statNodes = document.getElementById('stat-nodes');
            var statEdges = document.getElementById('stat-edges');
            if (statNodes) statNodes.textContent = data.stats.node_count;
            if (statEdges) statEdges.textContent = data.stats.edge_count;

        }).catch(function(err) {
            if (loadingEl) loadingEl.classList.add('d-none');
            if (emptyEl) {
                emptyEl.classList.remove('d-none');
                emptyEl.querySelector('p').textContent = 'Error loading topology data.';
            }
            console.error('Topology load error:', err);
        });
    }

    loadTopology();

    // Zoom controls
    var zoomIn = document.getElementById('topo-zoom-in');
    var zoomOut = document.getElementById('topo-zoom-out');
    var zoomFit = document.getElementById('topo-zoom-fit');
    if (zoomIn) zoomIn.addEventListener('click', function() { renderer.zoomIn(); });
    if (zoomOut) zoomOut.addEventListener('click', function() { renderer.zoomOut(); });
    if (zoomFit) zoomFit.addEventListener('click', function() { renderer.fitToView(); });

    // View mode toggle
    var viewStencil = document.getElementById('view-stencil');
    var viewNode = document.getElementById('view-node');
    if (viewStencil) viewStencil.addEventListener('click', function() {
        viewStencil.classList.add('active'); if (viewNode) viewNode.classList.remove('active');
        renderer.switchView('stencil');
    });
    if (viewNode) viewNode.addEventListener('click', function() {
        if (viewStencil) viewStencil.classList.remove('active'); viewNode.classList.add('active');
        renderer.switchView('node');
    });

    // Layout toggle
    var layoutForce = document.getElementById('layout-force');
    var layoutTree = document.getElementById('layout-tree');
    if (layoutForce) layoutForce.addEventListener('click', function() {
        layoutForce.classList.add('active'); if (layoutTree) layoutTree.classList.remove('active');
        renderer.switchLayout('force');
    });
    if (layoutTree) layoutTree.addEventListener('click', function() {
        if (layoutForce) layoutForce.classList.remove('active'); layoutTree.classList.add('active');
        renderer.switchLayout('tree');
    });

    // === Save Layout ===
    function saveLayout(viewId, name) {
        var payload = {
            layout_data: collectLayout(),
            filters: state.initialFilters,
            view_mode: state.viewMode,
        };
        if (viewId) payload.view_id = viewId;
        if (name) payload.name = name;

        api.post(state.saveUrl, payload).then(function(resp) {
            if (resp.saved) {
                // Show brief success feedback
                showToast('View "' + resp.name + '" saved');
                // Update URL to include view_id if new
                if (!viewId && resp.id) {
                    var url = new URL(window.location);
                    url.searchParams.set('view_id', resp.id);
                    window.history.replaceState(null, '', url.toString());
                }
            }
        }).catch(function(err) {
            showToast('Error saving view', true);
            console.error('Save error:', err);
        });
    }

    // Save button (update existing)
    var saveBtn = document.getElementById('topo-save');
    if (saveBtn) {
        saveBtn.addEventListener('click', function() {
            saveLayout(state.savedViewId);
        });
    }

    // Save As button — use simple prompt (avoids Bootstrap modal dependency)
    var saveAsBtn = document.getElementById('topo-save-as');
    if (saveAsBtn) {
        saveAsBtn.addEventListener('click', function() {
            var name = prompt('Enter a name for this topology view:');
            if (name && name.trim()) {
                saveLayout(null, name.trim());
            }
        });
    }

    // Simple toast notification
    function showToast(msg, isError) {
        var el = document.createElement('div');
        el.className = 'topo-toast' + (isError ? ' error' : '');
        el.textContent = msg;
        document.body.appendChild(el);
        setTimeout(function() { el.classList.add('visible'); }, 10);
        setTimeout(function() { el.classList.remove('visible'); setTimeout(function() { el.remove(); }, 300); }, 2000);
    }

    // Cable style toggle (curve / orthogonal)
    var cableCurve = document.getElementById('cable-curve');
    var cableOrtho = document.getElementById('cable-ortho');
    if (cableCurve) cableCurve.addEventListener('click', function() {
        cableCurve.classList.add('active'); if (cableOrtho) cableOrtho.classList.remove('active');
        renderer.switchCableStyle('curve');
    });
    if (cableOrtho) cableOrtho.addEventListener('click', function() {
        if (cableCurve) cableCurve.classList.remove('active'); cableOrtho.classList.add('active');
        renderer.switchCableStyle('ortho');
    });

    // Cable labels toggle
    var toggleLabels = document.getElementById('topo-toggle-labels');
    if (toggleLabels) {
        toggleLabels.addEventListener('click', function() {
            this.classList.toggle('active');
            var edgeLayer = document.querySelector('.edge-layer');
            if (edgeLayer) edgeLayer.classList.toggle('show-cable-labels');
        });
    }

    // Handle "go to device" clicks from interface detail
    document.addEventListener('click', function(e) {
        var link = e.target.closest('[data-goto-device]');
        if (link) {
            e.preventDefault();
            var deviceId = parseInt(link.getAttribute('data-goto-device'));
            var nodeId = 'device-' + deviceId;
            var node = state.nodes.find(function(n) { return n.id === nodeId; });
            if (node) {
                state.selectedNode = node;
                events.emit('node:select', node);
                renderer.highlightNode(nodeId);
            }
        }
    });

    // Window resize
    var resizeTimer;
    window.addEventListener('resize', function() {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(function() { renderer.resize(); }, 200);
    });

})(TopologyApp);
