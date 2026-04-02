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

        for (var nodeId in layout) {
            if (nodeId === '_hierarchy' || nodeId === '_topology_mode') continue;
            var data = layout[nodeId];
            if (data.hidden) state.hiddenNodes.add(nodeId);
            if (data.pinned) {
                // Mark node as pinned — will be applied after nodes are loaded
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
        // Use renderer's positioned data (has actual x,y from layout + drag)
        var renderedNodes = (appRenderer && appRenderer._nodeData) || renderer._stencilNodeData || state.nodes;
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

            layout[n.id] = entry;
        });
        if (state.topologyMode !== 'network') {
            layout._topology_mode = state.topologyMode;
        }
        return layout;
    }

    // Get current positions from renderer for preserving across re-renders
    function getCurrentPositions() {
        var positions = {};
        var renderedNodes = (appRenderer && appRenderer._nodeData) || renderer._stencilNodeData || [];
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

    function switchToMode(mode) {
        state.topologyMode = mode;
        setModeActive(mode === 'apps' ? modeApps : modeNetwork);

        // Switch footer legend
        var legendNetwork = document.getElementById('legend-network');
        var legendApps = document.getElementById('legend-apps');
        if (legendNetwork) legendNetwork.classList.toggle('d-none', mode === 'apps');
        if (legendApps) legendApps.classList.toggle('d-none', mode !== 'apps');

        // Update toolbar visibility for network-only controls
        var networkOnlyBtns = ['topo-add-devices', 'topo-edit-hierarchy', 'topo-auto-sort',
            'topo-collapse-pp', 'cable-color-physical', 'cable-color-speed', 'cable-curve',
            'cable-ortho', 'topo-toggle-labels', 'view-stencil', 'view-node'];
        networkOnlyBtns.forEach(function(id) {
            var el = document.getElementById(id);
            if (el) el.style.display = (mode === 'apps') ? 'none' : '';
        });

        // Update stats labels
        var statNodes = document.getElementById('stat-nodes');
        var statEdges = document.getElementById('stat-edges');
        if (statNodes && statNodes.nextSibling) {
            var nodesLabel = statNodes.parentNode;
            if (nodesLabel) {
                // The text node after stat-nodes
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

        // Clear state and reload
        state.nodes = [];
        state.edges = [];
        state.savedLayout = {};
        state.hiddenNodes.clear();
        state.selectedNode = null;
        events.emit('node:deselect');

        if (mode === 'apps') {
            loadAppTopology();
        } else {
            loadTopology();
        }
    }

    if (modeNetwork) modeNetwork.addEventListener('click', function() { switchToMode('network'); });
    if (modeApps) modeApps.addEventListener('click', function() { switchToMode('apps'); });

    // Initial load — check if saved layout restores app topology mode
    if (state.savedLayout && state.savedLayout._topology_mode) {
        state.topologyMode = state.savedLayout._topology_mode;
    }
    if (state.topologyMode === 'apps') {
        setModeActive(modeApps);
        loadAppTopology();
    } else {
        loadTopology();
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
            renderer.render(state.nodes, state.edges);
            events.emit('data:loaded', { nodes: state.nodes, edges: state.edges });
        });
    }

    // Pass-through collapse toggle
    var collapsePP = document.getElementById('topo-collapse-pp');
    if (collapsePP) {
        collapsePP.addEventListener('click', function() {
            var isActive = this.classList.toggle('active');

            if (isActive) {
                // Save ALL positions before doing anything (including PPs)
                state._allPositionsBeforePP = getCurrentPositions();

                // Find patch panel nodes
                var ppNodes = new Set();
                state.nodes.forEach(function(n) {
                    if (n.role_slug && n.role_slug.indexOf('patch-panel') !== -1) {
                        ppNodes.add(n.id);
                    }
                });

                if (ppNodes.size === 0) return;

                // Collect edges to/from patch panels
                var ppEdges = [];
                var normalEdges = [];
                state.edges.forEach(function(e) {
                    var s = typeof e.source === 'object' ? e.source.id : e.source;
                    var t = typeof e.target === 'object' ? e.target.id : e.target;
                    if (ppNodes.has(s) || ppNodes.has(t)) ppEdges.push(e);
                    else normalEdges.push(e);
                });

                // Group PP edges by patch panel
                var ppGroups = {};
                ppEdges.forEach(function(e) {
                    var s = typeof e.source === 'object' ? e.source.id : e.source;
                    var t = typeof e.target === 'object' ? e.target.id : e.target;
                    var ppId = ppNodes.has(s) ? s : t;
                    var otherDevId = ppNodes.has(s) ? t : s;
                    var otherPort = ppNodes.has(s) ? e.target_port : e.source_port;
                    var otherPortName = ppNodes.has(s) ? e.target_port_name : e.source_port_name;
                    if (!ppGroups[ppId]) ppGroups[ppId] = [];
                    ppGroups[ppId].push({
                        deviceId: otherDevId,
                        portId: otherPort,
                        portName: otherPortName,
                    });
                });

                // Create virtual edges
                var virtualEdges = [];
                Object.keys(ppGroups).forEach(function(ppId) {
                    var connections = ppGroups[ppId];
                    var ppName = '';
                    state.nodes.forEach(function(n) { if (n.id === ppId) ppName = n.name; });
                    for (var i = 0; i < connections.length - 1; i += 2) {
                        var a = connections[i], b = connections[i + 1];
                        virtualEdges.push({
                            id: 'virtual-' + ppId + '-' + i,
                            source: a.deviceId, target: b.deviceId,
                            source_port: a.portId, target_port: b.portId,
                            source_port_name: a.portName, target_port_name: b.portName,
                            cable_id: 'PP', cable_label: 'Through ' + ppName,
                            cable_type: 'Pass-through', cable_type_value: '',
                            color: '#9e9e9e', status: 'Connected', status_value: 'connected',
                            length: '', length_unit: '', url: '', _virtual: true,
                        });
                    }
                });

                state._origNodes = state.nodes;
                state._origEdges = state.edges;
                var filteredNodes = state.nodes.filter(function(n) { return !ppNodes.has(n.id); });
                var mergedEdges = normalEdges.concat(virtualEdges);

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
