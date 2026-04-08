# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.9.2] - 2026-03-30

### Fixed
- Migration `NodeNotFoundError` for users who had conflicting merge migrations (#30, #34)

## [0.9.1] - 2026-03-30

### Fixed
- Multi-role filter not working in topology view (#30)
- Migration conflict between 0016 variants (#33)
- Black/missing cable colors in topology
- Text overflow on long device names in stencil cards
- PDF export label positioning

## [0.9.0] - 2026-03-29

This is a major feature release introducing the **Network Topology View**.

### Added
- Interactive topology view with stencil device cards and interface ports
- Hierarchical layout with automatic layer-based sorting (Sugiyama algorithm via dagre)
- Orthogonal cable routing with obstacle avoidance and rounded corners
- Cable coloring by physical type or speed
- Saved views with position persistence, filters, and view mode
- Drag-and-drop device repositioning with snap-to-grid
- Device picker to add/remove devices from the canvas
- Context menu (right-click) for device actions
- Pass-through (patch panel) collapse toggle
- Auto-sort toggle for port ordering
- Pin devices to lock their position
- PDF export of topology view
- Cable labels on hover
- Compact toolbar with grouped controls

## [0.8.2] - 2026-03-23

### Fixed
- Location marker removal and sidebar UX improvements

## [0.8.1] - 2026-03-20

### Fixed
- Text scaling regression on large multi-cell tiles

## [0.8.0] - 2026-03-20

### Fixed
- Various bug fixes for OSM markers, tiles, and export

## [0.7.4] - 2026-03-01

### Fixed
- Patch panel continuation: handle RearPort without trace() and use PortMapping fallback

## [0.7.3] - 2026-03-01

### Added
- Follow cable traces through multiple patch panels

### Fixed
- Drop cable trace direction

## [0.7.2] - 2026-03-01

### Fixed
- Site map navigation link hidden for non-admin users

## [0.7.1] - 2026-03-01

### Fixed
- Use `netbox_map.change_mapmarker` permission for site map edit mode

## [0.7.0] - 2026-03-01

### Added
- Cable type field with clickable connected cables and computed length
- Street-name-style labels on fiber/cable paths on site map
- Contextual cable labels with zoom-adaptive density

### Changed
- Redesigned floorplan sidebar with panel-swap navigation
- Redesigned toolbar into grouped card layout

## [0.6.0] - 2026-02-28

### Added
- Tile text orientation (0/90/180/270°)
- Site map fiber/cable path support (experimental)

### Changed
- Modular JavaScript rewrite of floor plan editor
- UI overhaul for floor plan and site map (#13)

## [0.5.0] - 2026-02-27

### Added
- Drop tile type for network wall plate port assignments (#11)

## [0.4.x] - 2026-02-27

### Added
- Camera FOV visualization with configurable direction, angle, and distance
- PDF export with tiles, labels, and FOV cones
- Custom marker types with icon and color
- Tile port assignments for front/rear ports
- GPS sync — auto-write lat/lng to device records from map placement

## [0.3.x] - 2026-02-22

### Added
- Global site map with Leaflet.js and OpenStreetMap tiles
- Map markers for sites, locations, and standalone objects
- Edit mode for placing and repositioning markers
- Location coordinates model

## [0.2.x - 0.1.x]

Initial releases with core floor plan functionality:
- Canvas-based editor with drag-and-drop tiles
- 12 built-in tile types
- Rack utilization heatmap
- Cable tracing through devices and patch panels
- Site detail page panel integration
- REST API for floor plans and tiles

[0.9.2]: https://github.com/DenDanskeMine/netbox-map/compare/v0.9.1...v0.9.2
[0.9.1]: https://github.com/DenDanskeMine/netbox-map/compare/v0.9.0...v0.9.1
[0.9.0]: https://github.com/DenDanskeMine/netbox-map/compare/v0.8.2...v0.9.0
[0.8.2]: https://github.com/DenDanskeMine/netbox-map/compare/v0.8.1...v0.8.2
[0.8.1]: https://github.com/DenDanskeMine/netbox-map/compare/v0.8.0...v0.8.1
[0.8.0]: https://github.com/DenDanskeMine/netbox-map/compare/v0.7.4...v0.8.0
[0.7.4]: https://github.com/DenDanskeMine/netbox-map/compare/v0.7.3...v0.7.4
[0.7.3]: https://github.com/DenDanskeMine/netbox-map/compare/v0.7.2...v0.7.3
[0.7.2]: https://github.com/DenDanskeMine/netbox-map/compare/v0.7.1...v0.7.2
[0.7.1]: https://github.com/DenDanskeMine/netbox-map/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/DenDanskeMine/netbox-map/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/DenDanskeMine/netbox-map/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/DenDanskeMine/netbox-map/compare/v0.4.4...v0.5.0
