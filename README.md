# NetBox Map

![Python](https://img.shields.io/badge/python-3.12%2B-blue.svg)
![NetBox](https://img.shields.io/badge/netbox-4.5%2B-blue.svg)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![PyPI](https://img.shields.io/pypi/v/netbox-map.svg)](https://pypi.org/project/netbox-map/)

An interactive floor plan visualization plugin for NetBox. Create, edit, and manage data center floor plans with a canvas-based editor featuring tile management, object linking, camera FOV visualization, and PDF export.

## Features

- **Interactive canvas editor** — drag-and-drop tile placement on a configurable grid with pan/zoom
- **12 tile types** — rack, aisle, wall, column, door, cooling, power, empty, reserved, access point, camera, printer
- **Object linking** — assign NetBox racks, devices, power panels, and power feeds to tiles
- **Rack utilization** — color-coded gradient showing rack fill percentage directly on the floor plan
- **Camera FOV visualization** — configure and display camera field-of-view cones with direction, angle, and distance
- **PDF export** — one-click export of the current floor plan view
- **Background images** — upload floor plan blueprints as tile placement guides
- **Site integration** — floor plans tab on Site detail pages, multiple floor plans per site
- **Location support** — optionally associate floor plans with specific locations within a site
- **REST API** — full CRUD API for floor plans and tiles with filtering
- **Search indexing** — floor plans and tiles indexed for NetBox global search
- **Dark mode compatible**

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

## Usage

### Create a floor plan

1. Navigate to **Plugins > Sitemap > Floor Plans**
2. Click **Add** and select a site, name the floor plan, and configure grid dimensions
3. Optionally upload a background image as a placement guide

### Edit tiles

1. Open a floor plan and click the **Visualization** tab
2. Click **Edit Layout** to enter edit mode
3. **Double-click** on the grid to place a new tile
4. **Drag** tiles to reposition them
5. Use the toolbar to set tile type, label, and dimensions before placing
6. **Click** a tile to select it and view/edit its details in the sidebar

### Link objects

1. In edit mode, select a tile
2. In the **Link Object** panel, choose an object type (Rack, Device, Power Panel, Power Feed)
3. Select the specific object from the dropdown
4. Click **Link** to assign it to the tile

### Camera FOV

1. Place a **Camera** tile type
2. Select the camera tile to reveal FOV controls
3. Configure direction (0-360 degrees), angle (10-360 degrees), and distance (1-50 grid cells)
4. The FOV cone renders in real-time on the canvas

### Export to PDF

Click the **PDF** button in the zoom controls to export the current floor plan view.

### Keyboard and mouse controls

| Action | Control |
|--------|---------|
| Pan | Middle-click drag or Space + drag |
| Zoom | Mouse wheel or +/- buttons |
| Select tile | Click |
| Place tile (edit mode) | Double-click |
| Move tile (edit mode) | Drag |

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
