(function () {
    'use strict';

    var container = document.getElementById('site-map-container');
    if (!container) return;

    /* ── Data parsing ─────────────────────────────────────────────── */
    function parseJSON(attr) {
        try { return JSON.parse(container.getAttribute(attr) || '[]'); }
        catch (e) { return []; }
    }

    var placedSites       = parseJSON('data-placed-sites');
    var unplacedSites     = parseJSON('data-unplaced-sites');
    var locations          = parseJSON('data-locations');
    var unplacedLocations  = parseJSON('data-unplaced-locations');
    var tiles              = parseJSON('data-tiles');
    var unplacedTiles      = parseJSON('data-unplaced-tiles');
    var mapMarkers         = parseJSON('data-markers');

    var canEdit   = container.getAttribute('data-can-edit') === 'true';
    var csrfToken = container.getAttribute('data-csrf-token') || '';
    var siteApiUrl      = container.getAttribute('data-site-api-url') || '/api/dcim/sites/';
    var locCoordsApiUrl  = container.getAttribute('data-loc-coords-api-url') || '';
    var tileApiUrl       = container.getAttribute('data-tile-api-url') || '';
    var markerApiUrl     = container.getAttribute('data-marker-api-url') || '';
    var detailBaseUrl    = container.getAttribute('data-detail-base-url') || '/plugins/map/marker-detail/';

    /* ── Edit mode state ──────────────────────────────────────────── */
    var editMode = false;   // starts OFF — view only

    /* ── Toolbar elements ─────────────────────────────────────────── */
    var editModeBtn     = document.getElementById('edit-mode-btn');
    var toolbarEl       = document.getElementById('site-map-toolbar-controls');
    var sitesSelect     = document.getElementById('unplaced-sites-select');
    var locationsSelect = document.getElementById('unplaced-locations-select');
    var tilesSelect     = document.getElementById('unplaced-tiles-select');
    var placeSiteBtn    = document.getElementById('place-site-btn');
    var placeLocBtn     = document.getElementById('place-location-btn');
    var placeTileBtn    = document.getElementById('place-tile-btn');
    var statusEl        = document.getElementById('placement-status');
    var cancelBtn       = document.getElementById('cancel-placement-btn');

    // New marker toolbar
    var newMarkerType   = document.getElementById('new-marker-type');
    var newMarkerLabel  = document.getElementById('new-marker-label');
    var addMarkerBtn    = document.getElementById('add-marker-btn');

    /* ── Sidebar elements ─────────────────────────────────────────── */
    var sidebarSearch   = document.getElementById('sidebar-search');
    var sidebarToggles  = document.getElementById('sidebar-toggles');
    var sidebarCount    = document.getElementById('sidebar-count');
    var sidebarList     = document.getElementById('sidebar-list');
    var sidebarDetail   = document.getElementById('sidebar-detail');

    /* ── Placement state ──────────────────────────────────────────── */
    var placementMode = null;   // null | 'site' | 'location' | 'tile' | 'marker'
    var placementItem = null;

    /* ── Tile type configuration (dynamic, loaded from server) ────── */
    var TYPE_CONFIGS_RAW = [];
    try {
        TYPE_CONFIGS_RAW = JSON.parse(container.getAttribute('data-type-configs') || '[]');
    } catch (e) {
        console.error('Failed to parse type configs:', e);
    }
    var TILE_CONFIG = {};
    TYPE_CONFIGS_RAW.forEach(function(tc) {
        TILE_CONFIG[tc.slug] = { color: tc.color, icon: tc.icon, label: tc.name };
    });

    /* ── Tracking all sidebar items and their Leaflet objects ─────── */
    // Each entry: { kind, data, marker(L.marker), fov(L.polygon|null), sidebarEl(DOM) }
    var allItems = [];
    var activeToggles = {};    // type -> bool
    var selectedItem = null;   // reference to allItems entry

    /* ── Empty state ──────────────────────────────────────────────── */
    var hasItems = placedSites.length || locations.length || tiles.length || mapMarkers.length;
    if (!hasItems && !canEdit) {
        container.innerHTML =
            '<div class="site-map-empty">' +
                '<i class="mdi mdi-map-marker-off-outline"></i>' +
                '<p>No sites with geographic coordinates found</p>' +
            '</div>';
        var sidebar = document.getElementById('site-map-sidebar');
        if (sidebar) sidebar.style.display = 'none';
        return;
    }

    /* ── Init map ─────────────────────────────────────────────────── */
    var map = L.map(container, {
        zoomControl: true,
        attributionControl: true
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19
    }).addTo(map);

    var bounds = L.latLngBounds();
    var hasBounds = false;

    /* ── Helpers ───────────────────────────────────────────────────── */
    function escHtml(str) {
        if (!str) return '';
        var div = document.createElement('div');
        div.appendChild(document.createTextNode(str));
        return div.innerHTML;
    }

    function apiRequest(url, method, body) {
        var opts = {
            method: method,
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': csrfToken
            }
        };
        if (body) opts.body = JSON.stringify(body);
        return fetch(url, opts).then(function (r) {
            if (!r.ok) {
                return r.text().then(function (text) {
                    var detail = '';
                    try {
                        var errData = JSON.parse(text);
                        detail = JSON.stringify(errData);
                    } catch (e) {
                        detail = text.substring(0, 200);
                    }
                    throw new Error('API ' + r.status + ': ' + detail);
                });
            }
            if (r.status === 204) return null;
            return r.json();
        });
    }

    function showSavedBadge(marker) {
        var el = marker.getElement && marker.getElement();
        if (!el) return;
        var badge = document.createElement('span');
        badge.className = 'site-marker-saved';
        badge.textContent = 'Saved';
        el.appendChild(badge);
        setTimeout(function () {
            badge.classList.add('site-marker-saved--fade');
        }, 50);
        setTimeout(function () {
            if (badge.parentNode) badge.parentNode.removeChild(badge);
        }, 1600);
    }

    function extendBounds(lat, lng) {
        bounds.extend(L.latLng(lat, lng));
        hasBounds = true;
    }

    /* ══════════════════════════════════════════════════════════════════
       EDIT MODE TOGGLE
       ══════════════════════════════════════════════════════════════════ */
    function setEditMode(on) {
        editMode = on;
        // Toggle toolbar visibility
        if (toolbarEl) {
            toolbarEl.classList.toggle('d-none', !on);
        }
        // Toggle button style
        if (editModeBtn) {
            editModeBtn.classList.toggle('active', on);
            if (on) {
                editModeBtn.innerHTML = '<i class="mdi mdi-pencil-outline"></i> Editing';
            } else {
                editModeBtn.innerHTML = '<i class="mdi mdi-pencil-lock-outline"></i> Edit Mode';
            }
        }
        // Enable/disable dragging on all markers
        allItems.forEach(function (item) {
            if (item.marker) {
                if (on) {
                    item.marker.dragging.enable();
                } else {
                    item.marker.dragging.disable();
                }
            }
        });
        // Cancel any active placement
        if (!on) exitPlacementMode();
        // Refresh detail panel (to show/hide edit buttons)
        if (selectedItem) showDetail(selectedItem);
    }

    if (editModeBtn) {
        editModeBtn.addEventListener('click', function () {
            setEditMode(!editMode);
        });
    }

    /* ══════════════════════════════════════════════════════════════════
       HAVERSINE — compute destination point for FOV arcs
       ══════════════════════════════════════════════════════════════════ */
    function destinationPoint(lat, lng, bearing, distanceMeters) {
        var R = 6371000; // earth radius in meters
        var d = distanceMeters / R;
        var brng = bearing * Math.PI / 180;
        var lat1 = lat * Math.PI / 180;
        var lng1 = lng * Math.PI / 180;

        var lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) +
                             Math.cos(lat1) * Math.sin(d) * Math.cos(brng));
        var lng2 = lng1 + Math.atan2(Math.sin(brng) * Math.sin(d) * Math.cos(lat1),
                                      Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));

        return [lat2 * 180 / Math.PI, lng2 * 180 / Math.PI];
    }

    function buildFovPolygon(lat, lng, direction, angle, distance) {
        var distMeters = distance * 50; // 1 unit ≈ 50m
        var startAngle = direction - angle / 2;
        var endAngle = direction + angle / 2;
        var points = [[lat, lng]]; // origin
        var steps = Math.max(12, Math.floor(angle / 5));

        for (var i = 0; i <= steps; i++) {
            var bearing = startAngle + (endAngle - startAngle) * (i / steps);
            points.push(destinationPoint(lat, lng, bearing, distMeters));
        }

        points.push([lat, lng]); // close

        return L.polygon(points, {
            color: '#ff4444',
            fillColor: '#ff4444',
            fillOpacity: 0.15,
            weight: 1,
            opacity: 0.4,
            interactive: false
        });
    }

    /* ══════════════════════════════════════════════════════════════════
       SITE MARKERS
       ══════════════════════════════════════════════════════════════════ */
    function createSiteMarker(site) {
        var latlng = L.latLng(site.latitude, site.longitude);
        extendBounds(site.latitude, site.longitude);

        var isOffice = site.floorplan_count > 0;
        var icon;

        if (isOffice) {
            icon = L.divIcon({
                className: '',
                html: '<div class="site-marker--office"><i class="mdi mdi-office-building-outline"></i></div>',
                iconSize: [32, 32],
                iconAnchor: [16, 16],
                popupAnchor: [0, -18]
            });
        } else {
            icon = L.divIcon({
                className: '',
                html: '<div class="site-marker--regular"></div>',
                iconSize: [24, 24],
                iconAnchor: [12, 12],
                popupAnchor: [0, -14]
            });
        }

        var marker = L.marker(latlng, {
            icon: icon,
            draggable: false,       // starts locked
            zIndexOffset: 1000      // sites always on top
        }).addTo(map);

        marker.bindPopup(buildSitePopup(site), { className: 'site-map-popup' });

        if (canEdit) {
            marker.on('dragend', function () {
                var pos = marker.getLatLng();
                apiRequest(siteApiUrl + site.id + '/', 'PATCH', {
                    latitude: pos.lat.toFixed(6),
                    longitude: pos.lng.toFixed(6)
                }).then(function () {
                    showSavedBadge(marker);
                }).catch(function (err) {
                    console.error('Failed to update site:', err);
                });
            });
        }

        // Register in allItems for sidebar
        var item = {
            kind: 'site',
            data: site,
            marker: marker,
            fov: null,
            sidebarEl: null,
            searchText: (site.name || '').toLowerCase(),
            type: '_site'
        };
        allItems.push(item);

        marker.on('click', function () {
            selectItem(item);
        });

        return marker;
    }

    function buildSitePopup(site) {
        var html = '<div class="site-popup-name"><a href="' + escHtml(site.url) + '">' +
                   escHtml(site.name) + '</a></div>';

        var meta = [];
        if (site.status) meta.push(escHtml(site.status));
        if (site.region) meta.push(escHtml(site.region));
        if (meta.length) {
            html += '<div class="site-popup-meta">' + meta.join(' &middot; ') + '</div>';
        }
        if (site.physical_address) {
            html += '<div class="site-popup-meta">' + escHtml(site.physical_address) + '</div>';
        }

        if (site.locations && site.locations.length) {
            html += '<div class="site-popup-section">';
            html += '<div class="site-popup-section-label">Locations</div>';
            site.locations.forEach(function (loc) {
                html += '<div class="site-popup-item">' + escHtml(loc.name) + '</div>';
            });
            html += '</div>';
        }

        if (site.floorplans && site.floorplans.length) {
            html += '<div class="site-popup-fp-section">';
            html += '<div class="site-popup-fp-label">Floor Plans</div>';
            site.floorplans.forEach(function (fp) {
                html += '<a class="site-popup-fp-link" href="' + escHtml(fp.visualization_url) + '">' +
                        '<i class="mdi mdi-floor-plan"></i>' + escHtml(fp.name) + '</a>';
            });
            html += '</div>';
        }

        return html;
    }

    placedSites.forEach(function (site) {
        createSiteMarker(site);
    });

    /* ══════════════════════════════════════════════════════════════════
       LOCATION MARKERS
       ══════════════════════════════════════════════════════════════════ */
    function createLocationMarker(loc) {
        var latlng = L.latLng(loc.latitude, loc.longitude);
        extendBounds(loc.latitude, loc.longitude);

        var icon = L.divIcon({
            className: '',
            html: '<div class="site-marker--location"><i class="mdi mdi-map-marker-outline"></i></div>',
            iconSize: [22, 22],
            iconAnchor: [11, 11],
            popupAnchor: [0, -13]
        });

        var marker = L.marker(latlng, {
            icon: icon,
            draggable: false,       // starts locked
            zIndexOffset: 500       // locations above tiles, below sites
        }).addTo(map);

        var popupHtml = '<div class="site-popup-name"><a href="' + escHtml(loc.url) + '">' +
                        escHtml(loc.name) + '</a></div>';
        if (loc.site_name) {
            popupHtml += '<div class="site-popup-meta">' + escHtml(loc.site_name) + '</div>';
        }
        marker.bindPopup(popupHtml, { className: 'site-map-popup' });

        if (canEdit) {
            marker.on('dragend', function () {
                var pos = marker.getLatLng();
                apiRequest(locCoordsApiUrl + loc.id + '/', 'PATCH', {
                    latitude: pos.lat.toFixed(6),
                    longitude: pos.lng.toFixed(6)
                }).then(function () {
                    showSavedBadge(marker);
                }).catch(function (err) {
                    console.error('Failed to update location:', err);
                });
            });
        }

        var item = {
            kind: 'location',
            data: loc,
            marker: marker,
            fov: null,
            sidebarEl: null,
            searchText: (loc.name || '').toLowerCase(),
            type: '_location'
        };
        allItems.push(item);

        marker.on('click', function () {
            selectItem(item);
        });

        return marker;
    }

    locations.forEach(function (loc) {
        createLocationMarker(loc);
    });

    /* ══════════════════════════════════════════════════════════════════
       TILE MARKERS (floor plan tiles on the global map)
       ══════════════════════════════════════════════════════════════════ */
    function createTileMarker(tile) {
        var latlng = L.latLng(tile.latitude, tile.longitude);
        extendBounds(tile.latitude, tile.longitude);

        var cfg = TILE_CONFIG[tile.type] || { color: '#888', icon: 'mdi-circle', label: tile.type };

        var icon = L.divIcon({
            className: '',
            html: '<div class="site-marker--tile" style="background:' + cfg.color + '"><i class="mdi ' + cfg.icon + '"></i></div>',
            iconSize: [20, 20],
            iconAnchor: [10, 10],
            popupAnchor: [0, -12]
        });

        var marker = L.marker(latlng, {
            icon: icon,
            draggable: false        // starts locked
        }).addTo(map);

        var popupHtml = '<div class="site-popup-name">' + escHtml(tile.label) + '</div>';
        popupHtml += '<div class="site-popup-meta">' + escHtml(tile.type) + '</div>';
        if (tile.site_name) {
            popupHtml += '<div class="site-popup-meta">' + escHtml(tile.site_name);
            if (tile.floorplan_name) popupHtml += ' &middot; ' + escHtml(tile.floorplan_name);
            popupHtml += '</div>';
        }
        if (tile.assigned_object_name) {
            if (tile.assigned_object_url) {
                popupHtml += '<div class="site-popup-meta"><a href="' + escHtml(tile.assigned_object_url) + '">' + escHtml(tile.assigned_object_name) + '</a></div>';
            } else {
                popupHtml += '<div class="site-popup-meta">' + escHtml(tile.assigned_object_name) + '</div>';
            }
        }
        if (tile.primary_ip) {
            popupHtml += '<div class="site-popup-meta"><code>' + escHtml(tile.primary_ip) + '</code></div>';
        }
        marker.bindPopup(popupHtml, { className: 'site-map-popup' });

        var item = {
            kind: 'tile',
            data: tile,
            marker: marker,
            fov: null,
            sidebarEl: null,
            searchText: ((tile.label || '') + ' ' + (tile.type || '')).toLowerCase(),
            type: tile.type
        };
        allItems.push(item);

        if (canEdit) {
            marker.on('dragend', function () {
                var pos = marker.getLatLng();
                apiRequest(tileApiUrl + tile.id + '/', 'PATCH', {
                    latitude: pos.lat.toFixed(6),
                    longitude: pos.lng.toFixed(6)
                }).then(function () {
                    tile.latitude = parseFloat(pos.lat.toFixed(6));
                    tile.longitude = parseFloat(pos.lng.toFixed(6));
                    showSavedBadge(marker);
                }).catch(function (err) {
                    console.error('Failed to update tile:', err);
                });
            });
        }

        marker.on('click', function () {
            selectItem(item);
        });

        return item;
    }

    tiles.forEach(function (tile) {
        createTileMarker(tile);
    });

    /* ══════════════════════════════════════════════════════════════════
       MAP MARKERS (standalone markers) + FOV CONES
       ══════════════════════════════════════════════════════════════════ */
    function createMapMarker(m) {
        var latlng = L.latLng(m.latitude, m.longitude);
        extendBounds(m.latitude, m.longitude);

        var cfg = TILE_CONFIG[m.type] || { color: '#888', icon: 'mdi-circle', label: m.type };

        var icon = L.divIcon({
            className: '',
            html: '<div class="site-marker--tile" style="background:' + cfg.color + '"><i class="mdi ' + cfg.icon + '"></i></div>',
            iconSize: [20, 20],
            iconAnchor: [10, 10],
            popupAnchor: [0, -12]
        });

        var marker = L.marker(latlng, {
            icon: icon,
            draggable: false        // starts locked
        }).addTo(map);

        var popupHtml = '<div class="site-popup-name">' + escHtml(m.label) + '</div>';
        popupHtml += '<div class="site-popup-meta">' + escHtml(m.type) + '</div>';
        if (m.site_name) {
            popupHtml += '<div class="site-popup-meta">' + escHtml(m.site_name) + '</div>';
        }
        if (m.assigned_object_name) {
            if (m.assigned_object_url) {
                popupHtml += '<div class="site-popup-meta"><a href="' + escHtml(m.assigned_object_url) + '">' + escHtml(m.assigned_object_name) + '</a></div>';
            } else {
                popupHtml += '<div class="site-popup-meta">' + escHtml(m.assigned_object_name) + '</div>';
            }
        }
        if (m.primary_ip) {
            popupHtml += '<div class="site-popup-meta"><code>' + escHtml(m.primary_ip) + '</code></div>';
        }
        marker.bindPopup(popupHtml, { className: 'site-map-popup' });

        // FOV polygon for camera markers
        var fovPolygon = null;
        if (m.type === 'camera') {
            fovPolygon = buildFovPolygon(
                m.latitude, m.longitude,
                m.fov_direction, m.fov_angle, m.fov_distance
            ).addTo(map);
        }

        var item = {
            kind: 'mapmarker',
            data: m,
            marker: marker,
            fov: fovPolygon,
            sidebarEl: null,
            searchText: ((m.label || '') + ' ' + (m.type || '') + ' ' + (m.site_name || '')).toLowerCase(),
            type: m.type
        };
        allItems.push(item);

        if (canEdit) {
            marker.on('dragend', function () {
                var pos = marker.getLatLng();
                apiRequest(markerApiUrl + m.id + '/', 'PATCH', {
                    latitude: pos.lat.toFixed(6),
                    longitude: pos.lng.toFixed(6)
                }).then(function () {
                    m.latitude = parseFloat(pos.lat.toFixed(6));
                    m.longitude = parseFloat(pos.lng.toFixed(6));
                    // Update FOV polygon position
                    if (item.fov) {
                        map.removeLayer(item.fov);
                        item.fov = buildFovPolygon(
                            m.latitude, m.longitude,
                            m.fov_direction, m.fov_angle, m.fov_distance
                        ).addTo(map);
                    }
                    showSavedBadge(marker);
                }).catch(function (err) {
                    console.error('Failed to update marker:', err);
                });
            });
        }

        marker.on('click', function () {
            selectItem(item);
        });

        return item;
    }

    mapMarkers.forEach(function (m) {
        createMapMarker(m);
    });

    /* ── Focus from ?q=lat,lng (NetBox Maps URL) or fit bounds ──── */
    var focusLat = parseFloat(container.dataset.focusLat);
    var focusLng = parseFloat(container.dataset.focusLng);

    if (!isNaN(focusLat) && !isNaN(focusLng)) {
        map.setView([focusLat, focusLng], 16);
    } else if (hasBounds && bounds.isValid()) {
        var allPoints = [];
        placedSites.forEach(function (s) { allPoints.push(s); });
        locations.forEach(function (l) { allPoints.push(l); });
        tiles.forEach(function (t) { allPoints.push(t); });
        mapMarkers.forEach(function (m) { allPoints.push(m); });

        if (allPoints.length === 1) {
            map.setView([allPoints[0].latitude, allPoints[0].longitude], 14);
        } else {
            map.fitBounds(bounds, { padding: [50, 50] });
        }
    } else {
        map.setView([20, 0], 2);
    }

    /* ══════════════════════════════════════════════════════════════════
       SIDEBAR — Build type toggles, list, search, detail
       ══════════════════════════════════════════════════════════════════ */

    // Collect unique types
    function getUniqueTypes() {
        var types = {};
        allItems.forEach(function (item) {
            var t = item.type;
            if (!types[t]) types[t] = 0;
            types[t]++;
        });
        return types;
    }

    function buildToggleButtons() {
        if (!sidebarToggles) return;
        sidebarToggles.innerHTML = '';
        var types = getUniqueTypes();

        // Special toggles for site and location
        var specialTypes = [
            { key: '_site', label: 'Site', color: '#0d6efd' },
            { key: '_location', label: 'Location', color: '#1a8a7a' }
        ];
        specialTypes.forEach(function (st) {
            if (!types[st.key]) return;
            if (!(st.key in activeToggles)) activeToggles[st.key] = true;
            var btn = document.createElement('button');
            btn.className = 'type-toggle' + (activeToggles[st.key] ? ' active' : '');
            btn.innerHTML = '<span class="toggle-dot" style="background:' + st.color + '"></span>' + st.label;
            btn.addEventListener('click', function () {
                activeToggles[st.key] = !activeToggles[st.key];
                btn.classList.toggle('active');
                applyFilters();
            });
            sidebarToggles.appendChild(btn);
        });

        // Tile type toggles
        Object.keys(TILE_CONFIG).forEach(function (key) {
            if (!types[key]) return;
            if (!(key in activeToggles)) activeToggles[key] = true;
            var cfg = TILE_CONFIG[key];
            var btn = document.createElement('button');
            btn.className = 'type-toggle' + (activeToggles[key] ? ' active' : '');
            btn.innerHTML = '<span class="toggle-dot" style="background:' + cfg.color + '"></span>' + cfg.label;
            btn.addEventListener('click', function () {
                activeToggles[key] = !activeToggles[key];
                btn.classList.toggle('active');
                applyFilters();
            });
            sidebarToggles.appendChild(btn);
        });
    }

    function buildSidebarList() {
        if (!sidebarList) return;
        sidebarList.innerHTML = '';
        var searchVal = sidebarSearch ? sidebarSearch.value.toLowerCase().trim() : '';
        var visible = 0;
        var total = allItems.length;

        allItems.forEach(function (item) {
            // Type filter
            if (!activeToggles[item.type]) {
                // Hide on map
                if (item.marker && map.hasLayer(item.marker)) map.removeLayer(item.marker);
                if (item.fov && map.hasLayer(item.fov)) map.removeLayer(item.fov);
                item.sidebarEl = null;
                return;
            }

            // Show on map
            if (item.marker && !map.hasLayer(item.marker)) map.addLayer(item.marker);
            if (item.fov && !map.hasLayer(item.fov)) map.addLayer(item.fov);

            // Search filter
            if (searchVal && item.searchText.indexOf(searchVal) === -1) {
                item.sidebarEl = null;
                return;
            }

            visible++;

            var el = document.createElement('div');
            el.className = 'sidebar-tile-item';
            if (selectedItem === item) el.classList.add('active');

            var dotColor = '#888';
            if (item.type === '_site') dotColor = '#0d6efd';
            else if (item.type === '_location') dotColor = '#1a8a7a';
            else if (TILE_CONFIG[item.type]) dotColor = TILE_CONFIG[item.type].color;

            var label = '';
            if (item.kind === 'site') label = item.data.name || 'Site';
            else if (item.kind === 'location') label = item.data.name || 'Location';
            else if (item.kind === 'tile') label = item.data.label || item.data.type;
            else if (item.kind === 'mapmarker') label = item.data.label || item.data.type;

            // Build icon for the sidebar item
            var iconClass = '';
            if (item.kind === 'site') iconClass = 'mdi-office-building-outline';
            else if (item.kind === 'location') iconClass = 'mdi-map-marker-outline';
            else if (TILE_CONFIG[item.type]) iconClass = TILE_CONFIG[item.type].icon;
            else iconClass = 'mdi-circle';

            el.innerHTML =
                '<span class="sidebar-tile-dot" style="background:' + dotColor + '">' +
                    '<i class="mdi ' + iconClass + '" style="font-size:10px;color:#fff"></i>' +
                '</span>' +
                '<span class="sidebar-tile-label">' + escHtml(label) + '</span>' +
                (item.data.primary_ip ? '<span class="sidebar-tile-ip">' + escHtml(item.data.primary_ip) + '</span>' : '');

            el.addEventListener('click', function () {
                selectItem(item);
                // Pan to marker
                if (item.marker) {
                    var ll = item.marker.getLatLng();
                    map.setView(ll, Math.max(map.getZoom(), 15));
                    item.marker.openPopup();
                }
            });

            sidebarList.appendChild(el);
            item.sidebarEl = el;
        });

        if (sidebarCount) {
            sidebarCount.textContent = visible + ' / ' + total + ' markers';
        }
    }

    function applyFilters() {
        buildSidebarList();
    }

    // Search handler
    if (sidebarSearch) {
        sidebarSearch.addEventListener('input', function () {
            buildSidebarList();
        });
    }

    /* ── Detail Panel ─────────────────────────────────────────────── */
    function selectItem(item) {
        // Deselect previous
        if (selectedItem && selectedItem.sidebarEl) {
            selectedItem.sidebarEl.classList.remove('active');
        }
        selectedItem = item;
        if (item.sidebarEl) {
            item.sidebarEl.classList.add('active');
            // Scroll into view
            item.sidebarEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
        showDetail(item);
    }

    function showDetail(item) {
        if (!sidebarDetail) return;

        if (!item) {
            sidebarDetail.innerHTML =
                '<div class="sidebar-empty-state">' +
                    '<i class="mdi mdi-cursor-default-click-outline"></i>' +
                    '<span>Click a marker to see details</span>' +
                '</div>';
            return;
        }

        var html = '';

        if (item.kind === 'site') {
            html += '<div class="sidebar-section-title">Site</div>';
            html += '<div class="sidebar-detail-list">';
            html += detailRow('Name', '<a href="' + escHtml(item.data.url) + '">' + escHtml(item.data.name) + '</a>');
            if (item.data.status) html += detailRow('Status', escHtml(item.data.status));
            if (item.data.region) html += detailRow('Region', escHtml(item.data.region));
            if (item.data.physical_address) html += detailRow('Address', escHtml(item.data.physical_address));
            html += detailRow('Floor Plans', item.data.floorplan_count || 0);
            html += '</div>';

        } else if (item.kind === 'location') {
            html += '<div class="sidebar-section-title">Location</div>';
            html += '<div class="sidebar-detail-list">';
            html += detailRow('Name', '<a href="' + escHtml(item.data.url) + '">' + escHtml(item.data.name) + '</a>');
            if (item.data.site_name) html += detailRow('Site', escHtml(item.data.site_name));
            html += detailRow('Position', item.data.latitude.toFixed(6) + ', ' + item.data.longitude.toFixed(6));
            html += '</div>';

        } else if (item.kind === 'tile') {
            html += '<div class="sidebar-section-title">Tile</div>';
            html += '<div class="sidebar-detail-list">';
            html += detailRow('Label', escHtml(item.data.label));
            html += detailRow('Type', escHtml(item.data.type));
            if (item.data.site_name) html += detailRow('Site', escHtml(item.data.site_name));
            if (item.data.floorplan_name) html += detailRow('Floor Plan', escHtml(item.data.floorplan_name));
            if (item.data.assigned_object_name) {
                var deviceHtml = item.data.assigned_object_url
                    ? '<a href="' + escHtml(item.data.assigned_object_url) + '">' + escHtml(item.data.assigned_object_name) + '</a>'
                    : escHtml(item.data.assigned_object_name);
                html += detailRow('Device', deviceHtml);
            }
            if (item.data.primary_ip) html += detailRow('IP', '<code>' + escHtml(item.data.primary_ip) + '</code>');
            html += detailRow('Position', item.data.latitude.toFixed(6) + ', ' + item.data.longitude.toFixed(6));
            html += '</div>';

            // Enriched detail placeholder
            if (item.data.assigned_object_type && item.data.assigned_object_id) {
                html += '<div id="enriched-detail" class="sidebar-detail-loading">Loading details\u2026</div>';
            }

            // Remove from map button (only in edit mode)
            if (editMode) {
                html += '<div class="sidebar-detail-actions">';
                html += '<button class="btn btn-sm btn-outline-danger" id="remove-tile-btn">' +
                        '<i class="mdi mdi-map-marker-remove-outline"></i> Remove from Map</button>';
                html += '</div>';
            }

        } else if (item.kind === 'mapmarker') {
            var d = item.data;
            html += '<div class="sidebar-section-title">Map Marker</div>';
            html += '<div class="sidebar-detail-list">';
            html += detailRow('Label', escHtml(d.label));
            html += detailRow('Type', escHtml(d.type));
            html += detailRow('Status', escHtml(d.status));
            if (d.site_name) html += detailRow('Site', escHtml(d.site_name));
            if (d.assigned_object_name) {
                var deviceHtml = d.assigned_object_url
                    ? '<a href="' + escHtml(d.assigned_object_url) + '">' + escHtml(d.assigned_object_name) + '</a>'
                    : escHtml(d.assigned_object_name);
                html += detailRow('Device', deviceHtml);
            }
            if (d.primary_ip) html += detailRow('IP', '<code>' + escHtml(d.primary_ip) + '</code>');
            if (d.description) html += detailRow('Description', escHtml(d.description));
            html += detailRow('Position', d.latitude.toFixed(6) + ', ' + d.longitude.toFixed(6));
            html += '</div>';

            // Enriched detail placeholder
            if (d.assigned_object_type && d.assigned_object_id) {
                html += '<div id="enriched-detail" class="sidebar-detail-loading">Loading details\u2026</div>';
            }

            // Camera FOV controls (only in edit mode)
            if (d.type === 'camera' && editMode) {
                html += '<div class="sidebar-section-title">Camera FOV</div>';
                html += '<div class="sidebar-fov-controls">';
                html += fovField('Direction', 'fov-dir', d.fov_direction, 0, 360, '\u00b0');
                html += fovField('Angle', 'fov-angle', d.fov_angle, 10, 360, '\u00b0');
                html += fovField('Distance', 'fov-dist', d.fov_distance, 1, 50, '');
                html += '<button class="btn btn-sm btn-primary" id="fov-save-btn">' +
                        '<i class="mdi mdi-content-save"></i> Save FOV</button>';
                html += '</div>';
            } else if (d.type === 'camera') {
                html += '<div class="sidebar-section-title">Camera FOV</div>';
                html += '<div class="sidebar-detail-list">';
                html += detailRow('Direction', d.fov_direction + '\u00b0');
                html += detailRow('Angle', d.fov_angle + '\u00b0');
                html += detailRow('Distance', d.fov_distance);
                html += '</div>';
            }

            // Edit/Delete buttons (only in edit mode)
            if (editMode) {
                html += '<div class="sidebar-detail-actions">';
                html += '<a href="/plugins/map/map-markers/' + d.id + '/edit/" class="btn btn-sm btn-outline-primary">' +
                        '<i class="mdi mdi-pencil"></i> Edit</a>';
                html += '<button class="btn btn-sm btn-outline-danger" id="delete-marker-btn">' +
                        '<i class="mdi mdi-trash-can-outline"></i> Delete</button>';
                html += '</div>';
            }
        }

        sidebarDetail.innerHTML = html;

        // Fetch enriched detail via AJAX if item has an assigned object
        var enrichedEl = document.getElementById('enriched-detail');
        if (enrichedEl && item.data && item.data.assigned_object_type && item.data.assigned_object_id) {
            fetchMarkerDetail(item.data.assigned_object_type, item.data.assigned_object_id)
                .then(function (detail) {
                    // Only render if this item is still selected
                    var currentEnrichedEl = document.getElementById('enriched-detail');
                    if (currentEnrichedEl && selectedItem === item) {
                        currentEnrichedEl.classList.remove('sidebar-detail-loading');
                        renderEnrichedDetail(currentEnrichedEl, detail);
                    }
                })
                .catch(function () {
                    var currentEnrichedEl = document.getElementById('enriched-detail');
                    if (currentEnrichedEl && selectedItem === item) {
                        currentEnrichedEl.classList.remove('sidebar-detail-loading');
                        currentEnrichedEl.innerHTML = '';
                    }
                });
        }

        // Wire up FOV controls
        if (item.kind === 'mapmarker' && item.data.type === 'camera' && editMode) {
            var dirInput = document.getElementById('fov-dir');
            var angleInput = document.getElementById('fov-angle');
            var distInput = document.getElementById('fov-dist');
            var saveBtn = document.getElementById('fov-save-btn');

            // Live preview on input change
            function updateFovPreview() {
                var dir = parseInt(dirInput.value) || 0;
                var ang = parseInt(angleInput.value) || 90;
                var dist = parseInt(distInput.value) || 5;

                if (item.fov) map.removeLayer(item.fov);
                item.fov = buildFovPolygon(
                    item.data.latitude, item.data.longitude, dir, ang, dist
                ).addTo(map);
            }

            // Bidirectional slider ↔ number sync
            function syncPair(sliderId, numberId) {
                var slider = document.getElementById(sliderId);
                var number = document.getElementById(numberId);
                if (!slider || !number) return;
                slider.addEventListener('input', function() { number.value = slider.value; updateFovPreview(); });
                number.addEventListener('input', function() { slider.value = number.value; updateFovPreview(); });
            }
            syncPair('fov-dir-slider', 'fov-dir');
            syncPair('fov-angle-slider', 'fov-angle');
            syncPair('fov-dist-slider', 'fov-dist');

            if (saveBtn) {
                saveBtn.addEventListener('click', function () {
                    var dir = parseInt(dirInput.value) || 0;
                    var ang = parseInt(angleInput.value) || 90;
                    var dist = parseInt(distInput.value) || 5;

                    apiRequest(markerApiUrl + item.data.id + '/', 'PATCH', {
                        fov_direction: dir,
                        fov_angle: ang,
                        fov_distance: dist
                    }).then(function () {
                        item.data.fov_direction = dir;
                        item.data.fov_angle = ang;
                        item.data.fov_distance = dist;
                        saveBtn.textContent = 'Saved!';
                        setTimeout(function () {
                            saveBtn.innerHTML = '<i class="mdi mdi-content-save"></i> Save FOV';
                        }, 1200);
                    }).catch(function (err) {
                        console.error('Failed to save FOV:', err);
                        saveBtn.textContent = 'Error';
                    });
                });
            }
        }

        // Wire up delete button for map markers
        var deleteBtn = document.getElementById('delete-marker-btn');
        if (deleteBtn && item.kind === 'mapmarker') {
            deleteBtn.addEventListener('click', function () {
                if (!confirm('Delete marker "' + (item.data.label || item.data.type) + '"?')) return;

                apiRequest(markerApiUrl + item.data.id + '/', 'DELETE').then(function () {
                    if (item.marker) map.removeLayer(item.marker);
                    if (item.fov) map.removeLayer(item.fov);
                    var idx = allItems.indexOf(item);
                    if (idx !== -1) allItems.splice(idx, 1);
                    selectedItem = null;
                    buildToggleButtons();
                    buildSidebarList();
                    showDetail(null);
                }).catch(function (err) {
                    console.error('Failed to delete marker:', err);
                    alert('Failed to delete: ' + err.message);
                });
            });
        }

        // Wire up "Remove from Map" button for tiles
        var removeTileBtn = document.getElementById('remove-tile-btn');
        if (removeTileBtn && item.kind === 'tile') {
            removeTileBtn.addEventListener('click', function () {
                if (!confirm('Remove "' + (item.data.label || item.data.type) + '" from the map? (The tile still exists on its floor plan.)')) return;

                apiRequest(tileApiUrl + item.data.id + '/', 'PATCH', {
                    latitude: null,
                    longitude: null
                }).then(function () {
                    // Remove from map
                    if (item.marker) map.removeLayer(item.marker);
                    // Add back to unplaced list
                    unplacedTiles.push(item.data);
                    if (tilesSelect) {
                        populateSelect(tilesSelect, unplacedTiles, function (t) {
                            var suffix = '';
                            if (t.floorplan_name) suffix = ' [' + t.floorplan_name + ']';
                            else if (t.site_name) suffix = ' [' + t.site_name + ']';
                            return t.label + ' (' + t.type + ')' + suffix;
                        });
                    }
                    // Remove from sidebar
                    var idx = allItems.indexOf(item);
                    if (idx !== -1) allItems.splice(idx, 1);
                    selectedItem = null;
                    buildToggleButtons();
                    buildSidebarList();
                    showDetail(null);
                }).catch(function (err) {
                    console.error('Failed to remove tile from map:', err);
                    alert('Failed to remove: ' + err.message);
                });
            });
        }
    }

    function detailRow(label, value) {
        return '<div class="detail-row">' +
               '<span class="detail-label">' + label + '</span>' +
               '<span class="detail-value">' + value + '</span>' +
               '</div>';
    }

    function fovField(label, id, value, min, max, suffix) {
        return '<div class="fov-slider-group">' +
               '<label>' + label + '</label>' +
               '<input type="range" id="' + id + '-slider" min="' + min + '" max="' + max + '" value="' + value + '" step="5">' +
               '<input type="number" id="' + id + '" class="form-control form-control-sm fov-number" ' +
               'value="' + value + '" min="' + min + '" max="' + max + '">' +
               (suffix ? '<span class="fov-unit">' + suffix + '</span>' : '') +
               '</div>';
    }

    /* ── AJAX enriched detail ─────────────────────────────────────── */
    function fetchMarkerDetail(objectType, objectId) {
        return fetch(detailBaseUrl + objectType + '/' + objectId + '/')
            .then(function (r) {
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.json();
            });
    }

    function renderEnrichedDetail(targetEl, detail) {
        var html = '';

        // MAC address
        if (detail.mac_address) {
            html += '<div class="sidebar-detail-list">';
            html += detailRow('MAC', '<code>' + escHtml(detail.mac_address) + '</code>');
            html += '</div>';
        }

        // Standard fields
        if (detail.standard_fields && detail.standard_fields.length) {
            html += '<div class="sidebar-detail-section">Details</div>';
            html += '<div class="sidebar-detail-list">';
            detail.standard_fields.forEach(function (f) {
                html += detailRow(escHtml(f.label), escHtml(f.value));
            });
            html += '</div>';
        }

        // Custom fields
        if (detail.custom_fields && detail.custom_fields.length) {
            html += '<div class="sidebar-detail-section">Custom Fields</div>';
            html += '<div class="sidebar-detail-list">';
            var currentGroup = null;
            detail.custom_fields.forEach(function (f) {
                if (f.group && f.group !== currentGroup) {
                    currentGroup = f.group;
                    html += '</div>';
                    html += '<div class="sidebar-detail-section" style="padding-top:4px">' + escHtml(f.group) + '</div>';
                    html += '<div class="sidebar-detail-list">';
                }
                html += detailRow(escHtml(f.label), escHtml(f.value));
            });
            html += '</div>';
        }

        if (html) {
            targetEl.innerHTML = html;
        } else {
            targetEl.innerHTML = '';
        }
    }

    // Initial sidebar build
    buildToggleButtons();
    buildSidebarList();

    // Auto-select nearest marker when opened via ?q=lat,lng (Maps URL)
    if (!isNaN(focusLat) && !isNaN(focusLng)) {
        var focusPoint = L.latLng(focusLat, focusLng);
        var closestItem = null;
        var closestDist = Infinity;
        allItems.forEach(function (item) {
            if (!item.marker) return;
            var d = focusPoint.distanceTo(item.marker.getLatLng());
            if (d < closestDist) {
                closestDist = d;
                closestItem = item;
            }
        });
        if (closestItem) {
            selectItem(closestItem);
            if (closestItem.marker) closestItem.marker.openPopup();
        }
    }

    /* ══════════════════════════════════════════════════════════════════
       PLACEMENT MODE (edit only)
       ══════════════════════════════════════════════════════════════════ */
    if (!canEdit) return;

    // Populate unplaced dropdowns
    function populateSelect(selectEl, items, labelFn) {
        while (selectEl.options.length > 1) selectEl.remove(1);
        items.forEach(function (item) {
            var opt = document.createElement('option');
            opt.value = item.id;
            opt.textContent = labelFn(item);
            selectEl.appendChild(opt);
        });
    }

    populateSelect(sitesSelect, unplacedSites, function (s) {
        return s.name + (s.region ? ' (' + s.region + ')' : '');
    });
    populateSelect(locationsSelect, unplacedLocations, function (l) {
        return l.name + (l.site_name ? ' (' + l.site_name + ')' : '');
    });
    populateSelect(tilesSelect, unplacedTiles, function (t) {
        var suffix = '';
        if (t.floorplan_name) suffix = ' [' + t.floorplan_name + ']';
        else if (t.site_name) suffix = ' [' + t.site_name + ']';
        return t.label + ' (' + t.type + ')' + suffix;
    });

    // Enable/disable buttons based on selection
    if (sitesSelect) {
        sitesSelect.addEventListener('change', function () {
            placeSiteBtn.disabled = !sitesSelect.value;
        });
    }
    if (locationsSelect) {
        locationsSelect.addEventListener('change', function () {
            placeLocBtn.disabled = !locationsSelect.value;
        });
    }
    if (tilesSelect) {
        tilesSelect.addEventListener('change', function () {
            placeTileBtn.disabled = !tilesSelect.value;
        });
    }

    function enterPlacementMode(mode, item) {
        placementMode = mode;
        placementItem = item;
        container.classList.add('placing');
        var label = item.name || item.label || mode;
        statusEl.textContent = 'Click the map to place "' + label + '"...';
        cancelBtn.classList.remove('d-none');
    }

    function exitPlacementMode() {
        placementMode = null;
        placementItem = null;
        container.classList.remove('placing');
        if (statusEl) statusEl.textContent = '';
        if (cancelBtn) cancelBtn.classList.add('d-none');
    }

    // Place Site button
    if (placeSiteBtn) {
        placeSiteBtn.addEventListener('click', function () {
            var val = sitesSelect.value;
            if (!val) return;
            var site = null;
            for (var i = 0; i < unplacedSites.length; i++) {
                if (String(unplacedSites[i].id) === val) { site = unplacedSites[i]; break; }
            }
            if (site) enterPlacementMode('site', site);
        });
    }

    // Place Location button
    if (placeLocBtn) {
        placeLocBtn.addEventListener('click', function () {
            var val = locationsSelect.value;
            if (!val) return;
            var loc = null;
            for (var i = 0; i < unplacedLocations.length; i++) {
                if (String(unplacedLocations[i].id) === val) { loc = unplacedLocations[i]; break; }
            }
            if (loc) enterPlacementMode('location', loc);
        });
    }

    // Place Tile button
    if (placeTileBtn) {
        placeTileBtn.addEventListener('click', function () {
            var val = tilesSelect.value;
            if (!val) return;
            var tile = null;
            for (var i = 0; i < unplacedTiles.length; i++) {
                if (String(unplacedTiles[i].id) === val) { tile = unplacedTiles[i]; break; }
            }
            if (tile) {
                tile.name = tile.label || tile.type;
                enterPlacementMode('tile', tile);
            }
        });
    }

    // Add Marker button → enters placement mode for new marker
    if (addMarkerBtn) {
        addMarkerBtn.addEventListener('click', function () {
            var mType = newMarkerType.value || 'camera';
            var mLabel = newMarkerLabel.value.trim();
            enterPlacementMode('marker', {
                marker_type: mType,
                label: mLabel,
                name: mLabel || (TILE_CONFIG[mType] ? TILE_CONFIG[mType].label : mType)
            });
        });
    }

    // Cancel
    if (cancelBtn) {
        cancelBtn.addEventListener('click', exitPlacementMode);
    }

    // ESC key
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && placementMode) exitPlacementMode();
    });

    // Map click → place item
    map.on('click', function (e) {
        if (!placementMode || !placementItem) return;

        var lat = e.latlng.lat.toFixed(6);
        var lng = e.latlng.lng.toFixed(6);
        var item = placementItem;
        var mode = placementMode;

        statusEl.textContent = 'Saving...';

        if (mode === 'site') {
            apiRequest(siteApiUrl + item.id + '/', 'PATCH', {
                latitude: lat,
                longitude: lng
            }).then(function () {
                item.latitude = parseFloat(lat);
                item.longitude = parseFloat(lng);
                createSiteMarker(item);

                unplacedSites = unplacedSites.filter(function (s) { return s.id !== item.id; });
                populateSelect(sitesSelect, unplacedSites, function (s) {
                    return s.name + (s.region ? ' (' + s.region + ')' : '');
                });
                placeSiteBtn.disabled = true;
                exitPlacementMode();
                buildToggleButtons();
                buildSidebarList();
                // Re-apply edit mode to new marker
                setEditMode(editMode);
            }).catch(function (err) {
                console.error('Failed to place site:', err);
                statusEl.textContent = 'Error: ' + err.message;
            });

        } else if (mode === 'location') {
            apiRequest(locCoordsApiUrl, 'POST', {
                location: item.id,
                latitude: lat,
                longitude: lng
            }).then(function (data) {
                var locData = {
                    id: data.id,
                    location_id: item.id,
                    name: item.name,
                    site_name: item.site_name || '',
                    latitude: parseFloat(lat),
                    longitude: parseFloat(lng),
                    url: ''
                };
                createLocationMarker(locData);

                unplacedLocations = unplacedLocations.filter(function (l) { return l.id !== item.id; });
                populateSelect(locationsSelect, unplacedLocations, function (l) {
                    return l.name + (l.site_name ? ' (' + l.site_name + ')' : '');
                });
                placeLocBtn.disabled = true;
                exitPlacementMode();
                buildToggleButtons();
                buildSidebarList();
                setEditMode(editMode);
            }).catch(function (err) {
                console.error('Failed to place location:', err);
                statusEl.textContent = 'Error: ' + err.message;
            });

        } else if (mode === 'tile') {
            apiRequest(tileApiUrl + item.id + '/', 'PATCH', {
                latitude: lat,
                longitude: lng
            }).then(function () {
                item.latitude = parseFloat(lat);
                item.longitude = parseFloat(lng);
                createTileMarker(item);

                unplacedTiles = unplacedTiles.filter(function (t) { return t.id !== item.id; });
                populateSelect(tilesSelect, unplacedTiles, function (t) {
                    var suffix = '';
                    if (t.floorplan_name) suffix = ' [' + t.floorplan_name + ']';
                    else if (t.site_name) suffix = ' [' + t.site_name + ']';
                    return t.label + ' (' + t.type + ')' + suffix;
                });
                placeTileBtn.disabled = true;
                exitPlacementMode();
                buildToggleButtons();
                buildSidebarList();
                setEditMode(editMode);
            }).catch(function (err) {
                console.error('Failed to place tile:', err);
                statusEl.textContent = 'Error: ' + err.message;
            });

        } else if (mode === 'marker') {
            // Create a NEW MapMarker via POST
            var body = {
                latitude: lat,
                longitude: lng,
                marker_type: item.marker_type,
                label: item.label || '',
                status: 'active'
            };

            apiRequest(markerApiUrl, 'POST', body).then(function (data) {
                var newMarkerData = {
                    id: data.id,
                    label: data.label || '',
                    type: data.marker_type,
                    status: data.status,
                    latitude: parseFloat(data.latitude),
                    longitude: parseFloat(data.longitude),
                    site_id: data.site ? data.site.id : null,
                    site_name: data.site ? data.site.display : '',
                    primary_ip: null,
                    fov_direction: data.fov_direction || 0,
                    fov_angle: data.fov_angle || 90,
                    fov_distance: data.fov_distance || 5,
                    assigned_object_type: null,
                    assigned_object_id: null,
                    assigned_object_name: null,
                    description: data.description || ''
                };

                var newItem = createMapMarker(newMarkerData);
                exitPlacementMode();
                buildToggleButtons();
                buildSidebarList();
                selectItem(newItem);
                setEditMode(editMode);
                // Clear label input
                if (newMarkerLabel) newMarkerLabel.value = '';
            }).catch(function (err) {
                console.error('Failed to create marker:', err);
                statusEl.textContent = 'Error: ' + err.message;
            });
        }
    });

})();
