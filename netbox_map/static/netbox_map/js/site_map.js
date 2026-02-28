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
    var cablePaths         = parseJSON('data-cable-paths');

    var canEdit   = container.getAttribute('data-can-edit') === 'true';
    var csrfToken = container.getAttribute('data-csrf-token') || '';
    var siteApiUrl      = container.getAttribute('data-site-api-url') || '/api/dcim/sites/';
    var locCoordsApiUrl  = container.getAttribute('data-loc-coords-api-url') || '';
    var tileApiUrl       = container.getAttribute('data-tile-api-url') || '';
    var markerApiUrl     = container.getAttribute('data-marker-api-url') || '';
    var cableApiUrl      = container.getAttribute('data-cable-api-url') || '';
    var cableSplitBaseUrl = container.getAttribute('data-cable-split-base-url') || '/plugins/map/cable-paths/';
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

    // Cable drawing
    var drawCableBtn    = document.getElementById('draw-cable-btn');

    /* ── Sidebar elements ─────────────────────────────────────────── */
    var sidebarSearch   = document.getElementById('sidebar-search');
    var sidebarToggles  = document.getElementById('sidebar-toggles');
    var sidebarCount    = document.getElementById('sidebar-count');
    var sidebarList     = document.getElementById('sidebar-list');
    var sidebarDetail   = document.getElementById('sidebar-detail');

    /* ── Placement state ──────────────────────────────────────────── */
    var placementMode = null;   // null | 'site' | 'location' | 'tile' | 'marker'
    var placementItem = null;

    /* ── Cable drawing state ─────────────────────────────────────── */
    var cableDrawing = false;
    var cableDrawCoords = [];
    var cableDrawPolyline = null;  // temporary polyline during drawing
    var allCableItems = [];         // { data, polyline, sidebarEl }
    var selectedCable = null;
    var editingCable = null;        // cable currently being vertex-edited

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
    var hasItems = placedSites.length || locations.length || tiles.length || mapMarkers.length || cablePaths.length;
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

    var streets = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19
    });
    var satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Esri World Imagery',
        maxZoom: 19
    });
    streets.addTo(map);
    L.control.layers({ 'Street': streets, 'Satellite': satellite }).addTo(map);

    // Toggle satellite-active class for dark mode tile filter override
    map.on('baselayerchange', function (e) {
        if (e.name === 'Satellite') {
            container.classList.add('satellite-active');
        } else {
            container.classList.remove('satellite-active');
        }
    });

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
            if (!item.marker) return;
            // Leaflet only creates marker.dragging when draggable:true,
            // so we set the option first then toggle the handler.
            item.marker.options.draggable = on;
            if (item.marker.dragging) {
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
            draggable: canEdit,     // init handler; toggled by setEditMode
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
            draggable: canEdit,     // init handler; toggled by setEditMode
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
            draggable: canEdit      // init handler; toggled by setEditMode
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

    /* ── Helpers: find cables connected to a marker ──────────────── */
    function getConnectedCables(markerId) {
        var cables = [];
        allCableItems.forEach(function (ci) {
            if (ci.data.start_marker_id === markerId || ci.data.end_marker_id === markerId) {
                cables.push(ci);
            }
        });
        return cables;
    }

    function updateCableEndpointsForMarker(markerId, newLat, newLng) {
        allCableItems.forEach(function (ci) {
            var coords = ci.data.path_coordinates;
            if (!coords || coords.length < 2) return;
            var changed = false;

            if (ci.data.start_marker_id === markerId) {
                coords[0] = [newLat, newLng];
                changed = true;
            }
            if (ci.data.end_marker_id === markerId) {
                coords[coords.length - 1] = [newLat, newLng];
                changed = true;
            }

            if (changed && ci.polyline) {
                ci.polyline.setLatLngs(coords.map(function (c) {
                    return L.latLng(c[0], c[1]);
                }));
            }
        });
    }

    function saveCableEndpointsForMarker(markerId) {
        allCableItems.forEach(function (ci) {
            if (ci.data.start_marker_id === markerId || ci.data.end_marker_id === markerId) {
                apiRequest(cableApiUrl + ci.data.id + '/', 'PATCH', {
                    path_coordinates: ci.data.path_coordinates
                }).catch(function (err) {
                    console.error('Failed to update cable path:', err);
                });
            }
        });
    }

    /* ── Junction ring: visual indicator for cable-connected markers */
    function updateJunctionRing(item) {
        var el = item.marker && item.marker.getElement && item.marker.getElement();
        if (!el) return;
        var dot = el.querySelector('.site-marker--tile');
        if (!dot) return;
        var cables = getConnectedCables(item.data.id);
        if (cables.length > 0) {
            dot.classList.add('cable-junction');
        } else {
            dot.classList.remove('cable-junction');
        }
    }

    function updateAllJunctionRings() {
        allItems.forEach(function (item) {
            if (item.kind === 'mapmarker') {
                updateJunctionRing(item);
            }
        });
    }

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
            draggable: canEdit      // init handler; toggled by setEditMode
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
            var dragHoveredCable = null;

            // Live drag: update connected cable endpoints + highlight nearby cable
            marker.on('drag', function () {
                var pos = marker.getLatLng();
                updateCableEndpointsForMarker(m.id, parseFloat(pos.lat.toFixed(6)), parseFloat(pos.lng.toFixed(6)));

                // Highlight nearest unconnected cable for snap-to-split
                var near = findNearestCableAtPoint(pos, 30);
                // Don't highlight cables already connected to this marker
                if (near && (near.data.start_marker_id === m.id || near.data.end_marker_id === m.id)) {
                    near = null;
                }
                if (near !== dragHoveredCable) {
                    if (dragHoveredCable && dragHoveredCable.polyline) {
                        var prevW = getCableDisplayWeight(dragHoveredCable.data);
                        dragHoveredCable.polyline.setStyle({ weight: prevW, dashArray: null });
                    }
                    dragHoveredCable = near;
                    if (dragHoveredCable && dragHoveredCable.polyline) {
                        dragHoveredCable.polyline.setStyle({ weight: 6, dashArray: '8 4' });
                    }
                }
            });

            marker.on('dragend', function () {
                var pos = marker.getLatLng();

                // Clear cable highlight
                if (dragHoveredCable && dragHoveredCable.polyline) {
                    var prevW = getCableDisplayWeight(dragHoveredCable.data);
                    dragHoveredCable.polyline.setStyle({ weight: prevW, dashArray: null });
                }
                var targetCable = dragHoveredCable;
                dragHoveredCable = null;

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
                    // Persist cable endpoint positions for already-connected cables
                    saveCableEndpointsForMarker(m.id);

                    // If dropped on an unconnected cable → split it
                    if (targetCable) {
                        splitCableAtMarker(targetCable, m.id).then(function () {
                            buildCableSidebar();
                            setTimeout(updateAllJunctionRings, 50);
                            showDetail(item);
                        });
                    } else {
                        showSavedBadge(marker);
                    }
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

    /* ══════════════════════════════════════════════════════════════════
       CABLE PATHS — polyline rendering, drawing, editing, split
       ══════════════════════════════════════════════════════════════════ */

    var CABLE_STATUS_COLORS = {
        planned: '#95a5a6',
        active: '#2ecc71',
        in_progress: '#f39c12',
        inactive: '#e74c3c'
    };

    function getCableColor(status) {
        return CABLE_STATUS_COLORS[status] || '#95a5a6';
    }

    function getCableDisplayColor(cp) {
        return cp.color || cp.display_color || cp.status_color || getCableColor(cp.status);
    }

    function getCableDisplayWeight(cp) {
        return cp.weight || 3;
    }

    function createCablePolyline(cp) {
        if (!cp.path_coordinates || cp.path_coordinates.length < 2) return null;

        var latlngs = cp.path_coordinates.map(function (c) {
            return L.latLng(c[0], c[1]);
        });

        var color = getCableDisplayColor(cp);
        var lineWeight = getCableDisplayWeight(cp);

        // Invisible wider polyline for easier clicking (hit area)
        var hitArea = L.polyline(latlngs, {
            color: '#000',
            weight: Math.max(lineWeight + 14, 18),
            opacity: 0,
            interactive: true
        }).addTo(map);

        var polyline = L.polyline(latlngs, {
            color: color,
            weight: lineWeight,
            opacity: 0.8
        }).addTo(map);

        var tooltip = (cp.label || 'Cable #' + cp.id) + ' (' + cp.fiber_count + 'F)';
        polyline.bindTooltip(tooltip, { sticky: true });

        var cableItem = {
            kind: 'cable',
            data: cp,
            polyline: polyline,
            hitArea: hitArea,
            vertexMarkers: [],
            sidebarEl: null
        };
        allCableItems.push(cableItem);

        function onCableClick(e) {
            L.DomEvent.stopPropagation(e);
            selectCable(cableItem);
        }
        polyline.on('click', onCableClick);
        hitArea.on('click', onCableClick);

        // Extend bounds
        latlngs.forEach(function (ll) {
            extendBounds(ll.lat, ll.lng);
        });

        return cableItem;
    }

    // Render all existing cable paths
    cablePaths.forEach(function (cp) {
        createCablePolyline(cp);
    });

    /* ── Auto-snap: find nearest marker within threshold ─────────── */
    function findNearestMarker(lat, lng, thresholdMeters) {
        var best = null;
        var bestDist = Infinity;
        var point = L.latLng(lat, lng);

        allItems.forEach(function (item) {
            if (item.kind !== 'mapmarker') return;
            var mll = L.latLng(item.data.latitude, item.data.longitude);
            var d = point.distanceTo(mll);
            if (d < thresholdMeters && d < bestDist) {
                bestDist = d;
                best = item;
            }
        });
        return best;
    }

    /* ── Pixel-based snap: zoom-independent, consistent screen distance */
    function findNearestMarkerPx(lat, lng, thresholdPx) {
        var best = null;
        var bestDist = Infinity;
        var pt = map.latLngToContainerPoint(L.latLng(lat, lng));

        allItems.forEach(function (item) {
            if (item.kind !== 'mapmarker') return;
            var mPt = map.latLngToContainerPoint(L.latLng(item.data.latitude, item.data.longitude));
            var dx = pt.x - mPt.x;
            var dy = pt.y - mPt.y;
            var d = Math.sqrt(dx * dx + dy * dy);
            if (d < thresholdPx && d < bestDist) {
                bestDist = d;
                best = item;
            }
        });
        return best;
    }

    /* ── Cable drawing mode ──────────────────────────────────────── */
    function startCableDrawing() {
        cableDrawing = true;
        cableDrawCoords = [];
        container.classList.add('placing');
        map.doubleClickZoom.disable();
        if (drawCableBtn) {
            drawCableBtn.classList.add('active');
            drawCableBtn.style.backgroundColor = '#0dcaf0';
            drawCableBtn.style.color = '#000';
        }
        if (statusEl) statusEl.textContent = 'Click to add points. Double-click or Enter to finish. Escape to cancel.';
        if (cancelBtn) cancelBtn.classList.remove('d-none');
    }

    function finishCableDrawing() {
        // Remove duplicate trailing points from double-click
        while (cableDrawCoords.length > 1) {
            var last = cableDrawCoords[cableDrawCoords.length - 1];
            var prev = cableDrawCoords[cableDrawCoords.length - 2];
            if (Math.abs(last[0] - prev[0]) < 0.00001 && Math.abs(last[1] - prev[1]) < 0.00001) {
                cableDrawCoords.pop();
            } else {
                break;
            }
        }

        if (cableDrawCoords.length < 2) {
            cancelCableDrawing();
            return;
        }

        // Auto-snap endpoints to nearest markers (25px screen distance)
        var startSnap = findNearestMarkerPx(cableDrawCoords[0][0], cableDrawCoords[0][1], 25);
        var endSnap = findNearestMarkerPx(
            cableDrawCoords[cableDrawCoords.length - 1][0],
            cableDrawCoords[cableDrawCoords.length - 1][1],
            25
        );

        // Prevent snapping both ends to the same marker
        if (startSnap && endSnap && startSnap.data.id === endSnap.data.id) {
            endSnap = null;
        }

        if (startSnap) {
            cableDrawCoords[0] = [startSnap.data.latitude, startSnap.data.longitude];
        }
        if (endSnap) {
            cableDrawCoords[cableDrawCoords.length - 1] = [endSnap.data.latitude, endSnap.data.longitude];
        }

        // Update preview polyline
        if (cableDrawPolyline) {
            cableDrawPolyline.setLatLngs(cableDrawCoords.map(function (c) {
                return L.latLng(c[0], c[1]);
            }));
        }

        var body = {
            path_coordinates: cableDrawCoords,
            fiber_count: 12,
            status: 'planned',
            label: ''
        };
        if (startSnap) body.start_marker = startSnap.data.id;
        if (endSnap) body.end_marker = endSnap.data.id;

        if (statusEl) statusEl.textContent = 'Saving cable...';

        apiRequest(cableApiUrl, 'POST', body).then(function (data) {
            // Remove temp polyline
            if (cableDrawPolyline) {
                map.removeLayer(cableDrawPolyline);
                cableDrawPolyline = null;
            }

            var cpData = {
                id: data.id,
                label: data.label || '',
                path_coordinates: data.path_coordinates,
                fiber_count: data.fiber_count,
                status: data.status,
                status_color: getCableColor(data.status),
                color: data.color || '',
                weight: data.weight || 3,
                display_color: data.display_color || getCableColor(data.status),
                start_marker_id: data.start_marker ? data.start_marker.id : null,
                end_marker_id: data.end_marker ? data.end_marker.id : null,
                start_marker_label: data.start_marker ? data.start_marker.display : '',
                end_marker_label: data.end_marker ? data.end_marker.display : ''
            };

            var newItem = createCablePolyline(cpData);
            cancelCableDrawing();
            buildCableSidebar();
            setTimeout(updateAllJunctionRings, 50);
            if (newItem) selectCable(newItem);
        }).catch(function (err) {
            console.error('Failed to create cable:', err);
            if (statusEl) statusEl.textContent = 'Error: ' + err.message;
        });
    }

    function cancelCableDrawing() {
        cableDrawing = false;
        cableDrawCoords = [];
        if (cableDrawPolyline) {
            map.removeLayer(cableDrawPolyline);
            cableDrawPolyline = null;
        }
        container.classList.remove('placing');
        map.doubleClickZoom.enable();
        if (drawCableBtn) {
            drawCableBtn.classList.remove('active');
            drawCableBtn.style.backgroundColor = '';
            drawCableBtn.style.color = '';
        }
        if (statusEl) statusEl.textContent = '';
        if (cancelBtn) cancelBtn.classList.add('d-none');
    }

    /* ── Cable selection and detail ──────────────────────────────── */
    function clearVertexEditing(ci) {
        if (!ci) return;
        if (ci.vertexMarkers) {
            ci.vertexMarkers.forEach(function (vm) { map.removeLayer(vm); });
            ci.vertexMarkers = [];
        }
        if (editingCable === ci) editingCable = null;
    }

    function selectCable(cableItem) {
        // Deselect any marker
        if (selectedItem && selectedItem.sidebarEl) {
            selectedItem.sidebarEl.classList.remove('active');
        }
        selectedItem = null;

        // Deselect previous cable + clear vertex editing
        if (selectedCable && selectedCable !== cableItem) {
            clearVertexEditing(selectedCable);
            if (selectedCable.polyline) {
                var prevColor = getCableDisplayColor(selectedCable.data);
                var prevWeight = getCableDisplayWeight(selectedCable.data);
                selectedCable.polyline.setStyle({ weight: prevWeight, color: prevColor });
            }
            if (selectedCable.sidebarEl) selectedCable.sidebarEl.classList.remove('active');
        }

        selectedCable = cableItem;
        if (cableItem.polyline) {
            cableItem.polyline.setStyle({ weight: Math.max(getCableDisplayWeight(cableItem.data) + 2, 5), color: '#fff' });
            // Fit view to cable
            map.fitBounds(cableItem.polyline.getBounds(), { padding: [60, 60], maxZoom: map.getZoom() });
        }
        if (cableItem.sidebarEl) {
            cableItem.sidebarEl.classList.add('active');
            cableItem.sidebarEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }

        showCableDetail(cableItem);
    }

    function showCableDetail(cableItem) {
        if (!sidebarDetail) return;
        var d = cableItem.data;
        var html = '<div class="sidebar-section-title">Cable Path</div>';
        html += '<div class="sidebar-detail-list">';
        html += detailRow('Label', escHtml(d.label) || '<span class="text-muted">\u2014</span>');
        html += detailRow('Status', '<span class="badge" style="background:' + getCableColor(d.status) + ';color:#fff;font-size:11px">' + escHtml(d.status) + '</span>');
        html += detailRow('Fibers', d.fiber_count);
        html += detailRow('Weight', d.weight || 3);
        if (d.color) {
            html += detailRow('Color', '<span class="cable-color-swatch" style="background:' + escHtml(d.color) + '"></span> ' + escHtml(d.color));
        }
        html += detailRow('Points', d.path_coordinates ? d.path_coordinates.length : 0);
        if (d.start_marker_label) {
            html += detailRow('Start', escHtml(d.start_marker_label));
        }
        if (d.end_marker_label) {
            html += detailRow('End', escHtml(d.end_marker_label));
        }
        html += '</div>';

        if (editMode) {
            html += '<div class="sidebar-section-title">Edit Cable</div>';
            html += '<div class="sidebar-detail-list">';
            html += '<div class="sidebar-detail-row"><span class="detail-label">Label</span>';
            html += '<input type="text" id="cable-edit-label" class="form-control form-control-sm" value="' + escHtml(d.label) + '" style="width:140px;display:inline-block"></div>';
            html += '<div class="sidebar-detail-row"><span class="detail-label">Fibers</span>';
            html += '<input type="number" id="cable-edit-fibers" class="form-control form-control-sm" value="' + d.fiber_count + '" min="1" style="width:80px;display:inline-block"></div>';
            html += '<div class="sidebar-detail-row"><span class="detail-label">Status</span>';
            html += '<select id="cable-edit-status" class="form-select form-select-sm" style="width:140px;display:inline-block">';
            ['planned', 'in_progress', 'active', 'inactive'].forEach(function (s) {
                html += '<option value="' + s + '"' + (d.status === s ? ' selected' : '') + '>' + s + '</option>';
            });
            html += '</select></div>';

            // Color picker
            html += '<div class="sidebar-detail-row"><span class="detail-label">Color</span>';
            html += '<div class="cable-color-edit">';
            html += '<input type="color" id="cable-edit-color" class="cable-color-picker" value="' + (d.color || getCableColor(d.status)) + '">';
            html += '<label class="cable-color-auto"><input type="checkbox" id="cable-color-auto"' + (d.color ? '' : ' checked') + '> Auto</label>';
            html += '</div></div>';

            // Weight slider
            html += '<div class="sidebar-detail-row"><span class="detail-label">Width</span>';
            html += '<div class="cable-weight-edit">';
            html += '<input type="range" id="cable-edit-weight" min="1" max="10" value="' + (d.weight || 3) + '" class="cable-weight-slider">';
            html += '<span id="cable-weight-value" class="cable-weight-value">' + (d.weight || 3) + '</span>';
            html += '</div></div>';

            html += '</div>';

            html += '<div class="sidebar-detail-actions">';
            html += '<button class="btn btn-sm btn-primary" id="cable-save-btn"><i class="mdi mdi-content-save"></i> Save</button>';
            var isEditing = editingCable === cableItem;
            html += '<button class="btn btn-sm ' + (isEditing ? 'btn-warning' : 'btn-outline-info') + '" id="cable-edit-path-btn">' +
                    '<i class="mdi mdi-vector-polyline-edit"></i> ' + (isEditing ? 'Done Editing' : 'Edit Path') + '</button>';
            html += '<button class="btn btn-sm btn-outline-danger" id="cable-delete-btn"><i class="mdi mdi-trash-can-outline"></i> Delete</button>';
            html += '</div>';
        }

        sidebarDetail.innerHTML = html;

        // Wire up edit controls
        if (editMode) {
            // Live preview for color and weight
            var colorInput = document.getElementById('cable-edit-color');
            var colorAuto = document.getElementById('cable-color-auto');
            var weightSlider = document.getElementById('cable-edit-weight');
            var weightValue = document.getElementById('cable-weight-value');

            if (colorInput && colorAuto) {
                colorInput.disabled = colorAuto.checked;
                colorAuto.addEventListener('change', function () {
                    colorInput.disabled = colorAuto.checked;
                    if (colorAuto.checked) {
                        // Preview with status color
                        if (cableItem.polyline) {
                            cableItem.polyline.setStyle({ color: getCableColor(d.status) });
                        }
                    } else {
                        if (cableItem.polyline) {
                            cableItem.polyline.setStyle({ color: colorInput.value });
                        }
                    }
                });
                colorInput.addEventListener('input', function () {
                    if (!colorAuto.checked && cableItem.polyline) {
                        cableItem.polyline.setStyle({ color: colorInput.value });
                    }
                });
            }

            if (weightSlider && weightValue) {
                weightSlider.addEventListener('input', function () {
                    weightValue.textContent = weightSlider.value;
                    if (cableItem.polyline) {
                        cableItem.polyline.setStyle({ weight: parseInt(weightSlider.value) });
                    }
                });
            }

            var saveBtn = document.getElementById('cable-save-btn');
            if (saveBtn) {
                saveBtn.addEventListener('click', function () {
                    var newLabel = document.getElementById('cable-edit-label').value;
                    var newFibers = parseInt(document.getElementById('cable-edit-fibers').value) || 12;
                    var newStatus = document.getElementById('cable-edit-status').value;
                    var newColor = (colorAuto && colorAuto.checked) ? '' : (colorInput ? colorInput.value : '');
                    var newWeight = weightSlider ? parseInt(weightSlider.value) : 3;

                    apiRequest(cableApiUrl + d.id + '/', 'PATCH', {
                        label: newLabel,
                        fiber_count: newFibers,
                        status: newStatus,
                        color: newColor,
                        weight: newWeight
                    }).then(function () {
                        d.label = newLabel;
                        d.fiber_count = newFibers;
                        d.status = newStatus;
                        d.color = newColor;
                        d.weight = newWeight;
                        d.status_color = getCableColor(newStatus);
                        d.display_color = newColor || getCableColor(newStatus);
                        // Update polyline style
                        if (cableItem.polyline) {
                            var displayColor = getCableDisplayColor(d);
                            cableItem.polyline.setStyle({ color: displayColor, weight: newWeight });
                            var tooltip = (newLabel || 'Cable #' + d.id) + ' (' + newFibers + 'F)';
                            cableItem.polyline.unbindTooltip();
                            cableItem.polyline.bindTooltip(tooltip, { sticky: true });
                        }
                        saveBtn.innerHTML = '<i class="mdi mdi-check"></i> Saved!';
                        setTimeout(function () {
                            saveBtn.innerHTML = '<i class="mdi mdi-content-save"></i> Save';
                        }, 1200);
                        buildCableSidebar();
                    }).catch(function (err) {
                        console.error('Failed to save cable:', err);
                        alert('Error: ' + err.message);
                    });
                });
            }

            var deleteBtn = document.getElementById('cable-delete-btn');
            if (deleteBtn) {
                deleteBtn.addEventListener('click', function () {
                    if (!confirm('Delete cable "' + (d.label || 'Cable #' + d.id) + '"?')) return;

                    apiRequest(cableApiUrl + d.id + '/', 'DELETE').then(function () {
                        clearVertexEditing(cableItem);
                        if (cableItem.polyline) map.removeLayer(cableItem.polyline);
                        if (cableItem.hitArea) map.removeLayer(cableItem.hitArea);
                        var idx = allCableItems.indexOf(cableItem);
                        if (idx !== -1) allCableItems.splice(idx, 1);
                        selectedCable = null;
                        buildCableSidebar();
                        showDetail(null);
                    }).catch(function (err) {
                        console.error('Failed to delete cable:', err);
                        alert('Error: ' + err.message);
                    });
                });
            }

            // Edit Path — toggle vertex editing
            var editPathBtn = document.getElementById('cable-edit-path-btn');
            if (editPathBtn) {
                editPathBtn.addEventListener('click', function () {
                    if (editingCable === cableItem) {
                        // Stop editing — save path and clear vertex markers
                        finishVertexEditing(cableItem);
                    } else {
                        // Start editing — show vertex markers
                        if (editingCable) finishVertexEditing(editingCable);
                        startVertexEditing(cableItem);
                    }
                    showCableDetail(cableItem);
                });
            }
        }
    }

    /* ── Vertex editing — drag cable vertices on the map ─────────── */
    function startVertexEditing(cableItem) {
        editingCable = cableItem;
        var coords = cableItem.data.path_coordinates;
        if (!coords || coords.length < 2) return;

        // Restore cable to its normal color (not selected white)
        var displayColor = getCableDisplayColor(cableItem.data);
        cableItem.polyline.setStyle({ color: displayColor, weight: getCableDisplayWeight(cableItem.data), dashArray: '6 3' });

        cableItem.vertexMarkers = [];

        // Create draggable vertex markers
        coords.forEach(function (c, idx) {
            var isEndpoint = (idx === 0 || idx === coords.length - 1);
            var vm = L.circleMarker(L.latLng(c[0], c[1]), {
                radius: isEndpoint ? 7 : 5,
                color: '#fff',
                fillColor: isEndpoint ? '#0d6efd' : '#ffc107',
                fillOpacity: 1,
                weight: 2,
                interactive: true,
                bubblingMouseEvents: false
            }).addTo(map);

            // Make it draggable via custom drag handling
            vm._vertexIdx = idx;
            vm._cableItem = cableItem;
            enableVertexDrag(vm, cableItem, idx);

            cableItem.vertexMarkers.push(vm);
        });

        // Add midpoint markers for inserting new vertices
        for (var i = 0; i < coords.length - 1; i++) {
            (function (segIdx) {
                var midLat = (coords[segIdx][0] + coords[segIdx + 1][0]) / 2;
                var midLng = (coords[segIdx][1] + coords[segIdx + 1][1]) / 2;
                var midMarker = L.circleMarker(L.latLng(midLat, midLng), {
                    radius: 4,
                    color: '#fff',
                    fillColor: '#6c757d',
                    fillOpacity: 0.6,
                    weight: 1,
                    interactive: true,
                    bubblingMouseEvents: false,
                    className: 'cable-midpoint-marker'
                }).addTo(map);

                midMarker.on('click', function (e) {
                    L.DomEvent.stopPropagation(e);
                    // Insert a new vertex at this midpoint
                    coords.splice(segIdx + 1, 0, [midLat, midLng]);
                    // Rebuild vertex markers
                    clearVertexEditing(cableItem);
                    editingCable = cableItem; // re-set since clearVertexEditing resets it
                    updateCablePolyline(cableItem);
                    startVertexEditing(cableItem);
                    showCableDetail(cableItem);
                });

                cableItem.vertexMarkers.push(midMarker);
            })(i);
        }
    }

    function enableVertexDrag(vm, cableItem, idx) {
        var dragging = false;
        var snapTarget = null;   // allItems entry we're hovering near

        vm.on('mousedown', function (e) {
            dragging = true;
            snapTarget = null;
            map.dragging.disable();
            L.DomEvent.stopPropagation(e);
            L.DomEvent.preventDefault(e);

            function onMove(ev) {
                if (!dragging) return;
                var lat = parseFloat(ev.latlng.lat.toFixed(6));
                var lng = parseFloat(ev.latlng.lng.toFixed(6));

                // Check for nearby marker to snap to (25px screen distance)
                var near = findNearestMarkerPx(lat, lng, 25);
                if (near !== snapTarget) {
                    // Remove previous highlight
                    if (snapTarget) {
                        var prevEl = snapTarget.marker && snapTarget.marker.getElement();
                        if (prevEl) prevEl.classList.remove('snap-target');
                    }
                    snapTarget = near;
                    if (snapTarget) {
                        var el = snapTarget.marker && snapTarget.marker.getElement();
                        if (el) el.classList.add('snap-target');
                    }
                }

                // If snapping, show vertex at marker position
                if (snapTarget) {
                    vm.setLatLng(L.latLng(snapTarget.data.latitude, snapTarget.data.longitude));
                    var coords = cableItem.data.path_coordinates;
                    coords[idx] = [snapTarget.data.latitude, snapTarget.data.longitude];
                } else {
                    vm.setLatLng(ev.latlng);
                    var coords = cableItem.data.path_coordinates;
                    coords[idx] = [lat, lng];
                }
                updateCablePolyline(cableItem);
            }

            function onUp() {
                dragging = false;
                map.dragging.enable();
                map.off('mousemove', onMove);
                map.off('mouseup', onUp);

                // Clear snap highlight
                if (snapTarget) {
                    var el = snapTarget.marker && snapTarget.marker.getElement();
                    if (el) el.classList.remove('snap-target');
                }

                // If endpoint snapped to a marker, update cable FK
                var coords = cableItem.data.path_coordinates;
                var isFirst = (idx === 0);
                var isLast = (idx === coords.length - 1);

                if (snapTarget && (isFirst || isLast)) {
                    var fkField = isFirst ? 'start_marker' : 'end_marker';
                    var idField = isFirst ? 'start_marker_id' : 'end_marker_id';
                    var labelField = isFirst ? 'start_marker_label' : 'end_marker_label';

                    cableItem.data[idField] = snapTarget.data.id;
                    cableItem.data[labelField] = snapTarget.data.label || snapTarget.data.type;

                    // Persist the FK now (path_coordinates saved on finishVertexEditing)
                    var patch = {};
                    patch[fkField] = snapTarget.data.id;
                    apiRequest(cableApiUrl + cableItem.data.id + '/', 'PATCH', patch).then(function () {
                        setTimeout(updateAllJunctionRings, 50);
                    }).catch(function (err) {
                        console.error('Failed to update cable marker FK:', err);
                    });
                }

                snapTarget = null;
            }

            map.on('mousemove', onMove);
            map.on('mouseup', onUp);
        });
    }

    function updateCablePolyline(cableItem) {
        var latlngs = cableItem.data.path_coordinates.map(function (c) {
            return L.latLng(c[0], c[1]);
        });
        cableItem.polyline.setLatLngs(latlngs);
        if (cableItem.hitArea) cableItem.hitArea.setLatLngs(latlngs);
    }

    function finishVertexEditing(cableItem) {
        // Save coordinates to backend
        apiRequest(cableApiUrl + cableItem.data.id + '/', 'PATCH', {
            path_coordinates: cableItem.data.path_coordinates
        }).then(function () {
            // Restore normal style
            var displayColor = getCableDisplayColor(cableItem.data);
            cableItem.polyline.setStyle({ dashArray: null, color: displayColor });
        }).catch(function (err) {
            console.error('Failed to save cable path:', err);
        });

        clearVertexEditing(cableItem);
    }

    /* ── Cable sidebar section ───────────────────────────────────── */
    function buildCableSidebar() {
        // Find or create the cables section in sidebar
        var cablesSection = document.getElementById('sidebar-cables-section');
        if (!cablesSection) {
            cablesSection = document.createElement('div');
            cablesSection.id = 'sidebar-cables-section';
            cablesSection.className = 'sidebar-cables-section';
            // Insert before the detail panel
            if (sidebarDetail && sidebarDetail.parentNode) {
                sidebarDetail.parentNode.insertBefore(cablesSection, sidebarDetail);
            }
        }

        if (allCableItems.length === 0) {
            cablesSection.innerHTML = '';
            return;
        }

        var html = '<div class="sidebar-section-title" style="padding:6px 12px;font-size:10px;text-transform:uppercase;letter-spacing:0.5px;color:var(--fp-text-muted,#6c757d);opacity:0.7;border-top:1px solid var(--fp-border-light,rgba(0,0,0,0.06));margin-top:4px">' +
            '<i class="mdi mdi-vector-polyline"></i> Cables (' + allCableItems.length + ')</div>';
        html += '<div class="sidebar-cable-list" style="max-height:150px;overflow-y:auto">';

        allCableItems.forEach(function (item, idx) {
            var d = item.data;
            var isActive = selectedCable === item;
            html += '<div class="sidebar-tile-item' + (isActive ? ' active' : '') + '" data-cable-idx="' + idx + '">';
            html += '<span class="sidebar-tile-dot" style="background:' + getCableDisplayColor(d) + ';border-radius:2px">' +
                '<i class="mdi mdi-vector-polyline" style="font-size:10px;color:#fff"></i></span>';
            html += '<span class="sidebar-tile-label">' + escHtml(d.label || 'Cable #' + d.id) + '</span>';
            html += '<span class="sidebar-tile-ip" style="font-size:10px;color:var(--fp-text-muted,#6c757d)">' + d.fiber_count + 'F</span>';
            html += '</div>';
        });

        html += '</div>';
        cablesSection.innerHTML = html;

        // Wire up click handlers
        var cableEls = cablesSection.querySelectorAll('[data-cable-idx]');
        cableEls.forEach(function (el) {
            el.addEventListener('click', function () {
                var idx = parseInt(el.getAttribute('data-cable-idx'));
                if (allCableItems[idx]) {
                    selectCable(allCableItems[idx]);
                }
            });
        });

        // Update sidebar element references
        allCableItems.forEach(function (item, idx) {
            item.sidebarEl = cableEls[idx] || null;
        });
    }

    /* ── Drop marker on cable (split) ────────────────────────────── */
    function findNearestCableAtPoint(latlng, thresholdPx) {
        var best = null;
        var bestDist = Infinity;

        allCableItems.forEach(function (item) {
            var coords = item.data.path_coordinates;
            if (!coords || coords.length < 2) return;

            for (var i = 0; i < coords.length - 1; i++) {
                var a = map.latLngToContainerPoint(L.latLng(coords[i][0], coords[i][1]));
                var b = map.latLngToContainerPoint(L.latLng(coords[i + 1][0], coords[i + 1][1]));
                var p = map.latLngToContainerPoint(latlng);
                var d = pointToSegmentDistance(p, a, b);
                if (d < thresholdPx && d < bestDist) {
                    bestDist = d;
                    best = item;
                }
            }
        });

        return best;
    }

    function pointToSegmentDistance(p, a, b) {
        var dx = b.x - a.x;
        var dy = b.y - a.y;
        if (dx === 0 && dy === 0) {
            return Math.sqrt((p.x - a.x) * (p.x - a.x) + (p.y - a.y) * (p.y - a.y));
        }
        var t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy);
        t = Math.max(0, Math.min(1, t));
        var nx = a.x + t * dx;
        var ny = a.y + t * dy;
        return Math.sqrt((p.x - nx) * (p.x - nx) + (p.y - ny) * (p.y - ny));
    }

    /* Highlight cable under cursor during marker placement */
    var hoveredCable = null;

    function onMapMoveForCableHighlight(e) {
        if (!editMode || !placementMode) return;
        var near = findNearestCableAtPoint(e.latlng, 30);
        if (near !== hoveredCable) {
            if (hoveredCable && hoveredCable.polyline) {
                hoveredCable.polyline.setStyle({ weight: 3, dashArray: null });
            }
            hoveredCable = near;
            if (hoveredCable && hoveredCable.polyline) {
                hoveredCable.polyline.setStyle({ weight: 6, dashArray: '8 4' });
            }
        }
    }

    /* ── Wire up cable drawing button ────────────────────────────── */
    if (drawCableBtn) {
        drawCableBtn.addEventListener('click', function () {
            if (cableDrawing) {
                cancelCableDrawing();
            } else {
                exitPlacementMode();
                startCableDrawing();
            }
        });
    }

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

            // Connected Cables section
            var connectedCables = getConnectedCables(d.id);
            if (connectedCables.length > 0) {
                html += '<div class="sidebar-section-title">Connected Cables (' + connectedCables.length + ')</div>';
                html += '<div class="sidebar-connected-cables">';
                connectedCables.forEach(function (ci, idx) {
                    var cd = ci.data;
                    var role = cd.start_marker_id === d.id ? 'start' : 'end';
                    html += '<div class="connected-cable-row">';
                    html += '<span class="cable-color-swatch" style="background:' + getCableDisplayColor(cd) + '"></span>';
                    html += '<span class="connected-cable-label">' + escHtml(cd.label || 'Cable #' + cd.id) + '</span>';
                    html += '<span class="connected-cable-role">' + role + '</span>';
                    if (editMode) {
                        html += '<button class="btn btn-xs btn-outline-warning detach-cable-btn" data-cable-id="' + cd.id + '" data-role="' + role + '" title="Detach">' +
                                '<i class="mdi mdi-link-variant-off"></i></button>';
                    }
                    html += '</div>';
                });
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

        // Wire up detach cable buttons for map markers
        if (item.kind === 'mapmarker' && editMode) {
            var detachBtns = sidebarDetail.querySelectorAll('.detach-cable-btn');
            detachBtns.forEach(function (btn) {
                btn.addEventListener('click', function () {
                    var cableId = parseInt(btn.getAttribute('data-cable-id'));
                    var role = btn.getAttribute('data-role');
                    var patchData = {};
                    patchData[role === 'start' ? 'start_marker' : 'end_marker'] = null;

                    apiRequest(cableApiUrl + cableId + '/', 'PATCH', patchData).then(function () {
                        // Update local data
                        allCableItems.forEach(function (ci) {
                            if (ci.data.id === cableId) {
                                if (role === 'start') {
                                    ci.data.start_marker_id = null;
                                    ci.data.start_marker_label = '';
                                } else {
                                    ci.data.end_marker_id = null;
                                    ci.data.end_marker_label = '';
                                }
                            }
                        });
                        // Refresh junction ring and detail panel
                        updateJunctionRing(item);
                        showDetail(item);
                        buildCableSidebar();
                    }).catch(function (err) {
                        console.error('Failed to detach cable:', err);
                        alert('Error: ' + err.message);
                    });
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

    // Markers are created with draggable:canEdit so the handler gets
    // initialized, but edit mode starts OFF — disable dragging now.
    if (canEdit) setEditMode(false);

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
        if (e.key === 'Escape') {
            if (cableDrawing) cancelCableDrawing();
            else if (placementMode) exitPlacementMode();
        }
        if (e.key === 'Enter' && cableDrawing) {
            finishCableDrawing();
        }
    });

    // Cable drawing: mousemove for highlight
    map.on('mousemove', function (e) {
        onMapMoveForCableHighlight(e);
    });

    // Cable drawing: double-click to finish
    map.on('dblclick', function (e) {
        if (cableDrawing) {
            L.DomEvent.stopPropagation(e);
            L.DomEvent.preventDefault(e);
            finishCableDrawing();
        }
    });

    // Map click → cable drawing or place item
    map.on('click', function (e) {
        // Cable drawing mode: add point
        if (cableDrawing) {
            var clat = parseFloat(e.latlng.lat.toFixed(6));
            var clng = parseFloat(e.latlng.lng.toFixed(6));
            cableDrawCoords.push([clat, clng]);

            if (cableDrawPolyline) {
                cableDrawPolyline.addLatLng(e.latlng);
            } else {
                cableDrawPolyline = L.polyline([e.latlng], {
                    color: '#95a5a6',
                    weight: 3,
                    dashArray: '6 4',
                    opacity: 0.9
                }).addTo(map);
            }

            if (statusEl) statusEl.textContent = cableDrawCoords.length + ' points. Double-click or Enter to finish.';
            return;
        }

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
            // Check if dropping on a cable (split)
            var targetCable = findNearestCableAtPoint(e.latlng, 30);

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

                // If we dropped on a cable, split it
                if (targetCable) {
                    if (hoveredCable && hoveredCable.polyline) {
                        hoveredCable.polyline.setStyle({ weight: 3, dashArray: null });
                        hoveredCable = null;
                    }
                    splitCableAtMarker(targetCable, data.id).then(function () {
                        buildToggleButtons();
                        buildSidebarList();
                        buildCableSidebar();
                        selectItem(newItem);
                        setEditMode(editMode);
                    });
                } else {
                    buildToggleButtons();
                    buildSidebarList();
                    selectItem(newItem);
                    setEditMode(editMode);
                }
                // Clear label input
                if (newMarkerLabel) newMarkerLabel.value = '';
            }).catch(function (err) {
                console.error('Failed to create marker:', err);
                statusEl.textContent = 'Error: ' + err.message;
            });
        }
    });

    /* ── Split cable at marker (POST to backend) ──────────────────── */
    function splitCableAtMarker(cableItem, markerId) {
        return apiRequest(cableSplitBaseUrl + cableItem.data.id + '/split/', 'POST', {
            marker_id: markerId
        }).then(function (result) {
            // Remove the old polyline and hit area
            clearVertexEditing(cableItem);
            if (cableItem.polyline) map.removeLayer(cableItem.polyline);
            if (cableItem.hitArea) map.removeLayer(cableItem.hitArea);
            var idx = allCableItems.indexOf(cableItem);
            if (idx !== -1) allCableItems.splice(idx, 1);

            // Create two new cables
            createCablePolyline(result.cable_a);
            createCablePolyline(result.cable_b);

            buildCableSidebar();
            setTimeout(updateAllJunctionRings, 50);
        }).catch(function (err) {
            console.error('Failed to split cable:', err);
        });
    }

    /* ── Initialize cable sidebar ────────────────────────────────── */
    buildCableSidebar();

    /* ── Initialize junction rings on cable-connected markers ──── */
    // Use a short delay to ensure marker DOM elements are rendered
    setTimeout(function () {
        updateAllJunctionRings();
    }, 100);

})();
