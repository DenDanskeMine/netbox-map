# Fiber / FTTH Network Mapping — Detailed Implementation Plan

## Overview

Add fiber/cable path visualization to the Site Map. Users can draw polyline routes on the map representing physical cable runs (feeder fiber, distribution cable, drop cables, conduit), connect them to existing markers/nodes, and optionally link them to NetBox Cable and Circuit objects. This enables ISPs and data center operators to map their outside plant (OSP) fiber network geographically.

---

## Research Summary

### How FTTH Networks Are Structured

```
CO (Central Office)
  └── OLT (Optical Line Terminal)
        │
        ╞══ FEEDER FIBER (high-count trunk, 288F-576F) ══╡
        │                                                  │
        FDH (Fiber Distribution Hub / Splitter Cabinet)
        │   └── Splitter (1:8, 1:16, 1:32)
        │
        ╞══ DISTRIBUTION FIBER (48F-144F) ══╡
        │                                    │
        Splice Closure / Access Terminal
        │
        ╞══ DROP CABLE (1F-4F) ══╡
        │                        │
        ONT/ONU (Customer Premises)
```

**Key elements to represent on the map:**
- **Lines/paths:** Cable routes following roads/trenches/poles (the main feature)
- **Point nodes:** OLT, FDH, splitter, splice closure, manhole, handhole, pole, cabinet, ONT

### How NetBox Models Fiber Today

| NetBox Model | Role in FTTH |
|---|---|
| `Device` | OLT, ONT, splitter (with FrontPort/RearPort), patch panel |
| `Interface` | PON ports (gpon, xgs-pon, epon types built into NetBox) |
| `FrontPort` / `RearPort` | Pass-through ports on patch panels and splitters (1 RearPort → N FrontPorts) |
| `Cable` | Physical cable connecting two endpoints (supports SMF-OS1, SMF-OS2, MMF-OM1-5 types) |
| `Circuit` | Provider-managed link with A/Z terminations (point-to-point) |
| `CircuitTermination` | Endpoint of a circuit, cabled to a device interface — participates in cable tracing |

**What NetBox does NOT have (our plugin fills this gap):**
- Geographic routing of cables (polyline paths on a map)
- Visual representation of OSP infrastructure (manholes, poles, cabinets as map nodes)
- Conduit/duct tracking
- Visual splitter tree diagrams

### Leaflet Drawing Approach

**Use Leaflet.draw plugin** (~50KB) for polyline creation and editing:
- Built-in toolbar with draw/edit/delete modes
- Vertex-by-vertex polyline drawing (click to place points)
- Edit mode: drag vertices, add/remove midpoints
- Events: `draw:created`, `draw:edited`, `draw:deleted`
- Store coordinates as `[[lat, lng], ...]` in a JSONField (no GeoDjango needed)
- Endpoint snapping to existing markers (manual or via Leaflet.Snap)
- SVG renderer is fine for hundreds of paths (no canvas needed)

---

## Phase 1: Cable Path Model + Basic Drawing (MVP)

The core feature: draw lines on the map, save them, link them to nodes.

### 1.1 New Model: `CablePath`

```python
class CablePath(NetBoxModel):
    """A geographic route drawn on the site map representing a physical cable run."""

    label = models.CharField(max_length=100, blank=True)
    description = models.CharField(max_length=200, blank=True)

    # Geographic route — ordered list of [lat, lng] waypoints
    path_coordinates = models.JSONField(
        default=list,
        help_text='Ordered [[latitude, longitude], ...] waypoints'
    )

    # Visual styling
    color = models.CharField(max_length=7, default='#ff8800')
    weight = models.PositiveSmallIntegerField(default=3)
    dash_pattern = models.CharField(max_length=50, blank=True, default='')

    # Cable type classification
    cable_type = models.CharField(
        max_length=50,
        choices=CablePathTypeChoices,
        default='fiber',
    )
    status = models.CharField(
        max_length=50,
        choices=CablePathStatusChoices,
        default='active',
    )

    # Fiber-specific metadata
    fiber_count = models.PositiveSmallIntegerField(
        null=True, blank=True,
        help_text='Number of fiber strands in this cable'
    )
    cable_id_label = models.CharField(
        max_length=100, blank=True,
        help_text='Physical cable sheath ID or marking'
    )

    # Endpoint references — which map markers/nodes this path connects
    start_marker = models.ForeignKey(
        'MapMarker', on_delete=models.SET_NULL,
        related_name='paths_from', blank=True, null=True
    )
    end_marker = models.ForeignKey(
        'MapMarker', on_delete=models.SET_NULL,
        related_name='paths_to', blank=True, null=True
    )

    # Optional link to NetBox Cable object
    cable = models.ForeignKey(
        'dcim.Cable', on_delete=models.SET_NULL,
        related_name='+', blank=True, null=True,
        help_text='Link to a NetBox cable for tracing integration'
    )

    # Optional link to NetBox Circuit
    circuit = models.ForeignKey(
        'circuits.Circuit', on_delete=models.SET_NULL,
        related_name='+', blank=True, null=True,
        help_text='Link to a NetBox circuit'
    )

    # Site association (for filtering)
    site = models.ForeignKey(
        'dcim.Site', on_delete=models.SET_NULL,
        related_name='cable_paths', blank=True, null=True
    )
```

**Choices:**
```python
class CablePathTypeChoices(ChoiceSet):
    CHOICES = [
        ('fiber', 'Fiber'),
        ('fiber_feeder', 'Fiber — Feeder'),
        ('fiber_distribution', 'Fiber — Distribution'),
        ('fiber_drop', 'Fiber — Drop'),
        ('copper', 'Copper'),
        ('conduit', 'Conduit/Duct'),
        ('aerial', 'Aerial'),
        ('underground', 'Underground'),
    ]

class CablePathStatusChoices(ChoiceSet):
    CHOICES = [
        ('planned', 'Planned'),
        ('active', 'Active'),
        ('decommissioned', 'Decommissioned'),
    ]
```

### 1.2 New Marker Types for Fiber Infrastructure

Add built-in types (extend `FloorPlanTileTypeChoices` or add via `CustomMarkerType` seed data):

| Slug | Name | Color | Icon |
|------|------|-------|------|
| `olt` | OLT | `#1e90ff` | `mdi-server-network` |
| `ont` | ONT | `#32cd32` | `mdi-home-variant` |
| `fdh` | FDH / Splitter Cabinet | `#ff8c00` | `mdi-archive` |
| `splitter` | Optical Splitter | `#daa520` | `mdi-call-split` |
| `splice_closure` | Splice Closure | `#8b4513` | `mdi-package-variant-closed` |
| `manhole` | Manhole | `#708090` | `mdi-circle-outline` |
| `handhole` | Handhole | `#a9a9a9` | `mdi-square-outline` |
| `pole` | Utility Pole | `#8b6914` | `mdi-transmission-tower` |
| `cabinet` | Street Cabinet | `#556b2f` | `mdi-fridge-outline` |

These can be added as `CustomMarkerType` records in a data migration, so users get them out of the box but can customize/delete them.

### 1.3 REST API: CablePath

New viewset at `/api/plugins/netbox-map/cable-paths/`:
- Full CRUD (list, create, retrieve, update, partial_update, destroy)
- Filterset: `site`, `cable_type`, `status`, `start_marker`, `end_marker`, `cable`, `circuit`
- Serializer includes `path_coordinates` as JSON array

### 1.4 Frontend: Drawing Cable Paths on the Site Map

**New static files:**
- `static/netbox_map/js/leaflet.draw.js` + `static/netbox_map/css/leaflet.draw.css`

**Template changes (`site_map.html`):**
- Include Leaflet.draw CSS/JS
- Add `data-cable-paths` attribute with serialized CablePath data
- Add draw toolbar area in edit mode

**JavaScript changes (`site_map.js`):**

#### A. Load & render saved cable paths on page load

```javascript
// Parse cable paths from data attribute
var cablePaths = JSON.parse(container.dataset.cablePaths || '[]');
var cablePathLayers = {};  // id → L.polyline

// FeatureGroup for editable paths
var drawnItems = new L.FeatureGroup();
map.addLayer(drawnItems);

cablePaths.forEach(function(cp) {
    var line = L.polyline(cp.path_coordinates, {
        color: cp.color || '#ff8800',
        weight: cp.weight || 3,
        dashArray: cp.dash_pattern || null,
        cablePathId: cp.id
    });
    line.bindTooltip(cp.label || 'Cable Path #' + cp.id, { sticky: true });
    line.on('click', function() { selectCablePath(cp); });
    drawnItems.addLayer(line);
    cablePathLayers[cp.id] = line;
});
```

#### B. Draw mode (edit mode only)

When edit mode is active, show the Leaflet.draw toolbar:

```javascript
var drawControl = new L.Control.Draw({
    position: 'topleft',
    draw: {
        polyline: {
            shapeOptions: { color: '#ff8800', weight: 3 },
            showLength: true,
        },
        polygon: false, circle: false, rectangle: false,
        marker: false, circlemarker: false,
    },
    edit: {
        featureGroup: drawnItems,
        edit: true,
        remove: true,
    }
});

// Show/hide draw control based on edit mode
function setEditMode(on) {
    if (on) map.addControl(drawControl);
    else map.removeControl(drawControl);
    // ... existing edit mode logic
}
```

#### C. Event handlers

```javascript
map.on('draw:created', function(e) {
    var coords = e.layer.getLatLngs().map(function(ll) {
        return [ll.lat, ll.lng];
    });
    // Snap endpoints to nearest markers
    var startSnap = findNearestMarker(coords[0], 20);
    var endSnap = findNearestMarker(coords[coords.length - 1], 20);
    if (startSnap) coords[0] = [startSnap.lat, startSnap.lng];
    if (endSnap) coords[coords.length - 1] = [endSnap.lat, endSnap.lng];

    // POST to API
    apiRequest('POST', cablePathApiUrl, {
        path_coordinates: coords,
        start_marker: startSnap ? startSnap.id : null,
        end_marker: endSnap ? endSnap.id : null,
        label: '',
        color: '#ff8800',
        weight: 3,
    }).then(function(saved) {
        e.layer.options.cablePathId = saved.id;
        drawnItems.addLayer(e.layer);
        showSavedBadge();
    });
});

map.on('draw:edited', function(e) {
    e.layers.eachLayer(function(layer) {
        var coords = layer.getLatLngs().map(function(ll) {
            return [ll.lat, ll.lng];
        });
        apiRequest('PATCH', cablePathApiUrl + layer.options.cablePathId + '/', {
            path_coordinates: coords,
        });
    });
});

map.on('draw:deleted', function(e) {
    e.layers.eachLayer(function(layer) {
        apiRequest('DELETE', cablePathApiUrl + layer.options.cablePathId + '/');
    });
});
```

#### D. Cable path detail panel

When a cable path is clicked, show details in the sidebar:
- Label (editable in edit mode)
- Cable type + status
- Fiber count
- Cable sheath ID
- Start/end marker names (clickable → zoom to marker)
- Linked NetBox Cable (link to NetBox)
- Linked NetBox Circuit (link to NetBox)
- Path length (calculated from coordinates using Haversine)

#### E. Cable path styling by type

```javascript
var CABLE_TYPE_STYLES = {
    fiber:              { color: '#ff8800', weight: 3, dashArray: null },
    fiber_feeder:       { color: '#ff4400', weight: 4, dashArray: null },
    fiber_distribution: { color: '#ff8800', weight: 3, dashArray: null },
    fiber_drop:         { color: '#ffbb00', weight: 2, dashArray: null },
    copper:             { color: '#4a90d9', weight: 3, dashArray: null },
    conduit:            { color: '#888888', weight: 5, dashArray: '8, 4' },
    aerial:             { color: '#aa6633', weight: 2, dashArray: '4, 4' },
    underground:        { color: '#555555', weight: 4, dashArray: '12, 4' },
};
```

#### F. Keep paths connected to markers when markers are dragged

```javascript
// Build lookup: markerId → [{ polyline, endpoint: 'start'|'end' }]
var markerPathLinks = {};

function registerPathLink(pathId, startMarkerId, endMarkerId) {
    if (startMarkerId) {
        if (!markerPathLinks[startMarkerId]) markerPathLinks[startMarkerId] = [];
        markerPathLinks[startMarkerId].push({ pathId: pathId, endpoint: 'start' });
    }
    if (endMarkerId) {
        if (!markerPathLinks[endMarkerId]) markerPathLinks[endMarkerId] = [];
        markerPathLinks[endMarkerId].push({ pathId: pathId, endpoint: 'end' });
    }
}

// In existing marker dragend handler, update connected paths:
marker.on('drag', function(e) {
    var links = markerPathLinks[markerId] || [];
    links.forEach(function(link) {
        var line = cablePathLayers[link.pathId];
        if (!line) return;
        var latlngs = line.getLatLngs();
        if (link.endpoint === 'start') latlngs[0] = e.target.getLatLng();
        else latlngs[latlngs.length - 1] = e.target.getLatLng();
        line.setLatLngs(latlngs);
    });
});
```

### 1.5 Sidebar Integration

**Type toggle:** Add a "Cables" toggle button to the sidebar (like Sites, Locations, etc.) to show/hide all cable paths.

**List items:** Cable paths appear in the sidebar list with:
- Color swatch (line segment icon)
- Label or "Cable Path #N"
- Cable type badge
- Status indicator

**Search:** Cable paths searchable by label, cable_id_label, cable type.

### 1.6 Migration

```python
# 0003_cablepath.py
class Migration(migrations.Migration):
    dependencies = [
        ('netbox_map', '0002_...'),
        ('dcim', '0001_initial'),
        ('circuits', '0001_initial'),
    ]
    operations = [
        migrations.CreateModel(
            name='CablePath',
            fields=[...],  # as defined above
        ),
    ]
```

---

## Phase 2: Linking Cable Paths to NetBox Objects

### 2.1 Auto-Link to NetBox Cables

When a cable path's `start_marker` and `end_marker` both have `assigned_object` (devices), the sidebar could show:
- "Link to Cable" dropdown listing cables between those two devices
- Or auto-suggest if there's exactly one cable between them

### 2.2 Circuit Integration

When `cable_path.circuit` is set:
- Show circuit details in the detail panel (provider, CID, status, commit rate)
- Show A/Z termination info
- Color the path by circuit status (active=green, planned=dashed grey)

### 2.3 Cable Trace Overlay

"Trace" button on a cable path that has a linked NetBox Cable:
- Call the cable's `.trace()` to get the full path
- Highlight all cable paths on the map that participate in the trace
- Show trace result in sidebar (reuse `generateTraceHTML` pattern from floorplan viewer)

---

## Phase 3: Advanced Features (Future)

### 3.1 Fiber Strand Tracking
- Show fiber count on cable path tooltip/popup
- Detail panel shows buffer tube breakdown (if modeled via custom fields)
- Color code by utilization (strands in use vs total)

### 3.2 Splitter Tree Visualization
- Click a splitter marker → show tree diagram of downstream ONTs
- Fan-out lines from splitter to all connected drop cable paths

### 3.3 Conduit Management
- Conduit paths (thick dashed lines) as a separate layer
- Cable paths "inside" conduits (visually parallel or offset)
- Conduit fill visualization (% capacity)

### 3.4 Distance / Budget Calculator
- Calculate total fiber path length from coordinates
- Optical power budget estimation (insertion loss per km + splitter loss)

### 3.5 Import/Export
- GeoJSON import of cable routes from GIS tools
- KML/KMZ export for Google Earth
- CSV import of cable paths with coordinates

### 3.6 Multi-Path Selection
- Shift-click to select multiple cable paths
- Bulk edit color/type/status
- Bulk link to circuit

---

## Files to Create/Modify

### New Files
| File | Purpose |
|------|---------|
| `netbox_map/migrations/0003_cablepath.py` | Database migration |
| `static/netbox_map/js/leaflet.draw.js` | Leaflet.draw plugin |
| `static/netbox_map/css/leaflet.draw.css` | Leaflet.draw styles |

### Modified Files
| File | Changes |
|------|---------|
| `netbox_map/models.py` | Add `CablePath` model, `CablePathTypeChoices`, `CablePathStatusChoices` |
| `netbox_map/forms.py` | Add `CablePathForm`, `CablePathFilterForm`, `CablePathBulkEditForm` |
| `netbox_map/tables.py` | Add `CablePathTable` |
| `netbox_map/filtersets.py` | Add `CablePathFilterSet` |
| `netbox_map/views.py` | Add CablePath CRUD views, update `SiteMapView` to include cable paths in context |
| `netbox_map/urls.py` | Add CablePath URL patterns |
| `netbox_map/api/serializers.py` | Add `CablePathSerializer` |
| `netbox_map/api/views.py` | Add `CablePathViewSet` |
| `netbox_map/api/urls.py` | Register CablePath router |
| `netbox_map/navigation.py` | Add Cable Paths menu item |
| `netbox_map/search.py` | Add CablePath search index |
| `netbox_map/templates/netbox_map/site_map.html` | Include Leaflet.draw, add `data-cable-paths`, draw toolbar |
| `netbox_map/static/netbox_map/js/site_map.js` | All drawing/editing/saving logic |
| `netbox_map/static/netbox_map/css/site_map.css` | Cable path styling, draw toolbar theming |

---

## Implementation Order

### Sprint 1 — Model + API + Basic Drawing
1. Create `CablePath` model + migration
2. Add serializer + viewset + API URLs
3. Download and bundle Leaflet.draw
4. Update `SiteMapView` to pass cable paths to template
5. Add JS to render saved cable paths on map load
6. Add draw toolbar in edit mode
7. Implement `draw:created` → POST, `draw:edited` → PATCH, `draw:deleted` → DELETE
8. Basic cable path detail in sidebar (label, type, status)
9. Sidebar toggle for cable paths visibility
10. **Commit checkpoint**

### Sprint 2 — Polish + Node Linking
11. Cable type styling (color/weight/dash by type)
12. Endpoint snapping to markers
13. Keep paths connected when markers are dragged
14. Cable path properties panel (edit label, type, status, fiber count, sheath ID)
15. Link to NetBox Cable dropdown
16. Link to NetBox Circuit dropdown
17. Add fiber infrastructure marker types (OLT, ONT, FDH, splitter, etc.)
18. Path length calculation (Haversine)
19. **Commit checkpoint**

### Sprint 3 — CRUD Views + List Page
20. Add CablePath list/detail/edit/delete views
21. Add CablePathTable, CablePathFilterSet, forms
22. URL patterns for CRUD
23. Navigation menu item
24. Search index
25. **Commit checkpoint**

### Sprint 4 — Advanced Integration
26. Cable trace overlay (highlight traced paths on map)
27. Circuit detail in sidebar
28. Tooltip/popup improvements (fiber count, length, linked objects)
29. Dark mode theming for draw toolbar
30. **Commit checkpoint + PR**

---

## Verification Checklist

- [ ] Draw a polyline on the map in edit mode → saves to DB, visible after reload
- [ ] Edit vertices of an existing path → PATCH saves new coordinates
- [ ] Delete a path → removed from DB and map
- [ ] Cable paths render with correct color/style per cable type
- [ ] Endpoints snap to nearby markers within 20px
- [ ] Moving a marker updates connected cable path endpoints
- [ ] Sidebar shows cable paths with toggle, search, click-to-select
- [ ] Detail panel shows cable path properties
- [ ] Linked NetBox Cable/Circuit shows in detail panel
- [ ] Cable paths filter by site
- [ ] REST API CRUD works
- [ ] List/detail views work
- [ ] Dark mode renders correctly
- [ ] No performance issues with 100+ cable paths on map
