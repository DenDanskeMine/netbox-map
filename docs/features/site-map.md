# Site Map

The global site map displays all your sites, locations, and markers on an interactive geographic map.

## Accessing the Map

Navigate to **Map > Site Map**. The map loads all sites and markers with GPS coordinates.

## Map Features

- **Leaflet.js** with OpenStreetMap tiles
- Sites, locations, floor plan tiles, and standalone markers on one map
- Cluster markers at low zoom levels
- Click markers to view details

## Edit Mode

Users with the `netbox_map.change_mapmarker` permission can enter edit mode:

- Click the map to place new markers
- Drag existing markers to reposition them
- Coordinates auto-save on drop

## GPS Sync

When enabled in settings, placing a device tile on a floor plan (or a marker on the site map) automatically writes the latitude and longitude to the device record in NetBox. Removing the tile/marker clears the GPS coordinates if no other map references remain.

## Cable Paths

Draw fiber/cable paths between markers on the map. Cable paths support:

- Label, fiber count, cable type
- Status (planned, in progress, active, inactive)
- Custom color and weight
- Start/end marker associations

!!! warning "Experimental"
    Cable path support is experimental. Expect breaking changes in future releases.

## URL Deep-Linking

Search for a specific site or device using the `?q=` parameter:

```
https://your-netbox/plugins/map/sitemap/?q=DC-Copenhagen
```
