import django_tables2 as tables
from django.utils.safestring import mark_safe
from django.utils.translation import gettext_lazy as _

from netbox.tables import NetBoxTable, columns
from .models import FloorPlanTile, FloorPlan, CustomMarkerType, MapMarker, CablePath


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
    grid_width = tables.Column(
        verbose_name=_('grid_width'),
        accessor='grid_width',
        visible=False,
    )
    grid_height = tables.Column(
        verbose_name=_('grid_height'),
        accessor='grid_height',
        visible=False,
    )
    tile_size = tables.Column(
        verbose_name=_('tile_size'),
        accessor='tile_size',
        visible=False,
    )
    tile_count = tables.Column(
        verbose_name=_('Tiles'),
        accessor='tile_count',
        orderable=False
    )
    floorplan_link = tables.TemplateColumn(
        template_code='<a href="{% url \'plugins:netbox_map:floorplan_visualization\' pk=record.pk %}" '
                       'class="btn btn-sm btn-primary"><i class="mdi mdi-floor-plan"></i> Floorplan</a>',
        verbose_name='',
        orderable=False,
    )
    tags = columns.TagColumn()

    class Meta(NetBoxTable.Meta):
        model = FloorPlan
        fields = (
            'pk', 'id', 'name', 'site', 'location', 'grid_size',
            'grid_width', 'grid_height', 'tile_size',
            'tile_count', 'description', 'floorplan_link', 'tags', 'actions',
        )
        default_columns = (
            'pk', 'name', 'site', 'location', 'grid_size', 'tile_count', 'floorplan_link',
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
    x_position = tables.Column(
        verbose_name=_('x_position'),
        accessor='x_position',
        visible=False,
    )
    y_position = tables.Column(
        verbose_name=_('y_position'),
        accessor='y_position',
        visible=False,
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
    linked_floorplan = tables.Column(
        linkify=True,
        verbose_name=_('Linked Floor Plan'),
        visible=False,
    )
    tags = columns.TagColumn()

    class Meta(NetBoxTable.Meta):
        model = FloorPlanTile
        fields = (
            'pk', 'id', 'floorplan', 'position', 'x_position', 'y_position',
            'assigned_object_type', 'assigned_object', 'label', 'tile_type', 'status',
            'linked_floorplan',
            'width', 'height', 'orientation',
            'fov_direction', 'fov_angle', 'fov_distance',
            'tags', 'actions',
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

    # value_* methods control CSV export output (raw importable values)
    def value_floorplan(self, value, record):
        return record.floorplan.name

    def value_tile_type(self, value, record):
        return record.tile_type

    def value_status(self, value, record):
        return record.status

    def value_assigned_object_type(self, value, record):
        if record.assigned_object_type:
            return record.assigned_object_type.model
        return ''

    def value_assigned_object(self, value, record):
        if record.assigned_object:
            return str(record.assigned_object)
        return ''


class MapMarkerTable(NetBoxTable):
    label = tables.Column(
        linkify=True,
        verbose_name=_('Label')
    )
    marker_type = tables.Column(
        verbose_name=_('Type')
    )
    status = tables.Column(
        verbose_name=_('Status')
    )
    site = tables.Column(
        linkify=True,
        verbose_name=_('Site')
    )
    latitude = tables.Column(
        verbose_name=_('Latitude')
    )
    longitude = tables.Column(
        verbose_name=_('Longitude')
    )
    tags = columns.TagColumn()

    class Meta(NetBoxTable.Meta):
        model = MapMarker
        fields = (
            'pk', 'id', 'label', 'marker_type', 'status', 'site',
            'latitude', 'longitude',
            'fov_direction', 'fov_angle', 'fov_distance',
            'description', 'tags', 'actions',
        )
        default_columns = (
            'pk', 'label', 'marker_type', 'status', 'site', 'latitude', 'longitude',
        )

    # value_* methods control CSV export output (raw importable values)
    def value_marker_type(self, value, record):
        return record.marker_type

    def value_status(self, value, record):
        return record.status


class CablePathTable(NetBoxTable):
    label = tables.Column(
        linkify=True,
        verbose_name=_('Label')
    )
    status = tables.Column(
        verbose_name=_('Status')
    )
    cable_type = tables.Column(
        verbose_name=_('Cable Type')
    )
    fiber_count = tables.Column(
        verbose_name=_('Fiber Count')
    )
    start_marker = tables.Column(
        linkify=True,
        verbose_name=_('Start Marker')
    )
    end_marker = tables.Column(
        linkify=True,
        verbose_name=_('End Marker')
    )
    tags = columns.TagColumn()

    class Meta(NetBoxTable.Meta):
        model = CablePath
        fields = (
            'pk', 'id', 'label', 'status', 'cable_type', 'fiber_count',
            'start_marker', 'end_marker',
            'tags', 'actions',
        )
        default_columns = (
            'pk', 'label', 'status', 'cable_type', 'fiber_count', 'start_marker', 'end_marker',
        )

    def value_status(self, value, record):
        return record.status


class CustomMarkerTypeTable(NetBoxTable):
    name = tables.Column(
        linkify=True,
        verbose_name=_('Name')
    )
    slug = tables.Column(
        verbose_name=_('Slug')
    )
    color = tables.Column(
        verbose_name=_('Color'),
        orderable=False,
    )
    icon = tables.Column(
        verbose_name=_('Icon'),
        orderable=False,
    )
    tags = columns.TagColumn()

    class Meta(NetBoxTable.Meta):
        model = CustomMarkerType
        fields = (
            'pk', 'id', 'name', 'slug', 'color', 'icon', 'description', 'tags', 'actions',
        )
        default_columns = (
            'pk', 'name', 'slug', 'color', 'icon',
        )

    def render_color(self, value):
        return mark_safe(
            f'<span style="display:inline-block;width:16px;height:16px;'
            f'border-radius:3px;background:{value};border:1px solid #ccc;"'
            f' title="{value}"></span> {value}'
        )

    def value_color(self, value):
        return value

    def render_icon(self, value):
        return mark_safe(f'<i class="mdi {value}"></i> {value}')

    def value_icon(self, value):
        return value
