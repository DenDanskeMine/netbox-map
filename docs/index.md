# NetBox Map

A NetBox plugin for interactive floor plan visualization, site maps, network topology, and application dependency mapping.

## Key Features

- **Floor Plans** -- Canvas-based editor with drag-and-drop tiles, rack utilization heatmaps, and PDF export
- **Network Topology** -- Interactive device topology with hierarchical layout, cable routing, and saved views
- **Application Mapping** -- Model applications, deployments, dependencies, and visualize them on the topology
- **Global Site Map** -- Leaflet.js geographic map with markers, cable paths, and GPS sync
- **Cable Tracing** -- Full cable trace through devices and patch panels with "show on map" integration

## Compatibility

| netbox-map | NetBox | Python |
|------------|--------|--------|
| 0.10.x     | 4.5+  | 3.12+  |
| 0.9.x      | 4.5+  | 3.12+  |
| 0.8.x      | 4.5+  | 3.12+  |
| ≤ 0.7.x    | 4.5+  | 3.12+  |

## Dependencies

No additional Python packages required beyond NetBox itself.

## Quick Start

```bash
pip install netbox-map
```

Then add `'netbox_map'` to `PLUGINS` in your NetBox `configuration.py` and run migrations. See the [Installation Guide](getting-started/installation.md) for full instructions.

## Support

- **Bug reports and feature requests**: [GitHub Issues](https://github.com/DenDanskeMine/netbox-map/issues)
- **Source code**: [GitHub Repository](https://github.com/DenDanskeMine/netbox-map)
- **PyPI**: [netbox-map](https://pypi.org/project/netbox-map/)

## License

Apache License 2.0
