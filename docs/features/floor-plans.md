# Floor Plans

The floor plan editor provides a canvas-based interface for visualizing data center layouts, server rooms, and office spaces.

## Creating a Floor Plan

1. Navigate to **Map > Floor Plans > Add**
2. Select a **Site** and enter a **Name**
3. Configure the grid dimensions (width, height, tile size)
4. Optionally upload a **background image** (blueprint or photo)

## Tile Types

Floor plans use a tile-based grid system with 14 built-in tile types:

| Type | Icon | Description |
|------|------|-------------|
| Rack | Server rack | Links to a NetBox rack with utilization heatmap |
| Aisle | Walkway | Corridor between racks |
| Wall | Barrier | Room boundary |
| Column | Pillar | Structural column |
| Door | Entrance | Room entrance |
| Cooling | HVAC | Cooling unit |
| Power | Electrical | Power distribution |
| Empty | Blank | Placeholder tile |
| Reserved | Reserved | Reserved space |
| Access Point | WiFi | Wireless access point |
| Camera | Security | Security camera with FOV visualization |
| Printer | Printer | Network printer |
| Floor Plan Link | Link | Links to another floor plan |
| Drop | Network | Network wall plate with port assignments |

You can also create **custom tile types** at **Map > Custom Marker Types** with custom icons and colors.

## Tile Orientation

Tiles support 4 orientations: 0, 90, 180, and 270 degrees. Text labels automatically rotate to stay readable.

## Rack Visualization

Rack tiles display a utilization heatmap -- color gradient from green (0%) through yellow to red (90%+). Expanding a rack in the sidebar shows:

- All devices sorted by U-position
- Full rack elevation SVG (front and rear views)
- Search across device names and IPs

## Camera FOV

Camera tiles include configurable field-of-view visualization:

- **Direction**: 0-360 degrees
- **Angle**: 10-360 degrees (cone width)
- **Distance**: 1-50 cells (range)

FOV cones render as semi-transparent overlays on the canvas and can be toggled globally.

## Drop Tiles

Drop tiles represent network wall plates. You can assign front ports and rear ports to them, enabling cable trace visualization from the wall plate through patch panels to network switches.

## PDF Export

Export floor plans as PDF documents including all visible tiles, labels, and FOV cones. The export captures the current canvas view.

## Background Images

Upload blueprint images or photos as floor plan backgrounds. The image scales to fit the grid and renders behind all tiles.
