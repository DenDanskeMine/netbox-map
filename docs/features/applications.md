# Application Mapping

Model your applications, their infrastructure deployments, and inter-application dependencies.

## Data Model

### Applications

An application represents a software service (e.g., "Order Service", "PostgreSQL", "Redis Cache").

| Field | Description |
|-------|-------------|
| Name | Application name |
| Status | Active, Planned, Deprecated, Decommissioned |
| Criticality | Critical, High, Medium, Low |
| Environment | Production, Staging, Development, Testing |
| Version | Version string |
| Group | Optional application group for categorization |
| Site | Optional site association |
| Tenant | Optional tenant ownership |

**Unique constraint**: An application is unique per (name, environment, tenant).

### Application Groups

Groups organize applications by category (e.g., "Web Services", "Databases", "Monitoring"). Each group has a color used in topology visualization.

### Deployments

A deployment links an application to a host (Device or Virtual Machine).

| Field | Description |
|-------|-------------|
| Application | The deployed application |
| Host | Device or VM (via GenericForeignKey) |
| Role | Primary, Replica, Worker, Standby |
| Port | Service port number |
| Protocol | Protocol string |
| IP Address | Optional link to NetBox IP address |
| Service | Optional link to NetBox Service |

### Dependencies

A dependency represents a relationship between two applications.

| Field | Description |
|-------|-------------|
| Source | The application that depends on the target |
| Target | The application being depended upon |
| Type | Hard (required) or Soft (optional) |
| Protocol | API, Database, Messaging, gRPC, Filesystem, Other |
| Port | Connection port |
| Status | Active, Planned, Deprecated, Decommissioned |

### Templates

Templates define reusable defaults for bulk application creation. Deploy a template to multiple hosts to create application instances with consistent settings.

## Topology Visualization

### App Cards

In the topology view (Apps or Mixed mode), applications render as cards showing:

- Application name
- Group color bar (left edge)
- Status dot
- Criticality badge
- Dependency ports (left/right sides)
- Host count badge

### Dependency Edges

| Style | Meaning |
|-------|---------|
| Solid colored line | Hard dependency |
| Dashed colored line | Soft dependency |
| Dashed cyan line | Deployed-on (app to device) |

Edge colors reflect criticality: red (critical), orange (high), yellow (medium), blue (low).

### Failure Simulation

Click an application card and use "Simulate Failure" to visualize the impact cascade:

- Failed app highlighted in red
- Impacted apps (via hard dependencies) highlighted in orange
- Degraded apps (via soft dependencies) shown with reduced opacity
- Summary shows count of affected apps by criticality

### Filtering

Filter the application topology by:

- Environment (production, staging, etc.)
- Criticality level
- Status
- Application group
- Site
- Tenant
- Tags

## Device Integration

### Device Detail Page

The plugin adds an **Applications** tab to Device and Virtual Machine detail pages, showing all applications deployed on that host with role, port, and protocol.

A summary panel in the right column shows the top 5 applications with status and criticality badges.

### IP Address and Service Integration

Link deployments to specific NetBox IP addresses and Services for complete infrastructure mapping.

## REST API

All application models are fully CRUD-able via the REST API:

- `/api/plugins/map/applications/`
- `/api/plugins/map/application-groups/`
- `/api/plugins/map/application-templates/`
- `/api/plugins/map/application-deployments/`
- `/api/plugins/map/application-dependencies/`

See the [REST API reference](../api.md) for details.
