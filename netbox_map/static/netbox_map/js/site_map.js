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
    var statusEl        = document.getElementById('placement-status');
    var cancelBtn       = document.getElementById('cancel-placement-btn');

    // Chip trays
    var chipTrayPlace   = document.getElementById('chip-tray-place');
    var chipTrayCreate  = document.getElementById('chip-tray-create');

    // Tile search
    var tileSearchInput   = document.getElementById('tile-search-input');
    var tileSearchResults = document.getElementById('tile-search-results');

    // Cable drawing
    var drawCableBtn    = document.getElementById('draw-cable-btn');

    /* ── Sidebar elements ─────────────────────────────────────────── */
    var sidebarSearch   = document.getElementById('sidebar-search');
    var sidebarToggles  = document.getElementById('sidebar-toggles');
    var sidebarCount    = document.getElementById('sidebar-count');
    var sidebarList     = document.getElementById('sidebar-list');
    var sidebarDetail   = document.getElementById('sidebar-detail');
    var panelList       = document.getElementById('sidebar-panel-list');
    var panelDetail     = document.getElementById('sidebar-panel-detail');
    var detailBackBtn   = document.getElementById('sidebar-detail-back');

    /* ── Sidebar tab switching ─────────────────────────────────────── */
    var tabMarkers      = document.getElementById('sidebar-tab-markers');
    var tabCables       = document.getElementById('sidebar-tab-cables');
    var activeSidebarTab = 'markers';

    function switchSidebarTab(tab) {
        if (tab === activeSidebarTab) return;
        activeSidebarTab = tab;
        var tabs = document.querySelectorAll('#sidebar-tabs .sidebar-tab');
        tabs.forEach(function (b) {
            b.classList.toggle('active', b.getAttribute('data-tab') === tab);
        });
        if (tab === 'markers') {
            if (tabMarkers) tabMarkers.classList.remove('d-none');
            if (tabCables) tabCables.classList.add('d-none');
        } else {
            if (tabMarkers) tabMarkers.classList.add('d-none');
            if (tabCables) tabCables.classList.remove('d-none');
        }
    }

    (function initSidebarTabs() {
        var tabs = document.querySelectorAll('#sidebar-tabs .sidebar-tab');
        tabs.forEach(function (btn) {
            btn.addEventListener('click', function () {
                switchSidebarTab(btn.getAttribute('data-tab'));
            });
        });
    })();

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
    // Resolve `auto` icon foreground using a luma threshold — matches
    // CustomMarkerType.resolved_icon_foreground() on the backend.
    function resolveIconFg(fg, bg) {
        if (fg === 'light' || fg === 'dark') return fg;
        var c = (bg || '').replace('#', '');
        if (c.length !== 6) return 'light';
        var r = parseInt(c.substring(0, 2), 16);
        var g = parseInt(c.substring(2, 4), 16);
        var b = parseInt(c.substring(4, 6), 16);
        return (0.2126 * r + 0.7152 * g + 0.0722 * b) > 160 ? 'dark' : 'light';
    }
    var TILE_CONFIG = {};
    TYPE_CONFIGS_RAW.forEach(function(tc) {
        TILE_CONFIG[tc.slug] = {
            color: tc.color,
            icon: tc.icon,
            label: tc.name,
            iconFg: resolveIconFg(tc.icon_fg, tc.color),
        };
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

    // Custom tile layer that fetches tiles via fetch() so the browser sends a
    // Referer header — required by the OSM tile usage policy (#25).
    var ReferrerTileLayer = L.TileLayer.extend({
        createTile: function (coords, done) {
            var tile = document.createElement('img');
            tile.alt = '';
            tile.setAttribute('role', 'presentation');
            var url = this.getTileUrl(coords);
            fetch(url, { referrerPolicy: 'origin' })
                .then(function (r) { return r.blob(); })
                .then(function (blob) {
                    var objectUrl = URL.createObjectURL(blob);
                    tile.onload = function () { URL.revokeObjectURL(objectUrl); };
                    tile.src = objectUrl;
                    done(null, tile);
                })
                .catch(function (err) { done(err, tile); });
            return tile;
        }
    });

    var streets = new ReferrerTileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
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
            html: '<div class="site-marker--tile" style="background:' + cfg.color + ';color:' + (cfg.iconFg === 'dark' ? '#1a1a1a' : '#fff') + '"><i class="mdi ' + cfg.icon + '"></i></div>',
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
            html: '<div class="site-marker--tile" style="background:' + cfg.color + ';color:' + (cfg.iconFg === 'dark' ? '#1a1a1a' : '#fff') + '"><i class="mdi ' + cfg.icon + '"></i></div>',
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

    /* ── Cable type helpers ─────────────────────────────────────── */
    var CABLE_TYPE_LABELS = {
        'cat3': 'CAT3', 'cat5': 'CAT5', 'cat5e': 'CAT5e', 'cat6': 'CAT6',
        'cat6a': 'CAT6a', 'cat7': 'CAT7', 'cat7a': 'CAT7a', 'cat8': 'CAT8',
        'mrj21-trunk': 'MRJ21',
        'dac-active': 'DAC (Active)', 'dac-passive': 'DAC (Passive)',
        'coaxial': 'Coaxial', 'rg-6': 'RG-6', 'rg-8': 'RG-8', 'rg-11': 'RG-11',
        'rg-59': 'RG-59', 'rg-62': 'RG-62', 'rg-213': 'RG-213',
        'lmr-100': 'LMR-100', 'lmr-200': 'LMR-200', 'lmr-400': 'LMR-400',
        'mmf': 'MMF', 'mmf-om1': 'OM1', 'mmf-om2': 'OM2', 'mmf-om3': 'OM3',
        'mmf-om4': 'OM4', 'mmf-om5': 'OM5',
        'smf': 'SMF', 'smf-os1': 'OS1', 'smf-os2': 'OS2',
        'aoc': 'AOC', 'power': 'Power', 'usb': 'USB'
    };

    var COPPER_TYPES = [
        'cat3', 'cat5', 'cat5e', 'cat6', 'cat6a', 'cat7', 'cat7a', 'cat8', 'mrj21-trunk',
        'dac-active', 'dac-passive'
    ];
    var FIBER_TYPES = [
        'mmf', 'mmf-om1', 'mmf-om2', 'mmf-om3', 'mmf-om4', 'mmf-om5',
        'smf', 'smf-os1', 'smf-os2'
    ];
    var COAX_TYPES = [
        'coaxial', 'rg-6', 'rg-8', 'rg-11', 'rg-59', 'rg-62', 'rg-213',
        'lmr-100', 'lmr-200', 'lmr-400'
    ];

    function getCableTypeLabel(type) {
        if (!type) return '';
        return CABLE_TYPE_LABELS[type] || type.toUpperCase();
    }

    function isFiberType(type) {
        return !type || FIBER_TYPES.indexOf(type) !== -1;
    }
    function isCopperType(type) {
        return COPPER_TYPES.indexOf(type) !== -1;
    }

    function formatCableCount(type, count) {
        if (!count || count <= 0) return null;
        if (isFiberType(type)) return count + 'F';
        if (isCopperType(type)) return count + ' pairs';
        // coaxial, aoc, power, usb — no count suffix
        return null;
    }

    function computeCableLength(coords) {
        if (!coords || coords.length < 2) return 0;
        var total = 0;
        for (var i = 1; i < coords.length; i++) {
            var a = L.latLng(coords[i - 1][0], coords[i - 1][1]);
            var b = L.latLng(coords[i][0], coords[i][1]);
            total += a.distanceTo(b);
        }
        return total;
    }

    function formatCableLength(meters) {
        if (meters >= 1000) return (meters / 1000).toFixed(2) + ' km';
        return Math.round(meters) + ' m';
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

        var tooltipParts = [cp.label || 'Cable #' + cp.id];
        var typeLabel = getCableTypeLabel(cp.cable_type);
        var countLabel = formatCableCount(cp.cable_type, cp.fiber_count);
        if (typeLabel || countLabel) {
            var sub = [typeLabel, countLabel].filter(Boolean).join(' \u00b7 ');
            tooltipParts.push('(' + sub + ')');
        }
        polyline.bindTooltip(tooltipParts.join(' '), { sticky: true });

        var cableItem = {
            kind: 'cable',
            data: cp,
            polyline: polyline,
            hitArea: hitArea,
            vertexMarkers: [],
            sidebarEl: null,
            labelMarkers: null,
            displayLabel: null
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

    /* ── Cable path labels (street-name style, repeated along path) ── */
    /*
     * Uses Leaflet DivIcon markers positioned along the polyline path.
     * Works with any renderer (Canvas or SVG).
     * - Multiple labels spaced evenly based on path pixel length
     * - Recalculated on zoom so density stays readable
     * - Rotated to follow the path direction
     * - Always right-side-up
     */

    var MAX_LABELS_PER_CABLE = 40;

    function addCableLabel(cableItem) {
        var cp = cableItem.data;
        if (!cp.label) return;

        var labelCount = formatCableCount(cp.cable_type, cp.fiber_count);
        cableItem.displayLabel = cp.label + (labelCount ? ' \u00b7 ' + labelCount : '');
        cableItem.labelMarkers = [];

        updateCableLabelPositions(cableItem);
    }

    /**
     * Compute geographic positions along a path for evenly-spaced labels.
     * Uses geographic distance for placement, pixel space only for angle + count.
     */
    function computePathLabels(coords, displayLabel) {
        if (!coords || coords.length < 2) return [];

        // Build geographic segments with cumulative distance
        var geoSegs = [];
        var totalGeo = 0;
        for (var i = 1; i < coords.length; i++) {
            var a = L.latLng(coords[i - 1][0], coords[i - 1][1]);
            var b = L.latLng(coords[i][0], coords[i][1]);
            var d = a.distanceTo(b); // meters
            geoSegs.push({ len: d, cumStart: totalGeo });
            totalGeo += d;
        }
        if (totalGeo < 1) return [];

        // Use pixel space to decide how many labels fit at current zoom
        var p0 = map.latLngToLayerPoint(L.latLng(coords[0][0], coords[0][1]));
        var pN = map.latLngToLayerPoint(L.latLng(coords[coords.length - 1][0], coords[coords.length - 1][1]));
        var approxPxLen = Math.sqrt(Math.pow(pN.x - p0.x, 2) + Math.pow(pN.y - p0.y, 2));

        // Quick sum of all segment pixel lengths for better accuracy
        var totalPx = 0;
        for (var j = 1; j < coords.length; j++) {
            var pa = map.latLngToLayerPoint(L.latLng(coords[j - 1][0], coords[j - 1][1]));
            var pb = map.latLngToLayerPoint(L.latLng(coords[j][0], coords[j][1]));
            totalPx += Math.sqrt(Math.pow(pb.x - pa.x, 2) + Math.pow(pb.y - pa.y, 2));
        }

        if (totalPx < 60) return []; // too short on screen

        // Tighter spacing at higher zoom — like Google Maps street names
        var zoom = map.getZoom();
        var labelW = displayLabel.length * 7;
        // At zoom 10: ~250px apart.  At zoom 18+: ~120px apart.
        var baseSpacing = Math.max(250 - (zoom - 10) * 16, 120);
        var spacing = Math.max(labelW + 40, baseSpacing);
        var count = Math.max(1, Math.floor(totalPx / spacing));
        count = Math.min(count, MAX_LABELS_PER_CABLE);

        // Place labels evenly along geographic path
        var step = totalGeo / (count + 1);
        var placements = [];

        for (var k = 1; k <= count; k++) {
            var dist = step * k;

            // Find which segment contains this distance
            var seg = 0;
            for (var si = 0; si < geoSegs.length; si++) {
                if (geoSegs[si].cumStart + geoSegs[si].len >= dist) {
                    seg = si;
                    break;
                }
            }

            var t = geoSegs[seg].len > 0
                ? (dist - geoSegs[seg].cumStart) / geoSegs[seg].len
                : 0;

            var lat = coords[seg][0] + t * (coords[seg + 1][0] - coords[seg][0]);
            var lng = coords[seg][1] + t * (coords[seg + 1][1] - coords[seg][1]);

            // Angle: use layer points of this segment's endpoints
            var ptA = map.latLngToLayerPoint(L.latLng(coords[seg][0], coords[seg][1]));
            var ptB = map.latLngToLayerPoint(L.latLng(coords[seg + 1][0], coords[seg + 1][1]));
            var angle = Math.atan2(ptB.y - ptA.y, ptB.x - ptA.x) * 180 / Math.PI;

            // Keep right-side-up
            if (angle > 90) angle -= 180;
            if (angle < -90) angle += 180;

            placements.push({ lat: lat, lng: lng, angle: angle });
        }

        return placements;
    }

    function updateCableLabelPositions(cableItem) {
        if (!cableItem.displayLabel) return;

        var coords = cableItem.data.path_coordinates;
        var placements = computePathLabels(coords, cableItem.displayLabel);
        var label = cableItem.displayLabel;
        var markers = cableItem.labelMarkers;

        // Estimated label width for centering the icon anchor
        var estW = label.length * 7;
        var estH = 14;

        for (var i = 0; i < Math.max(placements.length, markers.length); i++) {
            if (i < placements.length) {
                var p = placements[i];
                var latlng = L.latLng(p.lat, p.lng);
                var html = '<span class="cable-path-label-text" style="transform:rotate(' +
                    p.angle.toFixed(1) + 'deg)">' + escHtml(label) + '</span>';
                var icon = L.divIcon({
                    className: 'cable-path-label-wrap',
                    html: html,
                    iconSize: [estW, estH],
                    iconAnchor: [estW / 2, estH / 2]
                });

                if (i < markers.length) {
                    markers[i].setLatLng(latlng);
                    markers[i].setIcon(icon);
                } else {
                    var m = L.marker(latlng, {
                        icon: icon,
                        interactive: false,
                        zIndexOffset: -1000
                    }).addTo(map);
                    markers.push(m);
                }
            } else if (i < markers.length) {
                map.removeLayer(markers[i]);
            }
        }
        // Trim excess
        if (markers.length > placements.length) {
            markers.length = placements.length;
        }
    }

    function removeCableLabel(cableItem) {
        if (cableItem.labelMarkers) {
            for (var i = 0; i < cableItem.labelMarkers.length; i++) {
                map.removeLayer(cableItem.labelMarkers[i]);
            }
        }
        cableItem.labelMarkers = null;
        cableItem.displayLabel = null;
    }

    // Recalculate labels on zoom and pan (angles change on zoom, visibility on pan)
    map.on('zoomend moveend', function () {
        allCableItems.forEach(function (ci) {
            if (ci.displayLabel) updateCableLabelPositions(ci);
        });
    });

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
            cable_type: '',
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
                cable_type: data.cable_type || '',
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
            if (newItem) addCableLabel(newItem);
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
        }

        showCableDetail(cableItem);
        showDetailPanel();
        switchSidebarTab('cables');
    }

    function showCableDetail(cableItem) {
        if (!sidebarDetail) return;
        var d = cableItem.data;
        var html = '<div class="sidebar-section-title">Cable Path</div>';
        html += '<div class="sidebar-detail-list">';
        html += detailRow('Label', escHtml(d.label) || '<span class="text-muted">\u2014</span>');
        html += detailRow('Status', '<span class="badge" style="background:' + getCableColor(d.status) + ';color:#fff;font-size:11px">' + escHtml(d.status) + '</span>');
        if (d.cable_type) {
            html += detailRow('Type', escHtml(getCableTypeLabel(d.cable_type)));
        }
        var detailCount = formatCableCount(d.cable_type, d.fiber_count);
        if (detailCount) {
            html += detailRow(isFiberType(d.cable_type) ? 'Fibers' : 'Pairs', detailCount);
        }
        var cableLen = computeCableLength(d.path_coordinates);
        if (cableLen > 0) {
            html += detailRow('Length', formatCableLength(cableLen));
        }
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
            html += '<div class="sidebar-detail-row"><span class="detail-label">Type</span>';
            html += '<select id="cable-edit-type" class="form-select form-select-sm" style="width:140px;display:inline-block">';
            html += '<option value=""' + (!d.cable_type ? ' selected' : '') + '>\u2014</option>';
            Object.keys(CABLE_TYPE_LABELS).forEach(function (k) {
                html += '<option value="' + k + '"' + (d.cable_type === k ? ' selected' : '') + '>' + CABLE_TYPE_LABELS[k] + '</option>';
            });
            html += '</select></div>';
            html += '<div class="sidebar-detail-row"><span class="detail-label">' + (isCopperType(d.cable_type) ? 'Pairs' : 'Fibers') + '</span>';
            html += '<input type="number" id="cable-edit-fibers" class="form-control form-control-sm" value="' + d.fiber_count + '" min="0" style="width:80px;display:inline-block"></div>';
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
                    var newType = document.getElementById('cable-edit-type').value;
                    var newFibersVal = parseInt(document.getElementById('cable-edit-fibers').value);
                    var newFibers = isNaN(newFibersVal) ? 0 : newFibersVal;
                    var newStatus = document.getElementById('cable-edit-status').value;
                    var newColor = (colorAuto && colorAuto.checked) ? '' : (colorInput ? colorInput.value : '');
                    var newWeight = weightSlider ? parseInt(weightSlider.value) : 3;

                    apiRequest(cableApiUrl + d.id + '/', 'PATCH', {
                        label: newLabel,
                        cable_type: newType,
                        fiber_count: newFibers,
                        status: newStatus,
                        color: newColor,
                        weight: newWeight
                    }).then(function () {
                        d.label = newLabel;
                        d.cable_type = newType;
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
                            var tParts = [newLabel || 'Cable #' + d.id];
                            var tType = getCableTypeLabel(newType);
                            var tCount = formatCableCount(newType, newFibers);
                            if (tType || tCount) tParts.push('(' + [tType, tCount].filter(Boolean).join(' \u00b7 ') + ')');
                            cableItem.polyline.unbindTooltip();
                            cableItem.polyline.bindTooltip(tParts.join(' '), { sticky: true });
                        }
                        // Update path label
                        removeCableLabel(cableItem);
                        addCableLabel(cableItem);
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
                        removeCableLabel(cableItem);
                        if (cableItem.polyline) map.removeLayer(cableItem.polyline);
                        if (cableItem.hitArea) map.removeLayer(cableItem.hitArea);
                        var idx = allCableItems.indexOf(cableItem);
                        if (idx !== -1) allCableItems.splice(idx, 1);
                        selectedCable = null;
                        buildCableSidebar();
                        showListPanel();
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
        // Use the dedicated cables tab container
        var cablesSection = tabCables;
        if (!cablesSection) return;

        if (allCableItems.length === 0) {
            cablesSection.innerHTML = '<div style="padding:12px;text-align:center;color:var(--fp-text-muted,#6c757d);font-size:12px">No cables</div>';
            updateTabBadges();
            return;
        }

        var html = '<div class="sidebar-cable-list-wrap">';
        html += '<div class="sidebar-cable-list">';

        allCableItems.forEach(function (item, idx) {
            var d = item.data;
            var isActive = selectedCable === item;
            html += '<div class="sidebar-tile-item' + (isActive ? ' active' : '') + '" data-cable-idx="' + idx + '">';
            html += '<span class="sidebar-tile-dot" style="background:' + getCableDisplayColor(d) + ';border-radius:2px">' +
                '<i class="mdi mdi-vector-polyline" style="font-size:10px;color:#fff"></i></span>';
            html += '<span class="sidebar-tile-label">' + escHtml(d.label || 'Cable #' + d.id) + '</span>';
            var sidebarType = getCableTypeLabel(d.cable_type);
            var sidebarCount = formatCableCount(d.cable_type, d.fiber_count);
            var sidebarMeta = [sidebarType, sidebarCount].filter(Boolean).join(' \u00b7 ');
            html += '<span class="sidebar-tile-ip" style="font-size:10px;color:var(--fp-text-muted,#6c757d)">' + escHtml(sidebarMeta || '') + '</span>';
            html += '</div>';
        });

        html += '</div>';
        html += '</div>';
        cablesSection.innerHTML = html;
        updateTabBadges();

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

    function updateTabBadges() {
        var tabs = document.querySelectorAll('#sidebar-tabs .sidebar-tab');
        tabs.forEach(function (btn) {
            var tab = btn.getAttribute('data-tab');
            var count = tab === 'markers' ? allItems.length : allCableItems.length;
            var icon = tab === 'markers' ? 'mdi-map-marker' : 'mdi-vector-polyline';
            var label = tab === 'markers' ? 'Markers' : 'Cables';
            btn.innerHTML = '<i class="mdi ' + icon + '"></i> ' + label + ' (' + count + ')';
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

    // Initialize cable path labels now that map view is set
    allCableItems.forEach(function (ci) {
        addCableLabel(ci);
    });

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
        updateTabBadges();
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

    /* ── Sidebar panel switching ──────────────────────────────────── */
    function showListPanel() {
        if (panelList)   panelList.classList.remove('d-none');
        if (panelDetail) panelDetail.classList.add('d-none');

        // Deselect current item/cable
        if (selectedItem && selectedItem.sidebarEl) {
            selectedItem.sidebarEl.classList.remove('active');
        }
        selectedItem = null;
        if (selectedCable) {
            clearVertexEditing(selectedCable);
            if (selectedCable.polyline) {
                selectedCable.polyline.setStyle({
                    weight: getCableDisplayWeight(selectedCable.data),
                    color: getCableDisplayColor(selectedCable.data)
                });
            }
            if (selectedCable.sidebarEl) selectedCable.sidebarEl.classList.remove('active');
            selectedCable = null;
        }
    }

    function showDetailPanel() {
        if (panelList)   panelList.classList.add('d-none');
        if (panelDetail) panelDetail.classList.remove('d-none');
    }

    // Back button
    if (detailBackBtn) {
        detailBackBtn.addEventListener('click', function () {
            showListPanel();
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
        }
        showDetail(item);
        showDetailPanel();
        switchSidebarTab('markers');
    }

    function showDetail(item) {
        if (!sidebarDetail) return;
        if (!item) return;

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
            if (editMode) {
                html += '<div class="sidebar-detail-actions">';
                html += '<button class="btn btn-sm btn-outline-danger" id="remove-location-btn">' +
                        '<i class="mdi mdi-map-marker-remove-outline"></i> Remove from Map</button>';
                html += '</div>';
            }

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
                    html += '<div class="connected-cable-row connected-cable-clickable" data-connected-cable-idx="' + idx + '">';
                    html += '<span class="cable-color-swatch" style="background:' + getCableDisplayColor(cd) + '"></span>';
                    html += '<span class="connected-cable-label">' + escHtml(cd.label || 'Cable #' + cd.id) + '</span>';
                    var ccType = getCableTypeLabel(cd.cable_type);
                    var ccCount = formatCableCount(cd.cable_type, cd.fiber_count);
                    var ccMeta = [ccType, ccCount].filter(Boolean).join(' \u00b7 ');
                    if (ccMeta) {
                        html += '<span class="connected-cable-meta" style="font-size:10px;color:var(--fp-text-muted,#6c757d)">' + escHtml(ccMeta) + '</span>';
                    }
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
                    showListPanel();
                }).catch(function (err) {
                    console.error('Failed to delete marker:', err);
                    alert('Failed to delete: ' + err.message);
                });
            });
        }

        // Wire up clickable connected cable rows
        if (item.kind === 'mapmarker') {
            var connectedCables = getConnectedCables(item.data.id);
            var clickableCables = sidebarDetail.querySelectorAll('.connected-cable-clickable');
            clickableCables.forEach(function (el) {
                el.addEventListener('click', function (e) {
                    // Don't navigate if clicking the detach button
                    if (e.target.closest('.detach-cable-btn')) return;
                    var idx = parseInt(el.getAttribute('data-connected-cable-idx'));
                    if (connectedCables[idx]) {
                        selectCable(connectedCables[idx]);
                    }
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
                    // Add back to unplaced list and rebuild chips
                    unplacedTiles.push(item.data);
                    buildPlaceChips();
                    // Remove from sidebar
                    var idx = allItems.indexOf(item);
                    if (idx !== -1) allItems.splice(idx, 1);
                    selectedItem = null;
                    buildToggleButtons();
                    buildSidebarList();
                    showListPanel();
                }).catch(function (err) {
                    console.error('Failed to remove tile from map:', err);
                    alert('Failed to remove: ' + err.message);
                });
            });
        }

        // Wire up remove-from-map button for location markers (#21)
        var removeLocationBtn = document.getElementById('remove-location-btn');
        if (removeLocationBtn && item.kind === 'location') {
            removeLocationBtn.addEventListener('click', function () {
                if (!confirm('Remove "' + escHtml(item.data.name) + '" from the map? (The location still exists in NetBox.)')) return;

                apiRequest(locCoordsApiUrl + item.data.id + '/', 'DELETE').then(function () {
                    if (item.marker) map.removeLayer(item.marker);
                    var idx = allItems.indexOf(item);
                    if (idx !== -1) allItems.splice(idx, 1);
                    selectedItem = null;
                    buildToggleButtons();
                    buildSidebarList();
                    showListPanel();
                }).catch(function (err) {
                    console.error('Failed to remove location from map:', err);
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
       PLACEMENT MODE — Drag-and-Drop Chips (edit only)
       ══════════════════════════════════════════════════════════════════ */
    if (!canEdit) return;

    /* ── Drag state ─────────────────────────────────────────────── */
    var dragMode = null;      // 'site' | 'location' | 'tile' | 'marker'
    var dragItem = null;      // data object being dragged
    var ghostMarker = null;   // L.marker following cursor

    function exitPlacementMode() {
        placementMode = null;
        placementItem = null;
        container.classList.remove('placing');
        if (statusEl) statusEl.textContent = '';
        if (cancelBtn) cancelBtn.classList.add('d-none');
    }

    /* ── Build "Place on Map" chips (sites + locations only) ────── */
    var SEARCH_THRESHOLD = 10;

    function buildPlaceChips() {
        if (!chipTrayPlace) return;
        chipTrayPlace.innerHTML = '';

        var hasAny = false;

        // Sites — chips if ≤ threshold, search dropdown if more
        if (unplacedSites.length > 0) {
            hasAny = true;
            if (unplacedSites.length <= SEARCH_THRESHOLD) {
                unplacedSites.forEach(function (s) {
                    var chip = makeChip('#0d6efd', 'mdi-office-building-outline', s.name + (s.region ? ' (' + s.region + ')' : ''));
                    chip.addEventListener('mousedown', function (e) {
                        if (e.button !== 0) return;
                        startChipDrag('site', s, e);
                    });
                    // #54 — small geocode button when the site has an address
                    attachGeocodeButton(chip, s);
                    chipTrayPlace.appendChild(chip);
                });
            } else {
                chipTrayPlace.appendChild(buildSearchDropdown('site', unplacedSites, {
                    color: '#0d6efd',
                    icon: 'mdi-office-building-outline',
                    label: function (s) { return s.name + (s.region ? ' (' + s.region + ')' : ''); },
                    search: function (s) { return (s.name + ' ' + (s.region || '')).toLowerCase(); },
                    placeholder: 'Search ' + unplacedSites.length + ' unplaced sites...'
                }));
            }
        }

        // Locations — chips if ≤ threshold, search dropdown if more
        if (unplacedLocations.length > 0) {
            hasAny = true;
            if (unplacedLocations.length <= SEARCH_THRESHOLD) {
                unplacedLocations.forEach(function (l) {
                    var chip = makeChip('#1a8a7a', 'mdi-map-marker-outline', l.name + (l.site_name ? ' (' + l.site_name + ')' : ''));
                    chip.addEventListener('mousedown', function (e) {
                        if (e.button !== 0) return;
                        startChipDrag('location', l, e);
                    });
                    chipTrayPlace.appendChild(chip);
                });
            } else {
                chipTrayPlace.appendChild(buildSearchDropdown('location', unplacedLocations, {
                    color: '#1a8a7a',
                    icon: 'mdi-map-marker-outline',
                    label: function (l) { return l.name + (l.site_name ? ' (' + l.site_name + ')' : ''); },
                    search: function (l) { return (l.name + ' ' + (l.site_name || '')).toLowerCase(); },
                    placeholder: 'Search ' + unplacedLocations.length + ' unplaced locations...'
                }));
            }
        }

        if (!hasAny && unplacedTiles.length === 0) {
            var empty = document.createElement('span');
            empty.className = 'chip-tray-empty text-muted small';
            empty.textContent = 'All items placed';
            chipTrayPlace.appendChild(empty);
        }

        // Update tile search placeholder with count
        updateTileSearchPlaceholder();
    }

    /**
     * Build a search-input + dropdown for placing items when there are many.
     * Reuses the tile-search-item styling.
     */
    function buildSearchDropdown(mode, items, opts) {
        var wrap = document.createElement('div');
        wrap.className = 'tile-place-row';

        var input = document.createElement('input');
        input.type = 'text';
        input.className = 'form-control form-control-sm';
        input.placeholder = opts.placeholder;
        input.autocomplete = 'off';
        wrap.appendChild(input);

        var results = document.createElement('div');
        results.className = 'tile-search-results';
        wrap.appendChild(results);

        function buildResults(query) {
            results.innerHTML = '';
            var q = (query || '').toLowerCase().trim();
            if (!q) {
                results.classList.remove('open');
                return;
            }

            var matches = [];
            for (var i = 0; i < items.length && matches.length < 30; i++) {
                if (opts.search(items[i]).indexOf(q) !== -1) matches.push(items[i]);
            }

            if (matches.length === 0) {
                results.innerHTML = '<div class="tile-search-empty">No matches</div>';
                results.classList.add('open');
                return;
            }

            matches.forEach(function (item) {
                var row = document.createElement('div');
                row.className = 'tile-search-item';
                row.innerHTML =
                    '<span class="chip-dot" style="background:' + opts.color + '">' +
                        '<i class="mdi ' + opts.icon + '"></i>' +
                    '</span>' +
                    '<span class="tile-search-label">' + escHtml(opts.label(item)) + '</span>';
                row.addEventListener('mousedown', function (e) {
                    if (e.button !== 0) return;
                    results.classList.remove('open');
                    input.value = '';
                    startChipDrag(mode, item, e);
                });
                results.appendChild(row);
            });
            results.classList.add('open');
        }

        input.addEventListener('input', function () { buildResults(input.value); });
        input.addEventListener('focus', function () {
            if (input.value.trim()) buildResults(input.value);
        });
        document.addEventListener('mousedown', function (e) {
            if (!results.contains(e.target) && e.target !== input) {
                results.classList.remove('open');
            }
        });

        return wrap;
    }

    function makeChip(color, iconClass, label) {
        var chip = document.createElement('span');
        chip.className = 'place-chip';
        chip.innerHTML =
            '<span class="chip-dot" style="background:' + color + '">' +
                '<i class="mdi ' + iconClass + '"></i>' +
            '</span>' +
            '<span class="chip-label">' + escHtml(label) + '</span>';
        chip.title = label;
        return chip;
    }

    /* ── #54 — Geocode an unplaced site from its physical_address ─────── */
    var GEOCODE_URL = 'https://nominatim.openstreetmap.org/search';
    var geocodingNow = new Set();

    function geocodeSite(site, chip) {
        if (!site.physical_address) return;
        if (geocodingNow.has(site.id)) return;
        geocodingNow.add(site.id);

        var btn = chip && chip.querySelector('.chip-geocode');
        if (btn) {
            btn.classList.add('is-loading');
            btn.title = 'Looking up address…';
        }

        var url = GEOCODE_URL + '?q=' + encodeURIComponent(site.physical_address) +
                  '&format=json&limit=1&addressdetails=0';

        // Nominatim asks for a descriptive User-Agent. Browsers won't let us
        // set User-Agent directly, but the Referer header from the page is
        // enough for their usage policy (they accept identifying via Referer
        // for in-browser apps).
        fetch(url, {
            headers: { 'Accept': 'application/json' },
            referrerPolicy: 'origin',
        })
            .then(function (r) { return r.json(); })
            .then(function (results) {
                geocodingNow.delete(site.id);
                if (btn) { btn.classList.remove('is-loading'); btn.title = 'Geocode from address'; }
                if (!results || !results.length) {
                    window.alert('Could not geocode this address:\n\n' + site.physical_address);
                    return;
                }
                var lat = parseFloat(results[0].lat);
                var lng = parseFloat(results[0].lon);
                if (isNaN(lat) || isNaN(lng)) {
                    window.alert('Geocoder returned invalid coordinates.');
                    return;
                }
                apiRequest(siteApiUrl + site.id + '/', 'PATCH', {
                    latitude: lat.toFixed(6),
                    longitude: lng.toFixed(6),
                })
                    .then(function () {
                        site.latitude = lat;
                        site.longitude = lng;
                        createSiteMarker(site);
                        unplacedSites = unplacedSites.filter(function (s) { return s.id !== site.id; });
                        buildPlaceChips();
                        buildToggleButtons();
                        buildSidebarList();
                        if (map && typeof map.setView === 'function') {
                            map.setView([lat, lng], 14);
                        }
                    })
                    .catch(function (err) {
                        window.alert('Could not save coordinates: ' + (err && err.message || err));
                    });
            })
            .catch(function (err) {
                geocodingNow.delete(site.id);
                if (btn) { btn.classList.remove('is-loading'); btn.title = 'Geocode from address'; }
                window.alert('Geocoder request failed: ' + (err && err.message || err));
            });
    }

    function attachGeocodeButton(chip, site) {
        if (!site || !site.physical_address) return;
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'chip-geocode btn btn-sm btn-link p-0 ms-1';
        btn.title = 'Geocode from address';
        btn.innerHTML = '<i class="mdi mdi-crosshairs-gps"></i>';
        btn.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            geocodeSite(site, chip);
        });
        // Stop the click event from also kicking off the drag-to-place flow.
        btn.addEventListener('mousedown', function (e) { e.stopPropagation(); });
        chip.appendChild(btn);
    }

    /* ── Tile search dropdown (for 1000s of tiles) ─────────────── */
    function updateTileSearchPlaceholder() {
        if (!tileSearchInput) return;
        var row = document.getElementById('tile-place-row');
        if (unplacedTiles.length === 0) {
            if (row) row.style.display = 'none';
        } else {
            if (row) row.style.display = '';
            tileSearchInput.placeholder = 'Search ' + unplacedTiles.length + ' unplaced tiles...';
        }
    }

    function buildTileSearchResults(query) {
        if (!tileSearchResults) return;
        tileSearchResults.innerHTML = '';

        var q = (query || '').toLowerCase().trim();
        if (!q) {
            tileSearchResults.classList.remove('open');
            return;
        }

        var matches = [];
        for (var i = 0; i < unplacedTiles.length && matches.length < 30; i++) {
            var t = unplacedTiles[i];
            var text = ((t.label || '') + ' ' + (t.type || '') + ' ' + (t.floorplan_name || '') + ' ' + (t.site_name || '')).toLowerCase();
            if (text.indexOf(q) !== -1) matches.push(t);
        }

        if (matches.length === 0) {
            tileSearchResults.innerHTML = '<div class="tile-search-empty">No matching tiles</div>';
            tileSearchResults.classList.add('open');
            return;
        }

        matches.forEach(function (t) {
            var cfg = TILE_CONFIG[t.type] || { color: '#888', icon: 'mdi-circle' };
            var suffix = t.floorplan_name || t.site_name || '';

            var row = document.createElement('div');
            row.className = 'tile-search-item';
            row.innerHTML =
                '<span class="chip-dot" style="background:' + cfg.color + '">' +
                    '<i class="mdi ' + cfg.icon + '"></i>' +
                '</span>' +
                '<span class="tile-search-label">' + escHtml(t.label || t.type) + '</span>' +
                (suffix ? '<span class="tile-search-meta">' + escHtml(suffix) + '</span>' : '');

            row.addEventListener('mousedown', function (e) {
                if (e.button !== 0) return;
                tileSearchResults.classList.remove('open');
                tileSearchInput.value = '';
                startChipDrag('tile', t, e);
            });

            tileSearchResults.appendChild(row);
        });

        tileSearchResults.classList.add('open');
    }

    if (tileSearchInput) {
        tileSearchInput.addEventListener('input', function () {
            buildTileSearchResults(tileSearchInput.value);
        });
        tileSearchInput.addEventListener('focus', function () {
            if (tileSearchInput.value.trim()) {
                buildTileSearchResults(tileSearchInput.value);
            }
        });
        // Close dropdown on click outside
        document.addEventListener('mousedown', function (e) {
            if (tileSearchResults && !tileSearchResults.contains(e.target) && e.target !== tileSearchInput) {
                tileSearchResults.classList.remove('open');
            }
        });
    }

    /* ── Build "Create" chips (one per marker type) ────────────── */
    function buildCreateChips() {
        if (!chipTrayCreate) return;
        chipTrayCreate.innerHTML = '';

        TYPE_CONFIGS_RAW.forEach(function (tc) {
            // #63 — skip types the admin has hidden from the Site Map
            // create-chip tray (manage in Settings → Tile Types).
            if (tc.hidden) return;
            var cfg = TILE_CONFIG[tc.slug] || { color: '#888', icon: 'mdi-circle', iconFg: 'light' };
            var chip = document.createElement('span');
            chip.className = 'create-chip';
            chip.style.background = cfg.color;
            chip.style.color = cfg.iconFg === 'dark' ? '#1a1a1a' : '#fff';
            chip.innerHTML = '<i class="mdi ' + cfg.icon + '"></i>';
            chip.title = tc.name + ' — drag to place';
            chip.addEventListener('mousedown', function (e) {
                if (e.button !== 0) return;
                startChipDrag('marker', {
                    marker_type: tc.slug,
                    label: '',
                    name: tc.name
                }, e);
            });
            chipTrayCreate.appendChild(chip);
        });
    }

    /* ── Drag start / move / end ───────────────────────────────── */
    function startChipDrag(mode, item, mouseEvent) {
        if (cableDrawing) return; // don't start drag during cable drawing
        dragMode = mode;
        dragItem = item;

        // Prevent text selection
        mouseEvent.preventDefault();

        // Build a ghost icon matching the type
        var ghostHtml, ghostSize, ghostAnchor;
        if (mode === 'site') {
            ghostHtml = '<div class="site-marker--office"><i class="mdi mdi-office-building-outline"></i></div>';
            ghostSize = [32, 32]; ghostAnchor = [16, 16];
        } else if (mode === 'location') {
            ghostHtml = '<div class="site-marker--location"><i class="mdi mdi-map-marker-outline"></i></div>';
            ghostSize = [22, 22]; ghostAnchor = [11, 11];
        } else if (mode === 'tile') {
            var cfg = TILE_CONFIG[item.type] || { color: '#888', icon: 'mdi-circle' };
            ghostHtml = '<div class="site-marker--tile" style="background:' + cfg.color + ';color:' + (cfg.iconFg === 'dark' ? '#1a1a1a' : '#fff') + '"><i class="mdi ' + cfg.icon + '"></i></div>';
            ghostSize = [20, 20]; ghostAnchor = [10, 10];
        } else { // marker
            var cfg = TILE_CONFIG[item.marker_type] || { color: '#888', icon: 'mdi-circle' };
            ghostHtml = '<div class="site-marker--tile" style="background:' + cfg.color + ';color:' + (cfg.iconFg === 'dark' ? '#1a1a1a' : '#fff') + '"><i class="mdi ' + cfg.icon + '"></i></div>';
            ghostSize = [20, 20]; ghostAnchor = [10, 10];
        }

        var ghostIcon = L.divIcon({
            className: 'drag-ghost-marker',
            html: ghostHtml,
            iconSize: ghostSize,
            iconAnchor: ghostAnchor
        });

        // Place ghost at map center initially (will update on first move)
        ghostMarker = L.marker(map.getCenter(), {
            icon: ghostIcon,
            interactive: false,
            zIndexOffset: 10000
        }).addTo(map);

        container.classList.add('drag-active');
        map.dragging.disable();

        var label = item.name || item.label || mode;
        if (statusEl) statusEl.textContent = 'Drop "' + label + '" on the map...';
        if (cancelBtn) cancelBtn.classList.remove('d-none');

        document.addEventListener('mousemove', onDragMove);
        document.addEventListener('mouseup', onDragEnd);
    }

    function onDragMove(e) {
        if (!ghostMarker) return;

        // Convert page coords to map container coords
        var rect = container.getBoundingClientRect();
        var x = e.clientX - rect.left;
        var y = e.clientY - rect.top;

        // Only update if cursor is over the map
        if (x >= 0 && y >= 0 && x <= rect.width && y <= rect.height) {
            var latlng = map.containerPointToLatLng(L.point(x, y));
            ghostMarker.setLatLng(latlng);

            // Cable highlight for marker drops
            if (dragMode === 'marker') {
                var near = findNearestCableAtPoint(latlng, 30);
                if (near !== hoveredCable) {
                    if (hoveredCable && hoveredCable.polyline) {
                        var prevW = getCableDisplayWeight(hoveredCable.data);
                        hoveredCable.polyline.setStyle({ weight: prevW, dashArray: null });
                    }
                    hoveredCable = near;
                    if (hoveredCable && hoveredCable.polyline) {
                        hoveredCable.polyline.setStyle({ weight: 6, dashArray: '8 4' });
                    }
                }
            }
        }
    }

    function onDragEnd(e) {
        document.removeEventListener('mousemove', onDragMove);
        document.removeEventListener('mouseup', onDragEnd);

        // Re-enable map dragging
        map.dragging.enable();
        container.classList.remove('drag-active');

        // Was cursor over the map?
        var rect = container.getBoundingClientRect();
        var x = e.clientX - rect.left;
        var y = e.clientY - rect.top;
        var overMap = (x >= 0 && y >= 0 && x <= rect.width && y <= rect.height);

        // Remove ghost
        if (ghostMarker) {
            map.removeLayer(ghostMarker);
            ghostMarker = null;
        }

        if (!overMap || !dragMode || !dragItem) {
            // Cancelled — dropped outside map
            cancelDrag();
            return;
        }

        var latlng = map.containerPointToLatLng(L.point(x, y));
        var lat = latlng.lat.toFixed(6);
        var lng = latlng.lng.toFixed(6);
        var mode = dragMode;
        var item = dragItem;
        dragMode = null;
        dragItem = null;

        if (statusEl) statusEl.textContent = 'Saving...';

        if (mode === 'site') {
            apiRequest(siteApiUrl + item.id + '/', 'PATCH', {
                latitude: lat,
                longitude: lng
            }).then(function () {
                item.latitude = parseFloat(lat);
                item.longitude = parseFloat(lng);
                createSiteMarker(item);
                unplacedSites = unplacedSites.filter(function (s) { return s.id !== item.id; });
                exitPlacementMode();
                buildPlaceChips();
                buildToggleButtons();
                buildSidebarList();
                setEditMode(editMode);
            }).catch(function (err) {
                console.error('Failed to place site:', err);
                if (statusEl) statusEl.textContent = 'Error: ' + err.message;
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
                exitPlacementMode();
                buildPlaceChips();
                buildToggleButtons();
                buildSidebarList();
                setEditMode(editMode);
            }).catch(function (err) {
                console.error('Failed to place location:', err);
                if (statusEl) statusEl.textContent = 'Error: ' + err.message;
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
                exitPlacementMode();
                buildPlaceChips();
                buildToggleButtons();
                buildSidebarList();
                setEditMode(editMode);
            }).catch(function (err) {
                console.error('Failed to place tile:', err);
                if (statusEl) statusEl.textContent = 'Error: ' + err.message;
            });

        } else if (mode === 'marker') {
            // Check if dropping on a cable (split)
            var targetCable = findNearestCableAtPoint(latlng, 30);

            // Clear cable highlight
            if (hoveredCable && hoveredCable.polyline) {
                var prevW = getCableDisplayWeight(hoveredCable.data);
                hoveredCable.polyline.setStyle({ weight: prevW, dashArray: null });
                hoveredCable = null;
            }

            // Show label prompt popup, then create
            showLabelPrompt(item.name || item.marker_type, function (labelText) {
                createMarkerAtPosition(lat, lng, item.marker_type, labelText, targetCable);
            }, function () {
                // Cancelled
                exitPlacementMode();
            });
            return; // don't exit placement yet — prompt is open
        }
    }

    /* ── Label prompt popup ──────────────────────────────────────── */
    function showLabelPrompt(typeName, onConfirm, onCancel) {
        var overlay = document.createElement('div');
        overlay.className = 'label-prompt-overlay';
        overlay.innerHTML =
            '<div class="label-prompt-box">' +
                '<div class="label-prompt-title">New ' + escHtml(typeName) + '</div>' +
                '<input type="text" class="label-prompt-input" placeholder="Label (optional)" autofocus>' +
                '<div class="label-prompt-actions">' +
                    '<button class="btn btn-sm btn-outline-secondary label-prompt-cancel">Cancel</button>' +
                    '<button class="btn btn-sm btn-primary label-prompt-ok">Place</button>' +
                '</div>' +
            '</div>';
        document.body.appendChild(overlay);

        var input = overlay.querySelector('.label-prompt-input');
        var okBtn = overlay.querySelector('.label-prompt-ok');
        var cancelBtn2 = overlay.querySelector('.label-prompt-cancel');

        function confirm() {
            var val = input.value.trim();
            cleanup();
            onConfirm(val);
        }

        function cancel() {
            cleanup();
            if (onCancel) onCancel();
        }

        function cleanup() {
            document.body.removeChild(overlay);
        }

        okBtn.addEventListener('click', confirm);
        cancelBtn2.addEventListener('click', cancel);
        input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') confirm();
            if (e.key === 'Escape') cancel();
        });
        overlay.addEventListener('mousedown', function (e) {
            if (e.target === overlay) cancel();
        });

        // Focus input after a tick (autofocus doesn't always work in dynamic elements)
        setTimeout(function () { input.focus(); }, 50);
    }

    /* ── Create marker at position (called after label prompt) ── */
    function createMarkerAtPosition(lat, lng, markerType, label, targetCable) {
        if (statusEl) statusEl.textContent = 'Saving...';

        var body = {
            latitude: lat,
            longitude: lng,
            marker_type: markerType,
            label: label || '',
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

            if (targetCable) {
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
        }).catch(function (err) {
            console.error('Failed to create marker:', err);
            if (statusEl) statusEl.textContent = 'Error: ' + err.message;
        });
    }

    function cancelDrag() {
        dragMode = null;
        dragItem = null;
        if (ghostMarker) {
            map.removeLayer(ghostMarker);
            ghostMarker = null;
        }
        container.classList.remove('drag-active');
        if (statusEl) statusEl.textContent = '';
        if (cancelBtn) cancelBtn.classList.add('d-none');
        // Clear cable highlight
        if (hoveredCable && hoveredCable.polyline) {
            var prevW = getCableDisplayWeight(hoveredCable.data);
            hoveredCable.polyline.setStyle({ weight: prevW, dashArray: null });
            hoveredCable = null;
        }
    }

    // Cancel button
    if (cancelBtn) {
        cancelBtn.addEventListener('click', function () {
            if (cableDrawing) cancelCableDrawing();
            else cancelDrag();
            exitPlacementMode();
        });
    }

    // ESC key
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
            if (cableDrawing) cancelCableDrawing();
            else if (dragMode) cancelDrag();
            else if (placementMode) exitPlacementMode();
            else if (panelDetail && !panelDetail.classList.contains('d-none')) showListPanel();
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

    // Map click → cable drawing only (placement now handled by drag)
    map.on('click', function (e) {
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
        }
    });

    // Build chip trays on init
    buildPlaceChips();
    buildCreateChips();

    /* ── Split cable at marker (POST to backend) ──────────────────── */
    function splitCableAtMarker(cableItem, markerId) {
        return apiRequest(cableSplitBaseUrl + cableItem.data.id + '/split/', 'POST', {
            marker_id: markerId
        }).then(function (result) {
            // Remove the old polyline, hit area, and label
            clearVertexEditing(cableItem);
            removeCableLabel(cableItem);
            if (cableItem.polyline) map.removeLayer(cableItem.polyline);
            if (cableItem.hitArea) map.removeLayer(cableItem.hitArea);
            var idx = allCableItems.indexOf(cableItem);
            if (idx !== -1) allCableItems.splice(idx, 1);

            // Create two new cables
            var splitA = createCablePolyline(result.cable_a);
            var splitB = createCablePolyline(result.cable_b);
            if (splitA) addCableLabel(splitA);
            if (splitB) addCableLabel(splitB);

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
