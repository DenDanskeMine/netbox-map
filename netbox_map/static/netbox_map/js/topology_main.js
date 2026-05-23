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

    var appRenderer = App.AppRenderer ? new App.AppRenderer(state, events, renderer) : null;

    // Expose events for inline handlers
    App._events = events;

    var sidebar = new App.Sidebar(state, events);
    var detail = new App.Detail(state, events);

    // PDF export (loaded after this script)
    setTimeout(function() {
        if (window.TopologyPDF) new window.TopologyPDF(state, renderer);
    }, 100);

    var loadingEl = document.getElementById('topology-loading');
    var emptyEl = document.getElementById('topology-empty');
    var sidebarEl = document.getElementById('topology-sidebar');

    // Hide sidebar when no data
    if (sidebarEl) sidebarEl.classList.add('hidden');

    // Apply saved layout (positions, hidden nodes, port overrides)
    function applySavedLayout() {
        var layout = state.savedLayout;
        if (!layout || typeof layout !== 'object') return;

        // Restore custom hierarchy if saved
        if (layout._hierarchy) {
            state.customHierarchy = layout._hierarchy;
        }

        // Restore topology mode if saved
        if (layout._topology_mode) {
            state.topologyMode = layout._topology_mode;
        }

        // #61 — restore "Hide unconnected ports" toggle
        if (layout._hide_unconnected_ports) {
            state.hideUnconnectedPorts = true;
            // Mark the button visually once the DOM is ready
            var setBtn = function() {
                var btn = document.getElementById('topo-hide-unconnected-ports');
                if (btn) btn.classList.add('active');
            };
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', setBtn);
            } else {
                setBtn();
            }
        }

        // Merge mode-specific positions into the top level
        var modeKey = '_pos_' + state.topologyMode;
        if (layout[modeKey] && typeof layout[modeKey] === 'object') {
            Object.keys(layout[modeKey]).forEach(function(nodeId) {
                layout[nodeId] = Object.assign(layout[nodeId] || {}, layout[modeKey][nodeId]);
            });
        }

        for (var nodeId in layout) {
            if (nodeId.charAt(0) === '_') continue;  // skip metadata keys
            var data = layout[nodeId];
            if (!data || typeof data !== 'object') continue;
            if (data.hidden) state.hiddenNodes.add(nodeId);
            if (data.pinned) {
                state._pinnedNodes = state._pinnedNodes || new Set();
                state._pinnedNodes.add(nodeId);
            }
            if (data.port_overrides) {
                for (var portId in data.port_overrides) {
                    state.portOverrides[portId] = data.port_overrides[portId];
                }
            }
        }
    }

    // Collect current layout for saving — reads positions from renderer's actual data
    function collectLayout() {
        var layout = {};

        // Preserve ALL existing saved data (positions for other modes, metadata)
        var existing = state.savedLayout || {};
        Object.keys(existing).forEach(function(key) {
            layout[key] = typeof existing[key] === 'object' && existing[key] !== null
                ? Object.assign({}, existing[key]) : existing[key];
        });

        // Save current mode's positions under a mode-specific key
        var modeKey = '_pos_' + state.topologyMode;
        var modePositions = {};

        var renderedNodes;
        if (state.topologyMode === 'mixed') {
            // Mixed mode: combine device positions (from network renderer) + app positions
            renderedNodes = (renderer._stencilNodeData || []).concat(appRenderer && appRenderer._nodes ? appRenderer._nodes : []);
        } else if (state.topologyMode !== 'network' && appRenderer && appRenderer._nodes) {
            renderedNodes = appRenderer._nodes;
        } else {
            renderedNodes = renderer._stencilNodeData || state.nodes;
        }

        renderedNodes.forEach(function(n) {
            var entry = { x: n.x || 0, y: n.y || 0 };
            if (state.hiddenNodes.has(n.id)) entry.hidden = true;
            if (n._pinned) entry.pinned = true;

            var portOverrides = {};
            (n.ports || []).forEach(function(p) {
                if (state.portOverrides[p.id]) {
                    portOverrides[p.id] = state.portOverrides[p.id];
                }
            });
            if (Object.keys(portOverrides).length > 0) entry.port_overrides = portOverrides;

            modePositions[n.id] = entry;

            // Also save at top level for backward compat
            layout[n.id] = entry;
        });

        layout[modeKey] = modePositions;
        if (state.topologyMode !== 'network') {
            layout._topology_mode = state.topologyMode;
        }
        // #61 — persist "Hide unconnected ports" toggle in saved views
        if (state.hideUnconnectedPorts) {
            layout._hide_unconnected_ports = true;
        }
        return layout;
    }

    // Get current positions from renderer for preserving across re-renders
    function getCurrentPositions() {
        var positions = {};
        var renderedNodes = (appRenderer && appRenderer._nodes) || renderer._stencilNodeData || [];
        renderedNodes.forEach(function(n) {
            if (n.x !== undefined) positions[n.id] = { x: n.x, y: n.y };
        });
        return positions;
    }

    // Wire renderer focus from sidebar clicks — pan + zoom to node
    events.on('renderer:highlight', function(nodeId) {
        if (state.topologyMode !== 'network' && appRenderer) {
            appRenderer.focusNode(nodeId);
        } else {
            renderer.focusNode(nodeId);
        }
    });

    // Wire filter visibility
    events.on('filter:applied', function(visibleIds) {
        renderer.filterNodes(visibleIds);
    });

    // Wire hide/show from sidebar
    events.on('node:hidden', function() {
        renderer.applyHiddenNodes(state.hiddenNodes);
    });

    // Wire simulate failure from detail panel
    events.on('app:simulate', function(nodeId) {
        if (appRenderer) appRenderer.simulateFailure(nodeId);
    });

    // ── Alert overlay for down/degraded services ──
    var alertsEl = document.getElementById('topo-alerts');
    events.on('data:loaded', function(data) {
        if (!alertsEl) return;
        var nodes = data.nodes || [];
        var down = [], degraded = [];
        nodes.forEach(function(n) {
            if (n.node_type !== 'application') return;
            var hs = n.host_status || 'healthy';
            if (hs === 'down') down.push(n);
            else if (hs === 'degraded') degraded.push(n);
        });

        if (down.length === 0 && degraded.length === 0) {
            alertsEl.classList.add('d-none');
            alertsEl.innerHTML = '';
            return;
        }

        var html = '<div class="topo-alert-bar">';
        html += '<div class="topo-alert-summary">';
        if (down.length > 0) {
            html += '<span class="topo-alert-count alert-down">' + down.length + ' down</span>';
        }
        if (degraded.length > 0) {
            html += '<span class="topo-alert-count alert-degraded">' + degraded.length + ' degraded</span>';
        }
        html += '<button class="topo-alert-toggle" id="topo-alert-toggle">'
            + '<i class="mdi mdi-chevron-down"></i></button>';
        html += '<button class="topo-alert-dismiss" id="topo-alert-dismiss">'
            + '<i class="mdi mdi-close"></i></button>';
        html += '</div>';

        // Expandable list
        html += '<div class="topo-alert-list d-none" id="topo-alert-list">';
        down.forEach(function(n) {
            var reasons = (n.host_down_reasons || []).join(', ');
            html += '<div class="topo-alert-item alert-down" data-node-id="' + App.escapeHtml(n.id) + '">'
                + '<span class="topo-alert-dot" style="background:#e74c3c;"></span>'
                + '<span class="topo-alert-name">' + App.escapeHtml(n.name) + '</span>'
                + '<span class="topo-alert-reason">' + App.escapeHtml(reasons) + '</span>'
                + '</div>';
        });
        degraded.forEach(function(n) {
            var reasons = (n.host_down_reasons || []).join(', ');
            html += '<div class="topo-alert-item alert-degraded" data-node-id="' + App.escapeHtml(n.id) + '">'
                + '<span class="topo-alert-dot" style="background:#e67e22;"></span>'
                + '<span class="topo-alert-name">' + App.escapeHtml(n.name) + '</span>'
                + '<span class="topo-alert-reason">' + App.escapeHtml(reasons) + '</span>'
                + '</div>';
        });
        html += '</div></div>';

        alertsEl.innerHTML = html;
        alertsEl.classList.remove('d-none');

        // Toggle expand/collapse
        var toggleBtn = document.getElementById('topo-alert-toggle');
        var listEl = document.getElementById('topo-alert-list');
        if (toggleBtn && listEl) {
            toggleBtn.addEventListener('click', function() {
                var hidden = listEl.classList.toggle('d-none');
                toggleBtn.querySelector('i').className = 'mdi mdi-chevron-' + (hidden ? 'down' : 'up');
            });
        }

        // Dismiss button
        var dismissBtn = document.getElementById('topo-alert-dismiss');
        if (dismissBtn) {
            dismissBtn.addEventListener('click', function() {
                alertsEl.classList.add('d-none');
                alertsEl.innerHTML = '';
            });
        }

        // Click item → focus on map
        alertsEl.querySelectorAll('.topo-alert-item').forEach(function(el) {
            el.addEventListener('click', function() {
                var nodeId = this.getAttribute('data-node-id');
                events.emit('renderer:highlight', nodeId);
            });
        });
    });

    // Load topology data
    function loadTopology() {
        var hasFilters = Object.keys(state.initialFilters).length > 0;

        if (!hasFilters) {
            // No filters — show empty state but don't block (picker can still add devices)
            if (loadingEl) loadingEl.classList.add('d-none');
            if (emptyEl) emptyEl.classList.remove('d-none');
            return;
        }

        if (loadingEl) loadingEl.classList.remove('d-none');
        if (emptyEl) emptyEl.classList.add('d-none');

        // Build URL params — handle arrays (e.g. role_id=[1,2] → role_id=1&role_id=2)
        var params = new URLSearchParams();
        Object.keys(state.initialFilters).forEach(function(key) {
            var val = state.initialFilters[key];
            if (Array.isArray(val)) {
                val.forEach(function(v) { params.append(key, v); });
            } else {
                params.append(key, val);
            }
        });
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

            // Restore pinned state
            if (state._pinnedNodes) {
                state.nodes.forEach(function(n) {
                    if (state._pinnedNodes.has(n.id)) n._pinned = true;
                });
                delete state._pinnedNodes;
            }

            // Show sidebar now that we have data
            if (sidebarEl) sidebarEl.classList.remove('hidden');

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

    // Initial load is deferred until after mode toggle declarations (see below)

    // Zoom controls
    var zoomIn = document.getElementById('topo-zoom-in');
    var zoomOut = document.getElementById('topo-zoom-out');
    var zoomFit = document.getElementById('topo-zoom-fit');
    if (zoomIn) zoomIn.addEventListener('click', function() { renderer.zoomIn(); });
    if (zoomOut) zoomOut.addEventListener('click', function() { renderer.zoomOut(); });
    if (zoomFit) zoomFit.addEventListener('click', function() { renderer.fitToView(); });

    // Topology mode toggle (network / apps / mixed)
    var modeNetwork = document.getElementById('mode-network');
    var modeApps = document.getElementById('mode-apps');
    var modeMixed = document.getElementById('mode-mixed');

    function setModeActive(btn) {
        [modeNetwork, modeApps, modeMixed].forEach(function(b) { if (b) b.classList.remove('active'); });
        if (btn) btn.classList.add('active');
    }

    // Set up mode-specific UI (toolbar, legend, stats labels)
    function applyModeUI(mode) {
        setModeActive(mode === 'apps' ? modeApps : mode === 'mixed' ? modeMixed : modeNetwork);

        // Switch footer legend — mixed mode shows both
        var legendNetwork = document.getElementById('legend-network');
        var legendApps = document.getElementById('legend-apps');
        if (legendNetwork) legendNetwork.classList.toggle('d-none', mode === 'apps');
        if (legendApps) legendApps.classList.toggle('d-none', mode === 'network');

        // Update toolbar visibility for network-only controls
        // Hide network-only controls in apps mode; show in network + mixed
        var networkOnlyBtns = ['topo-add-devices', 'topo-edit-hierarchy', 'topo-auto-sort',
            'topo-collapse-pp', 'topo-toggle-labels', 'view-stencil', 'view-node'];
        networkOnlyBtns.forEach(function(id) {
            var el = document.getElementById(id);
            if (el) el.style.display = (mode === 'apps') ? 'none' : '';
        });
        // Cable color toggles: visible in network + mixed, hidden in apps-only
        ['cable-color-physical', 'cable-color-speed'].forEach(function(id) {
            var el = document.getElementById(id);
            if (el) el.style.display = (mode === 'apps') ? 'none' : '';
        });

        // Update stats labels
        var statNodes = document.getElementById('stat-nodes');
        var statEdges = document.getElementById('stat-edges');
        if (statNodes && statNodes.nextSibling) {
            var nodesLabel = statNodes.parentNode;
            if (nodesLabel) {
                var walker = document.createTreeWalker(nodesLabel, NodeFilter.SHOW_TEXT);
                var textNode;
                while (textNode = walker.nextNode()) {
                    if (textNode.textContent.indexOf('devices') !== -1) {
                        textNode.textContent = mode === 'apps' ? ' apps' : ' devices';
                    }
                    if (textNode.textContent.indexOf('cables') !== -1 || textNode.textContent.indexOf('deps') !== -1) {
                        textNode.textContent = mode === 'apps' ? ' deps' : ' cables';
                    }
                }
            }
        }
    }

    function switchToMode(mode) {
        state.topologyMode = mode;
        applyModeUI(mode);

        // Clear state and reload (user-triggered mode switch — discard old positions)
        state.nodes = [];
        state.edges = [];
        state.savedLayout = {};
        state.hiddenNodes.clear();
        state.selectedNode = null;
        events.emit('node:deselect');

        if (mode === 'mixed') {
            loadMixedTopology();
        } else if (mode === 'apps') {
            loadAppTopology();
        } else {
            loadTopology();
        }
        if (typeof updateURL === 'function') updateURL();
    }

    if (modeNetwork) modeNetwork.addEventListener('click', function() { switchToMode('network'); });
    if (modeApps) modeApps.addEventListener('click', function() { switchToMode('apps'); });
    if (modeMixed) modeMixed.addEventListener('click', function() { switchToMode('mixed'); });

    // ── URL param reading — takes priority over saved layout ──
    var urlMode = container.getAttribute('data-topology-mode');
    if (!urlMode) {
        var urlParams = new URLSearchParams(window.location.search);
        urlMode = urlParams.get('mode') || '';
    }

    // Initial load — URL mode > saved layout mode > default
    if (urlMode === 'apps' || urlMode === 'mixed') {
        state.topologyMode = urlMode;
    } else if (state.savedLayout && state.savedLayout._topology_mode) {
        state.topologyMode = state.savedLayout._topology_mode;
    }

    if (state.topologyMode === 'apps' || state.topologyMode === 'mixed') {
        // Initial load — set up UI but DON'T clear savedLayout (switchToMode wipes it)
        applyModeUI(state.topologyMode);
        if (state.topologyMode === 'mixed') {
            loadMixedTopology();
        } else {
            loadAppTopology();
        }
    } else {
        loadTopology();
    }

    // ── Shareable URL update ──
    function updateURL() {
        var url = new URL(window.location);
        url.searchParams.set('mode', state.topologyMode);
        if (state.savedViewId) url.searchParams.set('view_id', state.savedViewId);
        else url.searchParams.delete('view_id');
        window.history.replaceState(null, '', url.toString());
    }

    function loadAppTopology() {
        if (loadingEl) loadingEl.classList.remove('d-none');
        if (emptyEl) emptyEl.classList.add('d-none');

        var params = new URLSearchParams();
        Object.keys(state.initialFilters).forEach(function(key) {
            var val = state.initialFilters[key];
            if (Array.isArray(val)) {
                val.forEach(function(v) { params.append(key, v); });
            } else {
                params.append(key, val);
            }
        });

        // If we have device nodes from a saved view, scope apps to those devices
        if (!params.has('app_ids') && !params.has('focus_app') && !params.has('device_ids')) {
            // Check saved layout for device IDs
            var layout = state.savedLayout;
            if (layout && typeof layout === 'object') {
                var deviceIds = [];
                Object.keys(layout).forEach(function(key) {
                    if (key.indexOf('device-') === 0) {
                        deviceIds.push(key.replace('device-', ''));
                    }
                });
                if (deviceIds.length > 0) {
                    params.set('device_ids', deviceIds.join(','));
                }
            }
            // Also check if we have loaded network nodes
            if (!params.has('device_ids') && state.nodes && state.nodes.length > 0) {
                var netDevIds = [];
                state.nodes.forEach(function(n) {
                    if (n.device_id) netDevIds.push(n.device_id);
                });
                if (netDevIds.length > 0) {
                    params.set('device_ids', netDevIds.join(','));
                }
            }
        }

        var url = state.appDataUrl + (params.toString() ? '?' + params.toString() : '');

        api.get(url).then(function(data) {
            if (loadingEl) loadingEl.classList.add('d-none');

            state.nodes = data.nodes;
            state.edges = data.edges;

            if (data.nodes.length === 0) {
                if (emptyEl) {
                    emptyEl.classList.remove('d-none');
                    emptyEl.querySelector('p').textContent = 'No applications found. Create applications and dependencies to see the topology.';
                }
                if (sidebarEl) sidebarEl.classList.add('hidden');
                return;
            }

            // Apply saved layout before rendering
            applySavedLayout();

            if (appRenderer) {
                appRenderer.render(data.nodes, data.edges);
            } else {
                renderer.render(data.nodes, data.edges);
            }
            events.emit('data:loaded', data);

            if (sidebarEl) sidebarEl.classList.remove('hidden');

            // Auto-focus on the target app if focus_app or app_ids param was used
            var focusId = state.initialFilters.focus_app || state.initialFilters.app_ids;
            if (focusId && appRenderer) {
                var targetId = 'app-' + String(focusId).split(',')[0];
                setTimeout(function() { appRenderer.focusNode(targetId); }, 300);
            }

            var statNodes = document.getElementById('stat-nodes');
            var statEdges = document.getElementById('stat-edges');
            if (statNodes) statNodes.textContent = data.stats.node_count;
            if (statEdges) statEdges.textContent = data.stats.edge_count;

        }).catch(function(err) {
            if (loadingEl) loadingEl.classList.add('d-none');
            if (emptyEl) {
                emptyEl.classList.remove('d-none');
                emptyEl.querySelector('p').textContent = 'Error loading application topology data.';
            }
            console.error('App topology load error:', err);
        });
    }

    // ── Mixed topology: fetch BOTH network + app data, merge, render ──
    function loadMixedTopology() {
        if (loadingEl) loadingEl.classList.remove('d-none');
        if (emptyEl) emptyEl.classList.add('d-none');

        // Build params for both endpoints
        var netParams = new URLSearchParams();
        var appParams = new URLSearchParams();
        Object.keys(state.initialFilters).forEach(function(key) {
            var val = state.initialFilters[key];
            if (key === 'focus_app' || key === 'app_ids') {
                appParams.set(key, val);
            } else if (key === 'device_ids') {
                // Network needs device_ids; app endpoint gets site_id instead
                netParams.set(key, val);
            } else {
                if (Array.isArray(val)) val.forEach(function(v) { netParams.append(key, v); });
                else netParams.set(key, val);
                // Pass site_id to app endpoint for full dependency data
                if (key === 'site_id') {
                    if (Array.isArray(val)) val.forEach(function(v) { appParams.append('site_id', v); });
                    else appParams.set('site_id', val);
                }
            }
        });

        // If no site_id for app endpoint, try to get it from saved view filters
        if (!appParams.has('site_id') && !appParams.has('app_ids') && !appParams.has('focus_app')) {
            // Fall back to device_ids for app scoping only if no site available
            var devIdsVal = state.initialFilters.device_ids;
            if (devIdsVal) appParams.set('device_ids', devIdsVal);
        }

        var netUrl = state.topologyUrl + (netParams.toString() ? '?' + netParams.toString() : '');
        var appUrl = state.appDataUrl + (appParams.toString() ? '?' + appParams.toString() : '');

        // Fetch both in parallel
        Promise.all([api.get(netUrl), api.get(appUrl)]).then(function(results) {
            if (loadingEl) loadingEl.classList.add('d-none');

            var netData = results[0];
            var appData = results[1];

            // Merge: combine nodes + edges, avoid duplicate device nodes
            var mergedNodes = [];
            var seenIds = new Set();

            // Network nodes first (full device cards with interfaces)
            (netData.nodes || []).forEach(function(n) {
                seenIds.add(n.id);
                n._source = 'network';
                mergedNodes.push(n);
            });

            // App nodes (skip devices already from network data)
            (appData.nodes || []).forEach(function(n) {
                if (!seenIds.has(n.id)) {
                    n._source = 'app';
                    mergedNodes.push(n);
                }
            });

            // Merge edges
            var mergedEdges = [];
            var seenEdges = new Set();
            (netData.edges || []).forEach(function(e) {
                seenEdges.add(e.id);
                mergedEdges.push(e);
            });
            (appData.edges || []).forEach(function(e) {
                if (!seenEdges.has(e.id)) mergedEdges.push(e);
            });

            state.nodes = mergedNodes;
            state.edges = mergedEdges;

            if (mergedNodes.length === 0) {
                if (emptyEl) {
                    emptyEl.classList.remove('d-none');
                    emptyEl.querySelector('p').textContent = 'No data found for mixed view.';
                }
                if (sidebarEl) sidebarEl.classList.add('hidden');
                return;
            }

            applySavedLayout();

            // Step 1: Render network devices + cables using the NETWORK renderer
            // Force stencil mode for mixed view (full cards with interface ports)
            state.viewMode = 'stencil';
            var netNodes = mergedNodes.filter(function(n) { return n.node_type !== 'application'; });
            var netEdges = mergedEdges.filter(function(e) { return e.edge_type !== 'dependency' && e.edge_type !== 'deployed_on'; });
            renderer.render(netNodes, netEdges);

            // Step 2: Overlay app cards + dependency/deployed-on edges
            // Use POSITIONED device nodes from the network renderer (not the originals)
            var positionedDevices = renderer._stencilNodeData || netNodes;
            var appNodes = mergedNodes.filter(function(n) { return n.node_type === 'application'; });
            var appEdges = mergedEdges.filter(function(e) { return e.edge_type === 'dependency' || e.edge_type === 'deployed_on'; });

            if (appRenderer && appNodes.length > 0) {
                appRenderer.renderOverlay(appNodes, appEdges, positionedDevices);
            }

            // Merge element selections for shared features
            if (appRenderer && appRenderer._cards && renderer.nodeElements) {
                var allCards = d3.selectAll('.topo-stencil-node, .acard, .dcard');
                renderer.nodeElements = allCards;
            }

            events.emit('data:loaded', { nodes: mergedNodes, edges: mergedEdges });

            if (sidebarEl) sidebarEl.classList.remove('hidden');

            var statNodes = document.getElementById('stat-nodes');
            var statEdges = document.getElementById('stat-edges');
            if (statNodes) statNodes.textContent = mergedNodes.length;
            if (statEdges) statEdges.textContent = mergedEdges.length;

        }).catch(function(err) {
            if (loadingEl) loadingEl.classList.add('d-none');
            console.error('Mixed topology load error:', err);
        });
    }

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
        var layoutData = collectLayout();
        if (state.customHierarchy) layoutData._hierarchy = state.customHierarchy;

        // Always save the actual device IDs on canvas so view restores correctly
        var deviceIds = [];
        state.nodes.forEach(function(n) { if (n.device_id) deviceIds.push(n.device_id); });

        var filters = Object.assign({}, state.initialFilters);
        if (deviceIds.length > 0) {
            filters.device_ids = deviceIds.join(',');
        }
        filters.topology_mode = state.topologyMode;

        var payload = {
            layout_data: layoutData,
            filters: filters,
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
                    state.savedViewId = resp.id;
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

    // ===== Device Picker =====
    var pickerEl = document.getElementById('device-picker');
    var pickerBtn = document.getElementById('topo-add-devices');
    var pickerClose = document.getElementById('picker-close');
    var pickerSearch = document.getElementById('picker-search');
    var pickerSite = document.getElementById('picker-site');
    var pickerRole = document.getElementById('picker-role');
    var pickerResults = document.getElementById('picker-results');
    var pickerCount = document.getElementById('picker-count');
    var pickerDone = document.getElementById('picker-done');
    var pickerCache = {};  // cache filter dropdown data
    state.addedDeviceIds = new Set();

    // Track which device IDs are currently on canvas
    function getCanvasDeviceIds() {
        var ids = new Set();
        state.nodes.forEach(function(n) { ids.add(n.device_id); });
        return ids;
    }

    function openPicker() {
        if (!pickerEl) return;
        pickerEl.classList.remove('d-none');
        if (pickerSearch) { pickerSearch.value = ''; pickerSearch.focus(); }
        // Populate filter dropdowns (once)
        if (!pickerCache.sites) {
            api.get('/api/dcim/sites/?brief=true&limit=1000').then(function(data) {
                pickerCache.sites = data.results || data || [];
                if (pickerSite) {
                    var html = '<option value="">All Sites</option>';
                    pickerCache.sites.forEach(function(s) {
                        html += '<option value="' + s.id + '">' + App.escapeHtml(s.display || s.name) + '</option>';
                    });
                    pickerSite.innerHTML = html;
                }
            }).catch(function() {
                console.warn('Failed to load sites for picker');
            });
            api.get('/api/dcim/device-roles/?brief=true&limit=1000').then(function(data) {
                pickerCache.roles = data.results || data || [];
                if (pickerRole) {
                    var html = '<option value="">All Roles</option>';
                    pickerCache.roles.forEach(function(r) {
                        html += '<option value="' + r.id + '">' + App.escapeHtml(r.display || r.name) + '</option>';
                    });
                    pickerRole.innerHTML = html;
                }
            }).catch(function() {
                console.warn('Failed to load roles for picker');
            });
        }
        pickerResults.innerHTML = '<div class="picker-placeholder">Search for devices to add</div>';
    }

    function closePicker() {
        if (pickerEl) pickerEl.classList.add('d-none');
    }

    function searchDevices() {
        var q = pickerSearch ? pickerSearch.value.trim() : '';
        var siteId = pickerSite ? pickerSite.value : '';
        var roleId = pickerRole ? pickerRole.value : '';

        if (!q && !siteId && !roleId) {
            pickerResults.innerHTML = '<div class="picker-placeholder">Type a name or select a site/role to search</div>';
            return;
        }

        var params = new URLSearchParams();
        if (q) params.set('name__ic', q);
        if (siteId) params.set('site_id', siteId);
        if (roleId) params.set('role_id', roleId);
        params.set('limit', '30');

        pickerResults.innerHTML = '<div class="picker-loading"><div class="spinner-border spinner-border-sm"></div></div>';

        api.get('/api/dcim/devices/?' + params.toString()).then(function(data) {
            var results = data.results || [];
            var canvasIds = getCanvasDeviceIds();

            if (results.length === 0) {
                pickerResults.innerHTML = '<div class="picker-placeholder">No devices found</div>';
                return;
            }

            var html = '';
            results.forEach(function(dev) {
                var isOnCanvas = canvasIds.has(dev.id) || state.addedDeviceIds.has(dev.id);
                var roleColor = dev.role && dev.role.color ? '#' + dev.role.color : '#6c757d';
                var roleName = dev.role ? dev.role.display : '';
                var siteName = dev.site ? dev.site.display : '';
                var typeName = dev.device_type ? dev.device_type.display : '';

                html += '<div class="picker-device" data-device-id="' + dev.id + '">'
                    + '<span class="picker-device-dot" style="background:' + roleColor + ';"></span>'
                    + '<div class="picker-device-info">'
                    + '<div class="picker-device-name">' + App.escapeHtml(dev.display) + '</div>'
                    + '<div class="picker-device-meta">' + App.escapeHtml(typeName);
                if (siteName) html += ' &middot; ' + App.escapeHtml(siteName);
                html += '</div></div>'
                    + '<button class="picker-add-btn' + (isOnCanvas ? ' added' : '') + '" data-id="' + dev.id + '">'
                    + (isOnCanvas ? 'Added' : 'Add')
                    + '</button></div>';
            });

            if (data.count > 30) {
                html += '<div class="picker-placeholder">' + (data.count - 30) + ' more — refine your search</div>';
            }

            pickerResults.innerHTML = html;

            // Wire add buttons
            pickerResults.querySelectorAll('.picker-add-btn:not(.added)').forEach(function(btn) {
                btn.addEventListener('click', function() {
                    var devId = parseInt(this.getAttribute('data-id'));
                    state.addedDeviceIds.add(devId);
                    this.classList.add('added');
                    this.textContent = 'Added';
                    updatePickerCount();
                });
            });
        }).catch(function() {
            pickerResults.innerHTML = '<div class="picker-placeholder">Error searching devices</div>';
        });
    }

    function updatePickerCount() {
        if (pickerCount) {
            pickerCount.textContent = state.addedDeviceIds.size + ' added';
        }
    }

    function applyPickerDevices() {
        if (state.addedDeviceIds.size === 0) { closePicker(); return; }

        // Collect all device IDs: existing + newly added
        var allIds = new Set();
        state.nodes.forEach(function(n) { allIds.add(n.device_id); });
        state.addedDeviceIds.forEach(function(id) { allIds.add(id); });

        var savedPositions = getCurrentPositions();
        closePicker();

        // Reload topology with explicit device IDs
        var url = state.topologyUrl + '?device_ids=' + Array.from(allIds).join(',');

        if (loadingEl) loadingEl.classList.remove('d-none');
        if (emptyEl) emptyEl.classList.add('d-none');

        api.get(url).then(function(data) {
            if (loadingEl) loadingEl.classList.add('d-none');
            if (emptyEl) emptyEl.classList.add('d-none');
            state.nodes = data.nodes;
            state.edges = data.edges;
            state.savedLayout = savedPositions;
            renderer.render(data.nodes, data.edges);
            events.emit('data:loaded', data);

            if (sidebarEl) sidebarEl.classList.remove('hidden');

            var statNodes = document.getElementById('stat-nodes');
            var statEdges = document.getElementById('stat-edges');
            if (statNodes) statNodes.textContent = data.stats.node_count;
            if (statEdges) statEdges.textContent = data.stats.edge_count;

            state.addedDeviceIds.clear();
            updatePickerCount();
        }).catch(function(err) {
            if (loadingEl) loadingEl.classList.add('d-none');
            console.error('Failed to load devices:', err);
        });
    }

    if (pickerBtn) pickerBtn.addEventListener('click', openPicker);
    if (pickerClose) pickerClose.addEventListener('click', closePicker);
    if (pickerDone) pickerDone.addEventListener('click', applyPickerDevices);

    // Debounced search
    var pickerSearchTimer;
    if (pickerSearch) {
        pickerSearch.addEventListener('input', function() {
            clearTimeout(pickerSearchTimer);
            pickerSearchTimer = setTimeout(searchDevices, 300);
        });
    }
    if (pickerSite) pickerSite.addEventListener('change', searchDevices);
    if (pickerRole) pickerRole.addEventListener('change', searchDevices);

    // Escape to close picker
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && pickerEl && !pickerEl.classList.contains('d-none')) {
            closePicker();
        }
    });

    // ===== Role Hierarchy Editor =====
    var hierarchyEl = document.getElementById('hierarchy-editor');
    var hierarchyBtn = document.getElementById('topo-edit-hierarchy');
    var hierarchyClose = document.getElementById('hierarchy-close');
    var hierarchyList = document.getElementById('hierarchy-list');
    var hierarchyApply = document.getElementById('hierarchy-apply');
    var hierarchyReset = document.getElementById('hierarchy-reset');

    function openHierarchy() {
        if (!hierarchyEl) return;
        closePicker();
        hierarchyEl.classList.remove('d-none');

        // Collect unique roles from current nodes
        var roles = {};
        state.nodes.forEach(function(n) {
            if (n.role && !roles[n.role_slug]) {
                roles[n.role_slug] = { slug: n.role_slug, name: n.role, color: n.role_color };
            }
        });

        // Sort by current layer assignment or custom hierarchy
        var roleList = Object.values(roles);
        var customOrder = state.customHierarchy || {};
        roleList.sort(function(a, b) {
            var aOrder = customOrder[a.slug] !== undefined ? customOrder[a.slug] : 99;
            var bOrder = customOrder[b.slug] !== undefined ? customOrder[b.slug] : 99;
            if (aOrder !== bOrder) return aOrder - bOrder;
            return a.name.localeCompare(b.name);
        });

        // Render draggable list
        var html = '';
        roleList.forEach(function(r, i) {
            html += '<div class="hierarchy-item" draggable="true" data-slug="' + App.escapeHtml(r.slug) + '">'
                + '<span class="hierarchy-handle"><i class="mdi mdi-drag-horizontal-variant"></i></span>'
                + '<span class="hierarchy-dot" style="background:' + App.escapeHtml(r.color) + ';"></span>'
                + '<span class="hierarchy-name">' + App.escapeHtml(r.name) + '</span>'
                + '<span class="hierarchy-layer">Layer ' + i + '</span>'
                + '</div>';
        });
        hierarchyList.innerHTML = html;

        // Wire drag-and-drop reordering
        var items = hierarchyList.querySelectorAll('.hierarchy-item');
        var dragItem = null;

        items.forEach(function(item) {
            item.addEventListener('dragstart', function(e) {
                dragItem = this;
                this.classList.add('dragging');
                e.dataTransfer.effectAllowed = 'move';
            });
            item.addEventListener('dragend', function() {
                this.classList.remove('dragging');
                dragItem = null;
                // Update layer numbers
                hierarchyList.querySelectorAll('.hierarchy-item').forEach(function(el, idx) {
                    el.querySelector('.hierarchy-layer').textContent = 'Layer ' + idx;
                });
            });
            item.addEventListener('dragover', function(e) {
                e.preventDefault();
                if (!dragItem || dragItem === this) return;
                var rect = this.getBoundingClientRect();
                var midY = rect.top + rect.height / 2;
                if (e.clientY < midY) {
                    hierarchyList.insertBefore(dragItem, this);
                } else {
                    hierarchyList.insertBefore(dragItem, this.nextSibling);
                }
            });
        });
    }

    function closeHierarchy() {
        if (hierarchyEl) hierarchyEl.classList.add('d-none');
    }

    function applyHierarchy() {
        // Read order from DOM
        var order = {};
        hierarchyList.querySelectorAll('.hierarchy-item').forEach(function(el, idx) {
            order[el.getAttribute('data-slug')] = idx;
        });
        state.customHierarchy = order;

        // Clear saved positions and re-render with new hierarchy
        state.savedLayout = {};
        closeHierarchy();
        renderer.render(state.nodes, state.edges);
        events.emit('data:loaded', { nodes: state.nodes, edges: state.edges });
    }

    if (hierarchyBtn) hierarchyBtn.addEventListener('click', openHierarchy);
    if (hierarchyClose) hierarchyClose.addEventListener('click', closeHierarchy);
    if (hierarchyApply) hierarchyApply.addEventListener('click', applyHierarchy);
    if (hierarchyReset) hierarchyReset.addEventListener('click', function() {
        delete state.customHierarchy;
        state.savedLayout = {};
        closeHierarchy();
        renderer.render(state.nodes, state.edges);
        events.emit('data:loaded', { nodes: state.nodes, edges: state.edges });
    });

    // Auto-sort ports toggle
    var autoSortBtn = document.getElementById('topo-auto-sort');
    if (autoSortBtn) {
        autoSortBtn.addEventListener('click', function() {
            state.autoSortPorts = !state.autoSortPorts;
            this.classList.toggle('active', state.autoSortPorts);
            // Clear saved positions so the layout algorithm can optimize freely
            state.savedLayout = null;
            renderer.render(state.nodes, state.edges, true);
            events.emit('data:loaded', { nodes: state.nodes, edges: state.edges });
        });
    }

    // Snap to grid toggle
    var snapBtn = document.getElementById('topo-snap-grid');
    if (snapBtn) {
        snapBtn.addEventListener('click', function() {
            state.snapToGrid = !state.snapToGrid;
            this.classList.toggle('active', state.snapToGrid);
        });
    }

    // Add connected devices (from right-click menu)
    // Update app overlay edges when device is dragged in mixed mode
    events.on('device:drag', function(data) {
        if (appRenderer) {
            appRenderer.updateDevicePosition(data.id, data.x, data.y);
        }
    });

    events.on('device:add-neighbors', function(node) {
        // Fetch the device's interfaces to find connected devices
        var url = state.deviceDetailUrl + node.device_id + '/';
        api.get(url).then(function(data) {
            var neighborIds = new Set();
            var canvasIds = new Set();
            state.nodes.forEach(function(n) { canvasIds.add(n.device_id); });

            (data.interfaces || []).forEach(function(iface) {
                if (iface.connected_to && iface.connected_to.device_id) {
                    if (!canvasIds.has(iface.connected_to.device_id)) {
                        neighborIds.add(iface.connected_to.device_id);
                    }
                }
                // Pull in any intermediate devices on the cable trace
                // (typically patch panels) so the real cables to/from them
                // can be drawn — without this, a far-end server appears
                // floating with no connection.
                (iface.path_device_ids || []).forEach(function(devId) {
                    if (!canvasIds.has(devId)) neighborIds.add(devId);
                });
            });

            if (neighborIds.size === 0) {
                showToast('No new connected devices found');
                return;
            }

            // Add all neighbor IDs and reload
            var allIds = new Set();
            state.nodes.forEach(function(n) { allIds.add(n.device_id); });
            neighborIds.forEach(function(id) { allIds.add(id); });

            var savedPositions = getCurrentPositions();
            var topoUrl = state.topologyUrl + '?device_ids=' + Array.from(allIds).join(',');

            api.get(topoUrl).then(function(topoData) {
                if (emptyEl) emptyEl.classList.add('d-none');
                state.nodes = topoData.nodes;
                state.edges = topoData.edges;
                state.savedLayout = savedPositions;
                renderer.render(topoData.nodes, topoData.edges);
                events.emit('data:loaded', topoData);
                if (sidebarEl) sidebarEl.classList.remove('hidden');

                var statNodes = document.getElementById('stat-nodes');
                var statEdges = document.getElementById('stat-edges');
                if (statNodes) statNodes.textContent = topoData.stats.node_count;
                if (statEdges) statEdges.textContent = topoData.stats.edge_count;

                showToast(neighborIds.size + ' device(s) added');
            }).catch(function(err) {
                console.error('Failed to load neighbor topology:', err);
                showToast('Error loading neighbors', true);
            });
        }).catch(function(err) {
            console.error('Failed to fetch device details:', err);
            showToast('Error fetching device info', true);
        });
    });

    // Remove device from canvas
    events.on('device:remove', function(nodeId) {
        // Remove from state.nodes and re-render
        var savedPos = getCurrentPositions();
        state.nodes = state.nodes.filter(function(n) { return n.id !== nodeId; });
        state.edges = state.edges.filter(function(e) {
            var s = typeof e.source === 'object' ? e.source.id : e.source;
            var t = typeof e.target === 'object' ? e.target.id : e.target;
            return s !== nodeId && t !== nodeId;
        });
        delete savedPos[nodeId];
        state.savedLayout = savedPos;
        renderer.render(state.nodes, state.edges, true);
        events.emit('data:loaded', { nodes: state.nodes, edges: state.edges });

        // Update stats
        var statNodes = document.getElementById('stat-nodes');
        var statEdges = document.getElementById('stat-edges');
        if (statNodes) statNodes.textContent = state.nodes.length;
        if (statEdges) statEdges.textContent = state.edges.length;
    });

    // Reset layout button
    var resetBtn = document.getElementById('topo-reset-layout');
    if (resetBtn) {
        resetBtn.addEventListener('click', function() {
            // Clear position data — but preserve pinned nodes
            var pinLayout = {};
            state.nodes.forEach(function(n) {
                if (n._pinned && n.x !== undefined) {
                    pinLayout[n.id] = { x: n.x, y: n.y };
                }
                if (!n._pinned) { delete n.x; delete n.y; }
            });
            state.savedLayout = pinLayout;
            delete state._origNodes;
            delete state._origEdges;
            delete state._allPositionsBeforePP;
            if (state.topologyMode === 'mixed') {
                loadMixedTopology();
            } else if (state.topologyMode === 'apps' && appRenderer) {
                appRenderer.render(state.nodes, state.edges);
            } else {
                renderer.render(state.nodes, state.edges);
            }
            events.emit('data:loaded', { nodes: state.nodes, edges: state.edges });
        });
    }

    // Pass-through collapse toggle (#66)
    // Detect patch panels by presence of front↔rear port pairs (from the
    // backend's passthrough_pairs) rather than by a role-slug substring,
    // and chain edges through them following the real port mapping —
    // including chains of multiple patch panels in series.
    var collapsePP = document.getElementById('topo-collapse-pp');
    if (collapsePP) {
        collapsePP.addEventListener('click', function() {
            var isActive = this.classList.toggle('active');

            if (isActive) {
                // Save ALL positions before doing anything (including PPs)
                state._allPositionsBeforePP = getCurrentPositions();

                // Find passthrough devices (any device with a non-empty
                // passthrough_pairs list — works regardless of role name).
                var ppNodes = new Set();
                var ppPairs = {};  // ppId -> { portId -> mateePortId }
                // Map portId → speed so we can color virtual passthrough
                // edges by the real endpoint port speeds.
                var portSpeed = {};
                state.nodes.forEach(function(n) {
                    if (n.passthrough_pairs && n.passthrough_pairs.length) {
                        ppNodes.add(n.id);
                        var map = {};
                        n.passthrough_pairs.forEach(function(p) {
                            map[p.front] = p.rear;
                            map[p.rear]  = p.front;
                        });
                        ppPairs[n.id] = map;
                    }
                    (n.ports || []).forEach(function(p) {
                        if (p.speed) portSpeed[p.id] = p.speed;
                    });
                });

                if (ppNodes.size === 0) return;

                // Index edges by (deviceId, portId) so we can look up the next
                // hop after we cross a patch panel pair.
                function endpointId(e, side) {
                    var v = e[side];
                    return typeof v === 'object' ? v.id : v;
                }
                var edgeByEndpoint = {};  // 'deviceId|portId' -> edge
                state.edges.forEach(function(e) {
                    edgeByEndpoint[endpointId(e, 'source') + '|' + e.source_port] = e;
                    edgeByEndpoint[endpointId(e, 'target') + '|' + e.target_port] = e;
                });

                // Walk the chain starting from an edge end that lands on a PP.
                // Returns { devId, portId, portName } of the first non-PP
                // endpoint reached, plus the list of PP hops visited.
                function walkOut(startDevId, startPortId, startPortName, visited) {
                    visited = visited || new Set();
                    if (!ppNodes.has(startDevId)) {
                        return { devId: startDevId, portId: startPortId, portName: startPortName, hops: [] };
                    }
                    var hops = [];
                    var devId = startDevId, portId = startPortId, portName = startPortName;
                    while (ppNodes.has(devId)) {
                        var pairMap = ppPairs[devId];
                        var matePortId = pairMap && pairMap[portId];
                        if (!matePortId) return null;  // unpaired port — abort
                        hops.push(devId);
                        var key = devId + '|' + matePortId;
                        if (visited.has(key)) return null;  // cycle
                        visited.add(key);
                        var nextEdge = edgeByEndpoint[key];
                        if (!nextEdge) return null;  // dangling
                        var srcDev = endpointId(nextEdge, 'source');
                        if (srcDev === devId && nextEdge.source_port === matePortId) {
                            devId = endpointId(nextEdge, 'target');
                            portId = nextEdge.target_port;
                            portName = nextEdge.target_port_name;
                        } else {
                            devId = endpointId(nextEdge, 'source');
                            portId = nextEdge.source_port;
                            portName = nextEdge.source_port_name;
                        }
                    }
                    return { devId: devId, portId: portId, portName: portName, hops: hops };
                }

                // Walk every edge that touches a PP, building virtual edges
                // between the two real (non-PP) endpoints. Track which
                // physical edges have been "consumed" so we don't emit
                // duplicates for the partner edge.
                var consumed = new Set();
                var virtualEdges = [];
                var normalEdges = [];

                state.edges.forEach(function(e) {
                    var s = endpointId(e, 'source'), t = endpointId(e, 'target');
                    var srcIsPP = ppNodes.has(s), tgtIsPP = ppNodes.has(t);
                    if (!srcIsPP && !tgtIsPP) {
                        normalEdges.push(e);
                        return;
                    }
                    if (consumed.has(e.id)) return;
                    consumed.add(e.id);

                    // Walk outward from each end. If the end is already a real
                    // device, walkOut just echoes it.
                    var leftStart  = srcIsPP ? { dev: t, port: e.target_port, name: e.target_port_name }
                                              : { dev: s, port: e.source_port, name: e.source_port_name };
                    var rightStart = srcIsPP ? { dev: s, port: e.source_port, name: e.source_port_name }
                                              : { dev: t, port: e.target_port, name: e.target_port_name };
                    var visited = new Set();
                    var left  = walkOut(leftStart.dev,  leftStart.port,  leftStart.name,  visited);
                    var right = walkOut(rightStart.dev, rightStart.port, rightStart.name, visited);
                    if (!left || !right) return;

                    // Mark every cable touched by the walk as consumed.
                    left.hops.concat(right.hops).forEach(function(hopDev) {
                        // (already marked above via visited set on portIds; nothing else needed)
                    });
                    // Also mark the partner edge on the right side
                    var rightKey = right.devId + '|' + right.portId;
                    var partner = edgeByEndpoint[rightKey];
                    if (partner) consumed.add(partner.id);

                    var hopNames = left.hops.concat(right.hops).map(function(id) {
                        var nm = '';
                        state.nodes.forEach(function(n) { if (n.id === id) nm = n.name; });
                        return nm;
                    }).filter(Boolean);

                    // Color the synthetic edge by the real endpoint port speeds.
                    // Both ends match → speed color. Mismatch → orange warning.
                    // Unknown → fall back to grey.
                    var lSpeed = portSpeed[left.portId];
                    var rSpeed = portSpeed[right.portId];
                    var vColor = '#9e9e9e';
                    var vLabel = 'Through ' + hopNames.join(' → ');
                    if (lSpeed && rSpeed) {
                        if (lSpeed === rSpeed) {
                            vColor = (App && App.speedColor) ? App.speedColor(lSpeed) : '#9e9e9e';
                        } else {
                            vColor = '#f39c12';  // bottleneck / mismatch
                            vLabel += '  ⚠ speed mismatch';
                        }
                    }
                    virtualEdges.push({
                        id: 'virtual-' + e.id,
                        source: left.devId, target: right.devId,
                        source_port: left.portId, target_port: right.portId,
                        source_port_name: left.portName, target_port_name: right.portName,
                        source_port_speed: lSpeed || null,
                        target_port_speed: rSpeed || null,
                        cable_id: 'PP', cable_label: vLabel,
                        cable_type: 'Pass-through', cable_type_value: '',
                        color: vColor, status: 'Connected', status_value: 'connected',
                        length: '', length_unit: '', url: '', _virtual: true,
                    });
                });

                state._origNodes = state.nodes;
                state._origEdges = state.edges;
                var filteredNodes = state.nodes.filter(function(n) { return !ppNodes.has(n.id); });
                var mergedEdges = normalEdges.concat(virtualEdges);
                // Keep state.nodes/edges in sync so downstream readers see the
                // collapsed view (sidebar device list, filter counts, etc.).
                state.nodes = filteredNodes;
                state.edges = mergedEdges;

                // Use the saved positions (non-PP nodes keep their spots)
                state.savedLayout = state._allPositionsBeforePP;
                renderer.render(filteredNodes, mergedEdges, true);
                events.emit('data:loaded', { nodes: filteredNodes, edges: mergedEdges });
            } else {
                // Restore: merge current non-PP positions + original PP positions
                if (state._origNodes) {
                    var currentPos = getCurrentPositions();
                    var restoreLayout = {};
                    // PP nodes: use positions from before we hid them
                    if (state._allPositionsBeforePP) {
                        for (var id in state._allPositionsBeforePP) {
                            restoreLayout[id] = state._allPositionsBeforePP[id];
                        }
                    }
                    // Non-PP nodes: use current (possibly dragged) positions
                    for (var id2 in currentPos) {
                        restoreLayout[id2] = currentPos[id2];
                    }

                    state.savedLayout = restoreLayout;
                    state.nodes = state._origNodes;
                    state.edges = state._origEdges;
                    renderer.render(state.nodes, state.edges, true);
                    events.emit('data:loaded', { nodes: state.nodes, edges: state.edges });
                    delete state._origNodes;
                    delete state._origEdges;
                    delete state._allPositionsBeforePP;
                }
            }
        });
    }

    // #61 — Hide ports whose remote end isn't currently visible. Pure
    // renderer-side filter, so we just flip the state flag and re-render.
    var hideUnconnected = document.getElementById('topo-hide-unconnected-ports');
    if (hideUnconnected) {
        hideUnconnected.addEventListener('click', function() {
            state.hideUnconnectedPorts = this.classList.toggle('active');
            state.savedLayout = getCurrentPositions();
            renderer.render(state.nodes, state.edges, true);
        });
    }

    // Cable color mode toggle (physical / speed)
    var cablePhysical = document.getElementById('cable-color-physical');
    var cableSpeed = document.getElementById('cable-color-speed');
    if (cablePhysical) cablePhysical.addEventListener('click', function() {
        cablePhysical.classList.add('active'); if (cableSpeed) cableSpeed.classList.remove('active');
        state.cableColorMode = 'physical';
        renderer.render(state.nodes, state.edges, true);
    });
    if (cableSpeed) cableSpeed.addEventListener('click', function() {
        if (cablePhysical) cablePhysical.classList.remove('active'); cableSpeed.classList.add('active');
        state.cableColorMode = 'speed';
        renderer.render(state.nodes, state.edges, true);
    });

    // Cable style toggle (curve / orthogonal)
    var cableCurve = document.getElementById('cable-curve');
    var cableOrtho = document.getElementById('cable-ortho');
    if (cableCurve) cableCurve.addEventListener('click', function() {
        cableCurve.classList.add('active'); if (cableOrtho) cableOrtho.classList.remove('active');
        state.cableStyle = 'curve';
        if (state.topologyMode === 'apps' && appRenderer) {
            appRenderer.switchEdgeStyle('curve');
        } else {
            renderer.switchCableStyle('curve');
        }
    });
    if (cableOrtho) cableOrtho.addEventListener('click', function() {
        if (cableCurve) cableCurve.classList.remove('active'); cableOrtho.classList.add('active');
        state.cableStyle = 'ortho';
        if (state.topologyMode === 'apps' && appRenderer) {
            appRenderer.switchEdgeStyle('ortho');
        } else {
            renderer.switchCableStyle('ortho');
        }
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
