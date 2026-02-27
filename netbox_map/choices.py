from netbox.choices import ChoiceSet
from django.utils.translation import gettext_lazy as _


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


# ── Built-in type metadata (color + icon for JS/template rendering) ──

BUILTIN_TYPE_CONFIG = {
    'rack':           {'name': 'Rack',            'color': '#4a7eff', 'icon': 'mdi-collage'},
    'aisle':          {'name': 'Aisle',           'color': '#3a3a50', 'icon': 'mdi-arrow-expand-horizontal'},
    'wall':           {'name': 'Wall',            'color': '#5c5c6e', 'icon': 'mdi-wall'},
    'column':         {'name': 'Column',          'color': '#6e6e80', 'icon': 'mdi-square-outline'},
    'door':           {'name': 'Door',            'color': '#1a8a7a', 'icon': 'mdi-door-open'},
    'cooling':        {'name': 'Cooling',         'color': '#1890b0', 'icon': 'mdi-snowflake'},
    'power':          {'name': 'Power',           'color': '#c89a20', 'icon': 'mdi-flash-outline'},
    'empty':          {'name': 'Empty',           'color': '#2a2a3e', 'icon': 'mdi-checkbox-blank-outline'},
    'reserved':       {'name': 'Reserved',        'color': '#b06820', 'icon': 'mdi-calendar-clock'},
    'ap':             {'name': 'Access Point',    'color': '#7b42c8', 'icon': 'mdi-wifi'},
    'camera':         {'name': 'Camera',          'color': '#c42020', 'icon': 'mdi-cctv'},
    'printer':        {'name': 'Printer',         'color': '#e67e22', 'icon': 'mdi-printer'},
    'floorplan_link': {'name': 'Floor Plan Link', 'color': '#4a50c8', 'icon': 'mdi-floor-plan'},
}

# Set of all built-in slugs for quick lookup
BUILTIN_TYPE_SLUGS = set(BUILTIN_TYPE_CONFIG.keys())


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
    """Return list of dicts for JS injection: [{slug, name, color, icon, builtin}, ...]"""
    from .models import CustomMarkerType
    configs = []
    for slug, info in BUILTIN_TYPE_CONFIG.items():
        configs.append({
            'slug': slug,
            'name': info['name'],
            'color': info['color'],
            'icon': info['icon'],
            'builtin': True,
        })
    for ct in CustomMarkerType.objects.order_by('name'):
        configs.append({
            'slug': ct.slug,
            'name': ct.name,
            'color': ct.color,
            'icon': ct.icon,
            'builtin': False,
        })
    return configs
