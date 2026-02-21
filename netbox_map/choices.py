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
