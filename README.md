# NetBox Map

![Python](https://img.shields.io/badge/python-3.12%2B-blue.svg)
![NetBox](https://img.shields.io/badge/netbox-4.5%2B-blue.svg)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![PyPI](https://img.shields.io/pypi/v/netbox-map.svg)](https://pypi.org/project/netbox-map/)

A comprehensive mapping and floor plan visualization plugin for NetBox. Build interactive data center floor plans, place assets on a global geographic map, visualize rack utilization, explore devices nested inside racks, and configure everything from a web-based settings page — no restart required.

---

## Feature Highlights

| Feature | Description |
|---------|-------------|
| **Interactive Floor Plans** | Canvas-based editor with drag-and-drop tile placement, pan/zoom, and configurable grids |
| **Global Site Map** | Leaflet.js geographic map showing sites, locations, tiles, and standalone markers |
| **Rack Utilization Heatmap** | Color-coded gradient (green → red) showing rack fill percentage directly on tiles |
| **Nested Rack Devices** | Expand any rack in the sidebar to see all devices inside it, sorted by U-position |
| **Searchable Sidebar** | Real-time search across tile labels, device names, and IP addresses — finds devices inside racks |
| **Rack Elevation View** | Select a rack tile to see its full front/rear elevation SVG in the sidebar |
| **Camera FOV Visualization** | Configure and display camera field-of-view cones with live preview |
| **GPS Sync** | Automatically updates device latitude/longitude when placed on a map |
| **Web-Based Settings** | Toggle features and configure detail panel fields from the UI — no file editing or restarts |
| **PDF Export** | One-click export of floor plans to PDF |
| **REST API** | Full CRUD API for all models with filtering and search |
| **Dark Mode** | Full support for NetBox light and dark themes |

---

## Table of Contents

- [Requirements](#requirements)
- [Installation](#installation)
- [Floor Plan Visualization](#floor-plan-visualization)
  - [Canvas Editor](#canvas-editor)
  - [Tile Types](#tile-types)
  - [Object Linking](#object-linking)
  - [Rack Utilization](#rack-utilization)
  - [Nested Rack Devices](#nested-rack-devices)
  - [Rack Elevation](#rack-elevation)
  - [Camera FOV](#camera-fov)
  - [Sidebar Search & Filtering](#sidebar-search--filtering)
  - [PDF Export](#pdf-export)
- [Global Site Map](#global-site-map)
  - [Map Markers](#map-markers)
  - [Edit Mode](#site-map-edit-mode)
- [Settings](#settings)
  - [Detail Panel Configuration](#detail-panel-configuration)
  - [GPS Sync Toggle](#gps-sync-toggle)
- [NetBox Integration](#netbox-integration)
- [REST API](#rest-api)
- [Controls Reference](#controls-reference)
- [Development](#development)
- [License](#license)

---

## Requirements

- NetBox **4.5.0** or later
- Python **3.12** or later

## Installation

### From PyPI

```bash
source /opt/netbox/venv/bin/activate
pip install netbox-map
```

### From source

```bash
source /opt/netbox/venv/bin/activate
pip install git+https://github.com/DenDanskeMine/netbox-map.git
```

### Enable the plugin

Add `netbox_map` to your NetBox `configuration.py`:

```python
PLUGINS = [
    'netbox_map',
]
```

### Optional configuration

```python
PLUGINS_CONFIG = {
    'netbox_map': {
        'default_grid_width': 20,    # Default grid width in tiles
        'default_grid_height': 20,   # Default grid height in tiles
        'default_tile_size': 60,     # Default tile size in pixels
    }
}
```

> All other settings (detail panel fields, MAC display, GPS sync) are managed from the web-based [Settings](#settings) page.

### Apply migrations

```bash
cd /opt/netbox/netbox
python3 manage.py migrate
```

### Collect static files

```bash
cd /opt/netbox/netbox
python3 manage.py collectstatic --no-input
```

### Restart services

```bash
sudo systemctl restart netbox
```

---

## Floor Plan Visualization

### Canvas Editor

The floor plan editor is a full-featured canvas application with:

- **Configurable grid** — set width, height (up to 1000 cells), and tile size (5–200px)
- **Pan and zoom** — mouse wheel zoom, middle-click or left-click drag to pan
- **Fit to view** — one click to auto-fit all tiles in the viewport
- **Background images** — upload blueprints or photos as placement guides
- **Floor plan selector** — switch between floor plans at the same site without leaving the page

**To create a floor plan:**

1. Navigate to **Floor Plans > Floor Plans > Add**
2. Select a site, name the floor plan, and configure grid dimensions
3. Optionally upload a background image
4. Open the **Visualization** tab to start editing

**Edit mode controls:**

- **Double-click** on the grid to place a new tile
- **Drag** a tile to move it (auto-saves position)
- **Click** a tile to select it and view details in the sidebar
- Use the toolbar to set tile type, label, and dimensions before placing
- **Delete** selected tiles with the delete button

### Tile Types

12 tile types are available, each with a distinct color:

| Type | Color | Use Case |
|------|-------|----------|
| Rack | Utilization gradient | Server racks with fill percentage |
| Aisle | Dark grey | Walkways between rack rows |
| Wall | Medium grey | Room boundaries |
| Column | Light grey | Structural columns |
| Door | Teal | Entry/exit points |
| Cooling | Cyan | CRAC/CRAH units, in-row cooling |
| Power | Gold | PDUs, UPS, electrical panels |
| Empty | Dark | Placeholder / available space |
| Reserved | Orange | Reserved for future use |
| Access Point | Purple | Wireless access points |
| Camera | Red | Security cameras (with FOV) |
| Printer | Orange | Network printers |

Each tile supports:
- **Custom labels** (editable inline)
- **Size** from 1x1 to 10x10 grid cells
- **Status** — Active, Planned, or Decommissioned
- **Orientation** — 0, 90, 180, 270 degrees

### Object Linking

Tiles can be linked to NetBox objects:

- **Racks** — shows utilization, elevation, and nested devices
- **Devices** — shows primary IP, MAC address, and detail fields
- **Power Panels** — shows site and location info
- **Power Feeds** — shows status, voltage, amperage

**To link an object:**

1. Enter edit mode and select a tile
2. In the **Link Object** panel, choose an object type
3. Select the specific object from the dropdown (filtered by site)
4. Click **Link**

### Rack Utilization

Rack tiles display a color-coded utilization heatmap:

- **Green** (0%) → **Yellow** (50%) → **Red** (90%+)
- Empty/unlinked racks show as neutral grey
- Utilization percentage is displayed on the tile when there's enough space
- The gradient legend appears in the header bar

### Nested Rack Devices

Every rack tile in the sidebar shows an **expand arrow** (&#9656;) when it contains devices:

- Click the arrow to expand and see all devices in that rack
- Devices are sorted by **U-position** (highest first)
- Each device shows its **name** (linked to NetBox), **IP address**, and **U-position**
- A device count badge (e.g., "12d") appears on each rack item
- **Searching works across devices** — type a device name or IP in the search box and the parent rack auto-expands to reveal matching devices
- Device data is fetched once via a single API call and cached for the session

### Rack Elevation

When a rack tile is selected, the sidebar shows the rack's **elevation SVG**:

- Toggle between **Front** and **Rear** views
- Shows device positions, model names, and empty slots
- Click devices in the elevation to navigate to their detail pages
- Loaded via AJAX from NetBox's rack elevation API

### Camera FOV

Camera-type tiles display a field-of-view cone on the canvas:

- **Direction** (0–360 degrees) — where the camera points (0 = north)
- **Angle** (10–360 degrees) — how wide the FOV is
- **Distance** (1–50 grid cells) — how far the camera sees
- FOV cones render as semi-transparent red wedges
- **Live preview** — adjust values and see the cone update in real-time
- Toggle all FOV cones on/off with the **FOV** button in the sidebar

### Sidebar Search & Filtering

The sidebar provides powerful search and filtering:

- **Real-time text search** — filters tiles by label, type, device name, and IP address
- **Type toggles** — show/hide any of the 12 tile types independently
- **Tile count** — shows visible / total tile count
- **Click to zoom** — clicking a sidebar item zooms the canvas to center that tile
- **Active highlighting** — selected tile is highlighted in both the sidebar and canvas

### PDF Export

Click the **PDF** button in the zoom controls to export the current floor plan:

- Includes all visible tiles with correct colors and labels
- Respects type toggle visibility (hidden types are excluded)
- Adds a title header and tile count legend
- Camera FOV cones are included if the FOV toggle is on

---

## Global Site Map

The site map provides a geographic overview of your entire infrastructure using **Leaflet.js** with OpenStreetMap tiles.

Navigate to **Floor Plans > Maps > Site Map**.

### What's on the map

- **Sites** — with floor plan links in popups
- **Locations** — via the LocationCoordinates model (extends NetBox locations with lat/lng)
- **Floor plan tiles** — tiles with geographic coordinates appear on the global map
- **Standalone map markers** — custom markers not tied to floor plans

### Map Markers

Standalone map markers can be placed anywhere on the globe:

- All 12 marker types supported (same as tile types)
- Can be linked to devices, racks, power panels, or power feeds
- Optional site association
- Description field
- Camera markers include full FOV visualization on the map

### Site Map Edit Mode

Users with `change_site` permission can enter edit mode:

- **Place sites** — select an unplaced site and click the map to set its coordinates
- **Place locations** — add geographic coordinates to NetBox locations
- **Place tiles** — give floor plan tiles a geographic position
- **Add markers** — create new standalone map markers by clicking the map
- **Drag to reposition** — all markers are draggable in edit mode (auto-saves)
- **Remove/delete** — remove tiles from the map or delete standalone markers

---

## Settings

Navigate to **Floor Plans > Configuration > Settings** to manage plugin settings from the web UI.

### Detail Panel Configuration

Control which fields appear in the detail panel when you click a tile or marker:

**General toggles:**
- **Show MAC Address** — display MAC address for devices (from primary IP interface)
- **Show Custom Fields** — display custom fields in the detail panel

**Per-object-type field selection:**

Select which standard fields to show for each object type using checkboxes:

| Object Type | Available Fields |
|-------------|-----------------|
| **Device** | status, role, device_type, platform, serial, asset_tag, tenant, site, location, rack, position, face, airflow, primary_ip4, primary_ip6, oob_ip, cluster, virtual_chassis, vc_position, description |
| **Rack** | status, role, facility_id, serial, asset_tag, u_height, width, type, weight, max_weight, tenant, site, location, description |
| **Power Panel** | site, location, description |
| **Power Feed** | status, type, supply, voltage, amperage, max_utilization, power_panel, rack, description |

### GPS Sync Toggle

- **Sync Device GPS** — when enabled, placing a device on a map (via tile or marker with coordinates) automatically writes the latitude/longitude to the device record in NetBox
- When a tile/marker is deleted or the device is unlinked, the GPS is cleared if no other map references remain

All settings are stored in the database and take effect immediately — no restart needed.

---

## NetBox Integration

The plugin integrates with existing NetBox pages:

| Integration | Description |
|-------------|-------------|
| **Site detail page** | Panel showing floor plans for the site with links to visualizations |
| **Device detail page** | "Map Locations" tab listing all floor plan tiles and map markers where the device appears |
| **Global search** | Floor plans, tiles, and map markers are indexed for NetBox search |
| **Change logging** | All models support NetBox's change log |

---

## REST API

Full CRUD REST API endpoints:

| Endpoint | Description |
|----------|-------------|
| `/api/plugins/netbox-map/floorplans/` | Floor plan CRUD with site/location filtering |
| `/api/plugins/netbox-map/floorplan-tiles/` | Tile CRUD with floor plan, type, status filtering |
| `/api/plugins/netbox-map/location-coordinates/` | Geographic coordinates for locations |
| `/api/plugins/netbox-map/map-markers/` | Standalone map marker CRUD |

All endpoints support filtering, pagination, and brief mode.

---

## Controls Reference

### Floor Plan Canvas

| Action | Control |
|--------|---------|
| Pan | Left-click drag (empty space) or middle-click drag |
| Zoom | Mouse wheel or +/- buttons |
| Fit to view | Fit button in zoom controls |
| Select tile | Click |
| Place tile (edit mode) | Double-click |
| Move tile (edit mode) | Drag tile |

### Site Map

| Action | Control |
|--------|---------|
| Pan | Left-click drag |
| Zoom | Mouse wheel or +/- buttons |
| Select marker | Click |
| Move marker (edit mode) | Drag |
| Place item (edit mode) | Select item, click map |

### Sidebar

| Action | Control |
|--------|---------|
| Search | Type in the search box |
| Filter by type | Click type toggle buttons |
| Zoom to tile | Click sidebar item |
| Expand rack devices | Click the arrow (&#9656;) on a rack item |

---

## Development

```bash
git clone https://github.com/DenDanskeMine/netbox-map.git
cd netbox-map
pip install -e .
```

## License

This project is licensed under the Apache License 2.0 — see the [LICENSE](LICENSE) file for details.

## Support

- [Open an issue](https://github.com/DenDanskeMine/netbox-map/issues) on GitHub
- Check existing issues for answers
