from django.utils.translation import gettext_lazy as _
from netbox.choices import ChoiceSet


class FloorPlanTileTypeChoices(ChoiceSet):
    TYPE_RACK = 'rack'
    TYPE_AISLE = 'aisle'
    TYPE_WALL = 'wall'
    TYPE_COLUMN = 'column'
    TYPE_DOOR = 'door'
    TYPE_COOLING = 'cooling'
    TYPE_POWER = 'power'
    TYPE_EMPTY = 'empty'
    TYPE_RESERVED = 'reserved'
    TYPE_AP = 'ap'
    TYPE_CAMERA = 'camera'
    TYPE_PRINTER = 'printer'
    TYPE_FLOORPLAN_LINK = 'floorplan_link'
    TYPE_DROP = 'drop'
    # #63 — universally relevant built-ins
    TYPE_SWITCH = 'switch'
    TYPE_UPS = 'ups'

    CHOICES = [
        (TYPE_RACK, _('Rack'), 'blue'),
        (TYPE_AISLE, _('Aisle'), 'gray'),
        (TYPE_WALL, _('Wall'), 'dark'),
        (TYPE_COLUMN, _('Column'), 'dark'),
        (TYPE_DOOR, _('Door'), 'teal'),
        (TYPE_COOLING, _('Cooling'), 'cyan'),
        (TYPE_POWER, _('Power'), 'yellow'),
        (TYPE_EMPTY, _('Empty'), 'white'),
        (TYPE_RESERVED, _('Reserved'), 'orange'),
        (TYPE_AP, _('Access Point'), 'purple'),
        (TYPE_CAMERA, _('Camera'), 'red'),
        (TYPE_PRINTER, _('Printer'), 'orange'),
        (TYPE_FLOORPLAN_LINK, _('Floor Plan Link'), 'indigo'),
        (TYPE_DROP, _('Drop'), 'green'),
        (TYPE_SWITCH, _('Switch'), 'blue'),
        (TYPE_UPS, _('UPS'), 'yellow'),
    ]


class FloorPlanTileStatusChoices(ChoiceSet):
    STATUS_ACTIVE = 'active'
    STATUS_PLANNED = 'planned'
    STATUS_DECOMMISSIONED = 'decommissioned'

    CHOICES = [
        (STATUS_ACTIVE, _('Active'), 'green'),
        (STATUS_PLANNED, _('Planned'), 'cyan'),
        (STATUS_DECOMMISSIONED, _('Decommissioned'), 'red'),
    ]


class CablePathStatusChoices(ChoiceSet):
    STATUS_PLANNED = 'planned'
    STATUS_IN_PROGRESS = 'in_progress'
    STATUS_ACTIVE = 'active'
    STATUS_INACTIVE = 'inactive'

    CHOICES = [
        (STATUS_PLANNED, _('Planned'), 'cyan'),
        (STATUS_IN_PROGRESS, _('In Progress'), 'yellow'),
        (STATUS_ACTIVE, _('Active'), 'green'),
        (STATUS_INACTIVE, _('Inactive'), 'red'),
    ]


# ── Built-in type metadata (color + icon for JS/template rendering) ──

BUILTIN_TYPE_CONFIG = {
    'rack':           {'name': 'Rack', 'color': '#4a7eff', 'icon': 'mdi-collage'},
    'aisle':          {'name': 'Aisle', 'color': '#3a3a50', 'icon': 'mdi-arrow-expand-horizontal'},
    'wall':           {'name': 'Wall', 'color': '#5c5c6e', 'icon': 'mdi-wall'},
    'column':         {'name': 'Column', 'color': '#6e6e80', 'icon': 'mdi-square-outline'},
    'door':           {'name': 'Door', 'color': '#1a8a7a', 'icon': 'mdi-door-open'},
    'cooling':        {'name': 'Cooling', 'color': '#1890b0', 'icon': 'mdi-snowflake'},
    'power':          {'name': 'Power', 'color': '#c89a20', 'icon': 'mdi-flash-outline'},
    'empty':          {'name': 'Empty', 'color': '#2a2a3e', 'icon': 'mdi-checkbox-blank-outline'},
    'reserved':       {'name': 'Reserved', 'color': '#b06820', 'icon': 'mdi-calendar-clock'},
    'ap':             {'name': 'Access Point', 'color': '#7b42c8', 'icon': 'mdi-wifi'},
    'camera':         {'name': 'Camera', 'color': '#c42020', 'icon': 'mdi-cctv'},
    'printer':        {'name': 'Printer', 'color': '#e67e22', 'icon': 'mdi-printer'},
    'floorplan_link': {'name': 'Floor Plan Link', 'color': '#4a50c8', 'icon': 'mdi-floor-plan'},
    'drop':           {'name': 'Drop', 'color': '#2ecc71', 'icon': 'mdi-ethernet'},
    # #63 — Switch and UPS are universally relevant — added as built-ins
    'switch':         {'name': 'Switch', 'color': '#2980b9', 'icon': 'mdi-lan'},
    'ups':            {'name': 'UPS', 'color': '#f1c40f', 'icon': 'mdi-battery-high'},
    # FTTH / Fiber types
    'splice_closure': {'name': 'Splice Closure', 'color': '#e67e22', 'icon': 'mdi-connection'},
    'olt':            {'name': 'OLT', 'color': '#2ecc71', 'icon': 'mdi-server-network'},
    'ont':            {'name': 'ONT', 'color': '#3498db', 'icon': 'mdi-router-wireless'},
    'splitter':       {'name': 'Splitter', 'color': '#9b59b6', 'icon': 'mdi-call-split'},
    'fdt':            {'name': 'FDT', 'color': '#1abc9c', 'icon': 'mdi-package-variant-closed'},
    'fat':            {'name': 'FAT', 'color': '#e74c3c', 'icon': 'mdi-access-point'},
    'manhole':        {'name': 'Manhole', 'color': '#7f8c8d', 'icon': 'mdi-circle-outline'},
    'pole':           {'name': 'Pole', 'color': '#f39c12', 'icon': 'mdi-transmission-tower'},
    'handhole':       {'name': 'Handhole', 'color': '#95a5a6', 'icon': 'mdi-circle-half-full'},
}

# Set of all built-in slugs for quick lookup
BUILTIN_TYPE_SLUGS = set(BUILTIN_TYPE_CONFIG.keys())

# #63 — Tile types hidden from the FLOOR PLAN editor toolbar by default
# for fresh installs. Existing installs are unaffected (the field defaults
# to an empty list and load() does not retroactively touch it).
DEFAULT_HIDDEN_TILE_TYPES = [
    'splice_closure', 'olt', 'ont', 'splitter',
    'fdt', 'fat', 'manhole', 'pole', 'handhole',
]

# Default-hidden types in the SITE MAP create-chip tray. The Site Map deals
# with geographic markers, so the structural floor-plan-only types (column,
# wall, aisle, empty, reserved) are rarely useful there — hide by default
# in addition to the fiber types above.
DEFAULT_HIDDEN_TILE_TYPES_SITEMAP = DEFAULT_HIDDEN_TILE_TYPES + [
    'column', 'wall', 'aisle', 'empty', 'reserved',
]


def get_all_tile_type_choices():
    """Return (slug, label) pairs for built-in + custom types."""
    from .models import CustomMarkerType
    choices = list(FloorPlanTileTypeChoices)
    for ct in CustomMarkerType.objects.order_by('name'):
        choices.append((ct.slug, ct.name))
    return choices


def get_tile_type_display(slug):
    """Return display name for any type slug (built-in or custom)."""
    if slug in BUILTIN_TYPE_CONFIG:
        return BUILTIN_TYPE_CONFIG[slug]['name']
    from .models import CustomMarkerType
    try:
        return CustomMarkerType.objects.get(slug=slug).name
    except CustomMarkerType.DoesNotExist:
        return slug


def get_all_type_configs():
    """Return list of dicts for JS injection: [{slug, name, color, icon, icon_fg, builtin}, ...]"""
    from .models import CustomMarkerType
    configs = []
    for slug, info in BUILTIN_TYPE_CONFIG.items():
        configs.append({
            'slug': slug,
            'name': info['name'],
            'color': info['color'],
            'icon': info['icon'],
            # Built-ins inherit the auto-contrast rule via the JS helper —
            # send 'auto' so the frontend computes it from the background.
            'icon_fg': info.get('icon_fg', 'auto'),
            'builtin': True,
        })
    for ct in CustomMarkerType.objects.order_by('name'):
        configs.append({
            'slug': ct.slug,
            'name': ct.name,
            'color': ct.color,
            'icon': ct.icon,
            'icon_fg': ct.resolved_icon_foreground(),
            'builtin': False,
        })
    return configs


#
# Application choices
#

class ApplicationStatusChoices(ChoiceSet):
    STATUS_ACTIVE = 'active'
    STATUS_PLANNED = 'planned'
    STATUS_DEPRECATED = 'deprecated'
    STATUS_DECOMMISSIONED = 'decommissioned'

    CHOICES = [
        (STATUS_ACTIVE, _('Active'), 'green'),
        (STATUS_PLANNED, _('Planned'), 'cyan'),
        (STATUS_DEPRECATED, _('Deprecated'), 'yellow'),
        (STATUS_DECOMMISSIONED, _('Decommissioned'), 'red'),
    ]


class ApplicationCriticalityChoices(ChoiceSet):
    CRITICALITY_LOW = 'low'
    CRITICALITY_MEDIUM = 'medium'
    CRITICALITY_HIGH = 'high'
    CRITICALITY_CRITICAL = 'critical'

    CHOICES = [
        (CRITICALITY_LOW, _('Low'), 'blue'),
        (CRITICALITY_MEDIUM, _('Medium'), 'yellow'),
        (CRITICALITY_HIGH, _('High'), 'orange'),
        (CRITICALITY_CRITICAL, _('Critical'), 'red'),
    ]


class ApplicationEnvironmentChoices(ChoiceSet):
    ENV_PRODUCTION = 'production'
    ENV_STAGING = 'staging'
    ENV_DEVELOPMENT = 'development'
    ENV_TESTING = 'testing'

    CHOICES = [
        (ENV_PRODUCTION, _('Production'), 'green'),
        (ENV_STAGING, _('Staging'), 'yellow'),
        (ENV_DEVELOPMENT, _('Development'), 'cyan'),
        (ENV_TESTING, _('Testing'), 'blue'),
    ]


class DependencyTypeChoices(ChoiceSet):
    TYPE_HARD = 'hard'
    TYPE_SOFT = 'soft'

    CHOICES = [
        (TYPE_HARD, _('Hard'), 'red'),
        (TYPE_SOFT, _('Soft'), 'blue'),
    ]


class DependencyProtocolChoices(ChoiceSet):
    PROTO_API = 'api'
    PROTO_DATABASE = 'database'
    PROTO_MESSAGING = 'messaging'
    PROTO_GRPC = 'grpc'
    PROTO_FILESYSTEM = 'filesystem'
    PROTO_OTHER = 'other'

    CHOICES = [
        (PROTO_API, _('API (HTTP/REST)'), 'blue'),
        (PROTO_DATABASE, _('Database'), 'green'),
        (PROTO_MESSAGING, _('Messaging/Queue'), 'purple'),
        (PROTO_GRPC, _('gRPC'), 'cyan'),
        (PROTO_FILESYSTEM, _('Filesystem/NFS'), 'yellow'),
        (PROTO_OTHER, _('Other'), 'gray'),
    ]


class DeploymentRoleChoices(ChoiceSet):
    ROLE_PRIMARY = 'primary'
    ROLE_REPLICA = 'replica'
    ROLE_WORKER = 'worker'
    ROLE_STANDBY = 'standby'

    CHOICES = [
        (ROLE_PRIMARY, _('Primary'), 'green'),
        (ROLE_REPLICA, _('Replica'), 'blue'),
        (ROLE_WORKER, _('Worker'), 'cyan'),
        (ROLE_STANDBY, _('Standby'), 'yellow'),
    ]
