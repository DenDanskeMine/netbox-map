# REST API

All plugin models are accessible via NetBox's REST API. The base URL is `/api/plugins/map/`.

All endpoints support:

- Standard CRUD operations (GET, POST, PATCH, PUT, DELETE)
- Bulk create, update, and delete
- Filtering via query parameters
- Pagination
- Brief mode (`?brief=true` for lightweight responses)
- Tag filtering

## Authentication

Use a NetBox API token in the `Authorization` header:

```
Authorization: Token <your-token>
```

## Endpoints

### Floor Plans

| Method | URL | Description |
|--------|-----|-------------|
| GET | `/api/plugins/map/floorplans/` | List floor plans |
| POST | `/api/plugins/map/floorplans/` | Create a floor plan |
| GET | `/api/plugins/map/floorplans/{id}/` | Get a floor plan |
| PATCH | `/api/plugins/map/floorplans/{id}/` | Update a floor plan |
| DELETE | `/api/plugins/map/floorplans/{id}/` | Delete a floor plan |

**Filters**: `site_id`, `location_id`, `name`, `q` (search)

### Floor Plan Tiles

| Method | URL | Description |
|--------|-----|-------------|
| GET | `/api/plugins/map/floorplan-tiles/` | List tiles |
| POST | `/api/plugins/map/floorplan-tiles/` | Create a tile |
| GET | `/api/plugins/map/floorplan-tiles/{id}/` | Get a tile |
| PATCH | `/api/plugins/map/floorplan-tiles/{id}/` | Update a tile |
| DELETE | `/api/plugins/map/floorplan-tiles/{id}/` | Delete a tile |

**Filters**: `floorplan_id`, `tile_type`, `status`, `q` (search)

### Map Markers

| Method | URL | Description |
|--------|-----|-------------|
| GET | `/api/plugins/map/map-markers/` | List markers |
| POST | `/api/plugins/map/map-markers/` | Create a marker |
| PATCH | `/api/plugins/map/map-markers/{id}/` | Update a marker |
| DELETE | `/api/plugins/map/map-markers/{id}/` | Delete a marker |

**Filters**: `site_id`, `marker_type`, `status`, `q` (search)

### Cable Paths

| Method | URL | Description |
|--------|-----|-------------|
| GET | `/api/plugins/map/cable-paths/` | List cable paths |
| POST | `/api/plugins/map/cable-paths/` | Create a cable path |
| PATCH | `/api/plugins/map/cable-paths/{id}/` | Update a cable path |
| DELETE | `/api/plugins/map/cable-paths/{id}/` | Delete a cable path |

**Filters**: `status`, `cable_type`, `start_marker_id`, `end_marker_id`, `q` (search)

### Custom Marker Types

| Method | URL | Description |
|--------|-----|-------------|
| GET | `/api/plugins/map/custom-marker-types/` | List custom types |
| POST | `/api/plugins/map/custom-marker-types/` | Create a custom type |
| PATCH | `/api/plugins/map/custom-marker-types/{id}/` | Update a custom type |
| DELETE | `/api/plugins/map/custom-marker-types/{id}/` | Delete a custom type |

**Filters**: `name`, `slug`, `q` (search)

### Location Coordinates

| Method | URL | Description |
|--------|-----|-------------|
| GET | `/api/plugins/map/location-coordinates/` | List coordinates |
| POST | `/api/plugins/map/location-coordinates/` | Create coordinates |
| PATCH | `/api/plugins/map/location-coordinates/{id}/` | Update coordinates |
| DELETE | `/api/plugins/map/location-coordinates/{id}/` | Delete coordinates |

**Filters**: `location_id`, `site_id`, `q` (search)

### Tile Port Assignments

| Method | URL | Description |
|--------|-----|-------------|
| GET | `/api/plugins/map/tile-port-assignments/` | List assignments |
| POST | `/api/plugins/map/tile-port-assignments/` | Create an assignment |
| PATCH | `/api/plugins/map/tile-port-assignments/{id}/` | Update an assignment |
| DELETE | `/api/plugins/map/tile-port-assignments/{id}/` | Delete an assignment |

**Filters**: `tile_id`

### Topology Saved Views

| Method | URL | Description |
|--------|-----|-------------|
| GET | `/api/plugins/map/topology-saved-views/` | List saved views |
| POST | `/api/plugins/map/topology-saved-views/` | Create a saved view |
| PATCH | `/api/plugins/map/topology-saved-views/{id}/` | Update a saved view |
| DELETE | `/api/plugins/map/topology-saved-views/{id}/` | Delete a saved view |

**Filters**: `name`, `site_id`, `q` (search)

### Map Settings (Singleton)

| Method | URL | Description |
|--------|-----|-------------|
| GET | `/api/plugins/map/map-settings/` | Get settings |
| PATCH | `/api/plugins/map/map-settings/` | Update settings |

No filtering. This is a single-object endpoint.

### Applications

| Method | URL | Description |
|--------|-----|-------------|
| GET | `/api/plugins/map/applications/` | List applications |
| POST | `/api/plugins/map/applications/` | Create an application |
| PATCH | `/api/plugins/map/applications/{id}/` | Update an application |
| DELETE | `/api/plugins/map/applications/{id}/` | Delete an application |

**Filters**: `status`, `criticality`, `environment`, `site_id`, `tenant_id`, `group_id`, `q` (search)

### Application Groups

| Method | URL | Description |
|--------|-----|-------------|
| GET | `/api/plugins/map/application-groups/` | List groups |
| POST | `/api/plugins/map/application-groups/` | Create a group |
| PATCH | `/api/plugins/map/application-groups/{id}/` | Update a group |
| DELETE | `/api/plugins/map/application-groups/{id}/` | Delete a group |

**Filters**: `name`, `slug`, `q` (search)

### Application Templates

| Method | URL | Description |
|--------|-----|-------------|
| GET | `/api/plugins/map/application-templates/` | List templates |
| POST | `/api/plugins/map/application-templates/` | Create a template |
| PATCH | `/api/plugins/map/application-templates/{id}/` | Update a template |
| DELETE | `/api/plugins/map/application-templates/{id}/` | Delete a template |

**Filters**: `name`, `group_id`, `default_status`, `default_criticality`, `default_environment`, `q` (search)

### Application Deployments

| Method | URL | Description |
|--------|-----|-------------|
| GET | `/api/plugins/map/application-deployments/` | List deployments |
| POST | `/api/plugins/map/application-deployments/` | Create a deployment |
| PATCH | `/api/plugins/map/application-deployments/{id}/` | Update a deployment |
| DELETE | `/api/plugins/map/application-deployments/{id}/` | Delete a deployment |

**Filters**: `application_id`, `host_type`, `role`

**Example**: Create a deployment:

```json
POST /api/plugins/map/application-deployments/
{
    "application": 1,
    "host_type": "dcim.device",
    "host_id": 42,
    "role": "primary",
    "port": 8080,
    "protocol": "tcp"
}
```

### Application Dependencies

| Method | URL | Description |
|--------|-----|-------------|
| GET | `/api/plugins/map/application-dependencies/` | List dependencies |
| POST | `/api/plugins/map/application-dependencies/` | Create a dependency |
| PATCH | `/api/plugins/map/application-dependencies/{id}/` | Update a dependency |
| DELETE | `/api/plugins/map/application-dependencies/{id}/` | Delete a dependency |

**Filters**: `source_application_id`, `target_application_id`, `dependency_type`, `protocol`, `status`

**Example**: Create a dependency:

```json
POST /api/plugins/map/application-dependencies/
{
    "source_application": 1,
    "target_application": 2,
    "dependency_type": "hard",
    "protocol": "database",
    "port": 5432
}
```
