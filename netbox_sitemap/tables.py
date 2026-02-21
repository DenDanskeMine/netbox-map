import django_tables2 as tables
from django.utils.translation import gettext_lazy as _

from netbox.tables import NetBoxTable, columns
from .models import FloorPlanTile, FloorPlan


class FloorPlanTable(NetBoxTable):
    name = tables.Column(
        linkify=True,
        verbose_name=_('Name')
    )
    site = tables.Column(
        linkify=True,
        verbose_name=_('Site')
    )
    location = tables.Column(
        linkify=True,
        verbose_name=_('Location')
    )
    grid_size = tables.Column(
        verbose_name=_('Grid Size'),
        accessor='grid_width',
        orderable=False
    )
    tile_count = tables.Column(
        verbose_name=_('Tiles'),
        accessor='tile_count',
        orderable=False
    )
    tags = columns.TagColumn()

    class Meta(NetBoxTable.Meta):
        model = FloorPlan
        fields = (
            'pk', 'id', 'name', 'site', 'location', 'grid_size',
            'tile_count', 'description', 'tags', 'actions',
        )
        default_columns = (
            'pk', 'name', 'site', 'location', 'grid_size', 'tile_count',
        )

    def render_grid_size(self, record):
        return f'{record.grid_width} x {record.grid_height}'


class FloorPlanTileTable(NetBoxTable):
    floorplan = tables.Column(
        linkify=True,
        verbose_name=_('Floor Plan')
    )
    position = tables.Column(
        verbose_name=_('Position'),
        accessor='x_position',
        orderable=False
    )
    assigned_object_type = tables.Column(
        verbose_name=_('Object Type'),
        accessor='assigned_object_type',
        orderable=False
    )
    assigned_object = tables.Column(
        verbose_name=_('Assigned Object'),
        accessor='assigned_object',
        orderable=False,
    )
    tile_type = tables.Column(
        verbose_name=_('Tile Type')
    )
    status = tables.Column(
        verbose_name=_('Status')
    )
    label = tables.Column(
        verbose_name=_('Label')
    )
    tags = columns.TagColumn()

    class Meta(NetBoxTable.Meta):
        model = FloorPlanTile
        fields = (
            'pk', 'id', 'floorplan', 'position', 'assigned_object_type',
            'assigned_object', 'label', 'tile_type', 'status',
            'width', 'height', 'orientation', 'tags', 'actions',
        )
        default_columns = (
            'pk', 'floorplan', 'position', 'assigned_object_type',
            'assigned_object', 'label', 'tile_type',
        )

    def render_position(self, record):
        return f'({record.x_position}, {record.y_position})'

    def render_assigned_object_type(self, value, record):
        if value:
            return value.model_class()._meta.verbose_name.title()
        return '-'

    def render_assigned_object(self, value, record):
        if value:
            return str(value)
        return '-'
