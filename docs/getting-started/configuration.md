# Configuration

## Plugin Settings

The plugin ships with sensible defaults. You can override them in `configuration.py`:

```python
PLUGINS_CONFIG = {
    'netbox_map': {
        'default_grid_width': 20,
        'default_grid_height': 20,
        'default_tile_size': 60,
    },
}
```

| Setting | Default | Description |
|---------|---------|-------------|
| `default_grid_width` | `20` | Default number of columns for new floor plans |
| `default_grid_height` | `20` | Default number of rows for new floor plans |
| `default_tile_size` | `60` | Default tile size in pixels for new floor plans |

## Web UI Settings

Additional settings are configurable from the browser at **Map > Settings**:

| Setting | Default | Description |
|---------|---------|-------------|
| Show MAC Address | On | Display MAC addresses in the detail panel |
| Show Custom Fields | On | Display custom fields in the detail panel |
| Sync Device GPS | On | Auto-write lat/lng to device records when placed on a map |
| Device Fields | status, role, device_type, ... | Standard fields shown for devices |
| Rack Fields | status, role, facility_id, ... | Standard fields shown for racks |
| Popover Fields | label, object_info, ... | Fields shown in the floor plan hover popover |

These settings are stored in the database and apply globally. They can also be managed via the REST API at `/api/plugins/map/map-settings/`.

## Maps URL Deep-Linking

Point NetBox's built-in Map button to this plugin instead of Google Maps:

1. Go to **Admin > Configuration > Miscellaneous**
2. Set **Maps URL** to: `https://your-netbox-url/plugins/map/sitemap/?q=`
3. Save

Now clicking the Map button on any Site or Device opens the plugin's site map centered on that location.

## Permissions

The plugin uses NetBox's standard object-based permissions. Key permissions:

| Permission | Description |
|-----------|-------------|
| `netbox_map.view_floorplan` | View floor plans |
| `netbox_map.add_floorplan` | Create floor plans |
| `netbox_map.change_floorplan` | Edit floor plans and tiles |
| `netbox_map.delete_floorplan` | Delete floor plans |
| `netbox_map.change_mapmarker` | Required for site map edit mode |
| `netbox_map.view_application` | View applications and topology |
| `netbox_map.add_application` | Create applications and deployments |

All models follow the same `view`, `add`, `change`, `delete` pattern.
