# NetBox Map

![Python](https://img.shields.io/badge/python-3.12%2B-blue.svg)
![NetBox](https://img.shields.io/badge/netbox-4.5%2B-blue.svg)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![PyPI](https://img.shields.io/pypi/v/netbox-map.svg)](https://pypi.org/project/netbox-map/)
[![PyPI Downloads](https://static.pepy.tech/personalized-badge/netbox-map?period=total&units=INTERNATIONAL_SYSTEM&left_color=BLACK&right_color=GREEN&left_text=downloads)](https://pepy.tech/projects/netbox-map)

A NetBox plugin for interactive floor plan visualization, site maps, rack utilization, and cable tracing.

**Other plugins:** [NetBox Ping](https://github.com/DenDanskeMine/netbox-ping) | [Website](https://www.danbyte.net/) | [Demo](https://demo.danbyte.net/)

## Features

**Floor Plans**
- Canvas-based editor with drag-and-drop tile placement, pan/zoom, and configurable grids
- 12 tile types -- rack, aisle, wall, column, door, cooling, power, empty, reserved, access point, camera, printer
- Tile orientation (0/90/180/270°) -- text rotates to match, so narrow vertical tiles stay readable
- Link tiles to NetBox objects (racks, devices, power panels, power feeds, ports)
- Background image upload for blueprints or photos
- PDF export with all visible tiles, labels, and FOV cones

**Rack Visualization**
- Utilization heatmap -- color gradient from green (0%) to red (90%+) directly on tiles
- Expand racks in the sidebar to see all devices sorted by U-position
- Full rack elevation SVG (front/rear) in the detail panel
- Search across device names and IPs inside racks

**Cable Tracing**
- Full cable trace for devices, rear ports, and front ports
- Unified traces through patch panels (Server:eth0 → Cable → FrontPort → RearPort → Cable → Switch:Gig1/0/3)
- "Show on map" buttons to zoom to devices that exist on the floor plan
- Rack device traces -- expand a rack, click the cable icon on any device

**Camera FOV**
- Configurable direction (0-360°), angle (10-360°), and distance (1-50 cells)
- Live preview of semi-transparent FOV cones on the canvas
- Toggle all FOV cones on/off

**Global Site Map**
- Leaflet.js geographic map with OpenStreetMap tiles
- Sites, locations, floor plan tiles, and standalone markers on one map
- Edit mode -- place sites, locations, and markers by clicking the map
- Drag to reposition, auto-saves coordinates
- GPS sync -- automatically writes lat/lng to device records when placed on the map
- Early fiber/cable path support (experimental -- expect breaking changes in future releases)

**Settings (Web UI)**
- Configure detail panel fields per object type from the browser
- Toggle MAC address display, custom fields, GPS sync
- No file editing or restarts needed

**Integration**
- Site detail page panel with floor plan links
- Device detail page "Map Locations" tab
- Global search indexing for floor plans, tiles, and markers
- Change logging on all models
- REST API with full CRUD, filtering, and search
- Dark mode support

## Screenshots

![BAsic_Device_showcase](https://github.com/user-attachments/assets/06ddd613-0b28-495a-ab5c-3c6606807350)

![CAM-FOV_showcasee](https://github.com/user-attachments/assets/56d3554c-7acb-4775-beef-c6a971cf4f95)

![MAP_showcase](https://github.com/user-attachments/assets/382b96d3-8b66-408e-af0d-1a5f155f883b)

![Rack_showcase](https://github.com/user-attachments/assets/7666a522-740d-4445-a340-cc2b07cb7632)

<img width="765" height="457" alt="image" src="https://github.com/user-attachments/assets/9fe6f38a-e8b7-46b8-a800-8672581b837e" />



## Installation

```bash
source /opt/netbox/venv/bin/activate
pip install netbox-map
```

Or from source:

```bash
source /opt/netbox/venv/bin/activate
pip install git+https://github.com/DenDanskeMine/netbox-map.git
```

Add to `configuration.py`:

```python
PLUGINS = [
    'netbox_map',
]
```

Apply migrations and restart:

```bash
cd /opt/netbox/netbox
python3 manage.py migrate
python3 manage.py collectstatic --no-input
sudo systemctl restart netbox
```

## GPS Sync

When enabled, placing a device on a map automatically writes lat/lng to the device record. Clearing the tile/marker clears the GPS if no other map references remain.

## Maps URL Deep-Linking

Point NetBox's built-in Map button to this plugin instead of Google Maps:

1. Go to **Admin > Configuration > Miscellaneous**
2. Set **Maps URL** to: `https://your-netbox-url/plugins/map/sitemap/?q=`
3. Save

Now clicking the Map button on any Site or Device opens the plugin's site map centered on that location.

## REST API

| Endpoint | Description |
|----------|-------------|
| `/api/plugins/netbox-map/floorplans/` | Floor plan CRUD |
| `/api/plugins/netbox-map/floorplan-tiles/` | Tile CRUD |
| `/api/plugins/netbox-map/location-coordinates/` | Location coordinates |
| `/api/plugins/netbox-map/map-markers/` | Map marker CRUD |

All endpoints support filtering, pagination, and brief mode.

## Requirements

- NetBox 4.5.0+
- Python 3.12+

## Development

```bash
git clone https://github.com/DenDanskeMine/netbox-map.git
cd netbox-map
pip install -e .
```

## License

Apache License 2.0 -- see [LICENSE](LICENSE).

## Support

[Open an issue](https://github.com/DenDanskeMine/netbox-map/issues) on GitHub.
