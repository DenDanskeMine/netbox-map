# Topology View

The topology view provides an interactive network diagram showing devices, cables, and their interconnections.

## Accessing the Topology

Navigate to **Map > Topology** and select a site. The topology loads all devices and cables for that site.

## View Modes

The topology supports three modes, toggled via toolbar buttons:

| Mode | Description |
|------|-------------|
| **Network** | Device stencil cards with interface ports and cable connections |
| **Apps** | Application cards with dependency edges |
| **Mixed** | Both devices and apps together with deployed-on connections |

## Network Mode

### Device Cards

Devices render as stencil cards showing:

- Device name and type
- Status indicator (green dot)
- Interface ports on left/right sides
- Port speed labels (e.g., "10G")

### Cable Routing

Cables render as orthogonal paths between interface ports with:

- Color by physical type or speed (toggle in toolbar)
- Obstacle avoidance around device cards
- Cable labels on hover
- Connector dots at port endpoints

### Layout

The default layout uses hierarchical layering (Sugiyama algorithm via dagre):

- Switches and routers at the top
- Patch panels in the middle
- Servers at the bottom
- Auto-sort toggle for port ordering

You can customize the layout by:

- **Dragging** devices to new positions
- **Snap to grid** (hold Shift while dragging)
- **Pinning** devices to lock their position
- **Auto-sort** ports by connection topology

### Pass-Through Collapse

Toggle the pass-through collapse button to hide patch panels and show direct switch-to-server connections.

## Apps Mode

See [Application Mapping](applications.md) for details on the application topology view.

## Mixed Mode ![Beta](https://img.shields.io/badge/status-beta-orange.svg)

!!! warning "Beta"
    Mixed mode is under active development. Layout and edge routing may change in upcoming releases.

Mixed mode combines network and application topology:

- Devices render with full interface ports (same as network mode)
- App cards position near their host device
- Deployed-on edges (dashed cyan) connect apps to devices
- Dependency edges (solid/dashed colored) show app relationships
- Dragging a device updates its connected app edges in real-time

## Saved Views

Save the current topology layout including:

- Device and app card positions
- Filter selections
- View mode (network/apps/mixed)
- Hidden/pinned node state

Create saved views via the toolbar save button. Load them from the view selector dropdown.

## Toolbar Controls

| Control | Description |
|---------|-------------|
| Mode toggle | Switch between Network, Apps, Mixed |
| View selector | Load/save topology views |
| Reset Layout | Recalculate all positions from scratch |
| Cable color | Toggle physical type vs speed coloring |
| Edge style | Toggle orthogonal vs bezier curves |
| Pass-through | Collapse/expand patch panels |
| Auto-sort | Toggle automatic port sorting |
| Grid snap | Toggle snap-to-grid |
| PDF export | Export current view to PDF |

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| Shift + drag | Snap to grid while dragging |
| Right-click | Context menu (view neighbors, remove device) |
| Scroll | Zoom in/out |
| Click background | Deselect all |

## URL Sharing

The topology URL updates as you interact, encoding the current mode, focused app, and view ID. Share the URL to link others directly to a specific topology state.
