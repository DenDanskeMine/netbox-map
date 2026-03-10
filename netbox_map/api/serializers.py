from django.contrib.contenttypes.models import ContentType
from rest_framework import serializers

from dcim.api.serializers_.sites import SiteSerializer
from dcim.api.serializers import LocationSerializer
from netbox.api.fields import ContentTypeField
from netbox.api.serializers import NetBoxModelSerializer
from utilities.api import get_serializer_for_model
from ..choices import BUILTIN_TYPE_SLUGS
from ..models import FloorPlan, FloorPlanTile, CustomMarkerType, LocationCoordinates, MapMarker, TilePortAssignment, CablePath, CablePathAssignment, FiberSplice, FiberSplit, TrayLabel, FiberLabel


class CustomMarkerTypeSerializer(NetBoxModelSerializer):
    class Meta:
        model = CustomMarkerType
        fields = [
            'id', 'url', 'display_url', 'display',
            'name', 'slug', 'color', 'icon', 'description',
            'tags', 'custom_fields', 'created', 'last_updated',
        ]
        brief_fields = ('id', 'url', 'display', 'name', 'slug', 'color', 'icon')


def _validate_type_slug(value):
    """Validate that a tile/marker type slug is built-in or a valid custom type."""
    if value in BUILTIN_TYPE_SLUGS:
        return value
    if CustomMarkerType.objects.filter(slug=value).exists():
        return value
    raise serializers.ValidationError(f'Unknown type: {value}')


class FloorPlanSerializer(NetBoxModelSerializer):
    site = SiteSerializer(nested=True)
    location = LocationSerializer(
        nested=True,
        required=False,
        allow_null=True,
        default=None
    )

    class Meta:
        model = FloorPlan
        fields = [
            'id', 'url', 'display_url', 'display', 'site', 'location',
            'name', 'grid_width', 'grid_height', 'tile_size',
            'background_image', 'description', 'comments',
            'tags', 'custom_fields', 'created', 'last_updated',
        ]
        brief_fields = ('id', 'url', 'display', 'name', 'site')


class FloorPlanTileSerializer(NetBoxModelSerializer):
    floorplan = FloorPlanSerializer(nested=True)
    linked_floorplan = FloorPlanSerializer(nested=True, required=False, allow_null=True, default=None)
    assigned_object_type = ContentTypeField(
        queryset=ContentType.objects.filter(
            app_label='dcim',
            model__in=['device', 'rack', 'powerpanel', 'powerfeed', 'rearport', 'frontport'],
        ),
        required=False,
        allow_null=True,
    )
    assigned_object = serializers.SerializerMethodField(read_only=True)
    utilization = serializers.SerializerMethodField(read_only=True)

    class Meta:
        model = FloorPlanTile
        fields = [
            'id', 'url', 'display_url', 'display', 'floorplan',
            'x_position', 'y_position', 'width', 'height',
            'assigned_object_type', 'assigned_object_id', 'assigned_object',
            'label', 'tile_type', 'status', 'orientation',
            'linked_floorplan',
            'fov_direction', 'fov_angle', 'fov_distance',
            'latitude', 'longitude',
            'utilization',
            'tags', 'custom_fields', 'created', 'last_updated',
        ]
        brief_fields = (
            'id', 'url', 'display', 'x_position', 'y_position',
            'label', 'tile_type',
        )

    def get_assigned_object(self, obj):
        if obj.assigned_object is not None:
            serializer = get_serializer_for_model(obj.assigned_object)
            return serializer(obj.assigned_object, nested=True, context=self.context).data
        return None

    def get_utilization(self, obj):
        if obj.assigned_object_type and obj.assigned_object_type.model == 'rack' and obj.assigned_object:
            return round(obj.assigned_object.get_utilization(), 1)
        return None

    def validate_tile_type(self, value):
        return _validate_type_slug(value)


class TilePortAssignmentSerializer(NetBoxModelSerializer):
    port_type = ContentTypeField(
        queryset=ContentType.objects.filter(
            app_label='dcim',
            model__in=['frontport', 'rearport'],
        ),
    )
    port = serializers.SerializerMethodField(read_only=True)

    class Meta:
        model = TilePortAssignment
        fields = [
            'id', 'display',
            'tile', 'port_type', 'port_id', 'port',
            'tags', 'custom_fields', 'created', 'last_updated',
        ]
        brief_fields = ('id', 'display', 'port_type', 'port_id')

    def get_port(self, obj):
        if obj.port is not None:
            return {'display': str(obj.port)}
        return None


class LocationCoordinatesSerializer(NetBoxModelSerializer):
    location = LocationSerializer(nested=True)

    class Meta:
        model = LocationCoordinates
        fields = [
            'id', 'url', 'display_url', 'display', 'location',
            'latitude', 'longitude',
            'tags', 'custom_fields', 'created', 'last_updated',
        ]
        brief_fields = ('id', 'url', 'display', 'location', 'latitude', 'longitude')


class MapMarkerSerializer(NetBoxModelSerializer):
    site = SiteSerializer(nested=True, required=False, allow_null=True, default=None)
    assigned_object_type = ContentTypeField(
        queryset=ContentType.objects.filter(
            app_label='dcim',
            model__in=['device', 'rack', 'powerpanel', 'powerfeed', 'rearport', 'frontport'],
        ),
        required=False,
        allow_null=True,
    )
    assigned_object = serializers.SerializerMethodField(read_only=True)

    class Meta:
        model = MapMarker
        fields = [
            'id', 'url', 'display_url', 'display',
            'latitude', 'longitude', 'label', 'marker_type', 'status',
            'site', 'fov_direction', 'fov_angle', 'fov_distance',
            'assigned_object_type', 'assigned_object_id', 'assigned_object',
            'description',
            'tags', 'custom_fields', 'created', 'last_updated',
        ]
        brief_fields = ('id', 'url', 'display', 'label', 'marker_type', 'latitude', 'longitude')

    def get_assigned_object(self, obj):
        if obj.assigned_object is not None:
            serializer = get_serializer_for_model(obj.assigned_object)
            return serializer(obj.assigned_object, nested=True, context=self.context).data
        return None

    def validate_marker_type(self, value):
        return _validate_type_slug(value)


class CablePathAssignmentSerializer(NetBoxModelSerializer):
    cable_label = serializers.SerializerMethodField(read_only=True)
    cable_status = serializers.SerializerMethodField(read_only=True)
    cable_type = serializers.SerializerMethodField(read_only=True)
    cable_color = serializers.SerializerMethodField(read_only=True)
    cable_length = serializers.SerializerMethodField(read_only=True)
    cable_length_unit = serializers.SerializerMethodField(read_only=True)
    cable_url = serializers.SerializerMethodField(read_only=True)
    a_terminations = serializers.SerializerMethodField(read_only=True)
    b_terminations = serializers.SerializerMethodField(read_only=True)

    class Meta:
        model = CablePathAssignment
        fields = [
            'id', 'display',
            'cable_path', 'cable', 'sequence',
            'cable_label', 'cable_status', 'cable_type', 'cable_color',
            'cable_length', 'cable_length_unit', 'cable_url',
            'a_terminations', 'b_terminations',
            'tags', 'custom_fields', 'created', 'last_updated',
        ]
        brief_fields = ('id', 'display', 'cable', 'cable_label', 'sequence')

    def _fmt_termination(self, term):
        """Format a cable termination for display."""
        label = str(term)
        result = {'label': label, 'type': term._meta.model_name}
        if hasattr(term, 'device') and term.device:
            result['device'] = str(term.device)
        return result

    def get_cable_label(self, obj):
        return obj.cable.label or f'Cable #{obj.cable.pk}'

    def get_cable_status(self, obj):
        return obj.cable.status

    def get_cable_type(self, obj):
        return obj.cable.type or ''

    def get_cable_color(self, obj):
        return obj.cable.color or ''

    def get_cable_length(self, obj):
        return obj.cable.length

    def get_cable_length_unit(self, obj):
        return obj.cable.length_unit or ''

    def get_cable_url(self, obj):
        return obj.cable.get_absolute_url()

    def get_a_terminations(self, obj):
        return [self._fmt_termination(t) for t in (obj.cable.a_terminations or [])]

    def get_b_terminations(self, obj):
        return [self._fmt_termination(t) for t in (obj.cable.b_terminations or [])]


class CablePathSerializer(NetBoxModelSerializer):
    start_marker = MapMarkerSerializer(nested=True, required=False, allow_null=True, default=None)
    end_marker = MapMarkerSerializer(nested=True, required=False, allow_null=True, default=None)
    status_color = serializers.SerializerMethodField(read_only=True)
    display_color = serializers.SerializerMethodField(read_only=True)
    linked_cables = CablePathAssignmentSerializer(
        source='cable_assignments', many=True, read_only=True,
    )

    class Meta:
        model = CablePath
        fields = [
            'id', 'url', 'display_url', 'display',
            'label', 'path_coordinates', 'fiber_count', 'cable_type', 'status', 'status_color',
            'color', 'weight', 'display_color',
            'start_marker', 'end_marker',
            'linked_cables',
            'tags', 'custom_fields', 'created', 'last_updated',
        ]
        brief_fields = ('id', 'url', 'display', 'label', 'status', 'fiber_count', 'cable_type')

    def get_status_color(self, obj):
        return obj.get_status_color()

    def get_display_color(self, obj):
        return obj.get_display_color()


class FiberSpliceSerializer(NetBoxModelSerializer):
    """Serializer for FiberSplice — used by the fiber splicer GUI."""
    port_a_name = serializers.SerializerMethodField(read_only=True)
    port_b_name = serializers.SerializerMethodField(read_only=True)

    class Meta:
        model = FiberSplice
        fields = [
            'id', 'display',
            'device', 'port_a', 'position_a', 'port_b', 'position_b',
            'port_a_name', 'port_b_name',
            'tags', 'custom_fields', 'created', 'last_updated',
        ]
        brief_fields = ('id', 'display', 'port_a', 'position_a', 'port_b', 'position_b')

    def get_port_a_name(self, obj):
        return str(obj.port_a) if obj.port_a else ''

    def get_port_b_name(self, obj):
        return str(obj.port_b) if obj.port_b else ''


class FiberSplitSerializer(NetBoxModelSerializer):
    input_port_name = serializers.SerializerMethodField(read_only=True)
    output_port_name = serializers.SerializerMethodField(read_only=True)

    class Meta:
        model = FiberSplit
        fields = [
            'id', 'display',
            'device', 'input_port', 'input_position',
            'output_port', 'output_position',
            'input_port_name', 'output_port_name',
            'split_ratio', 'loss_db',
            'tags', 'custom_fields', 'created', 'last_updated',
        ]
        brief_fields = ('id', 'display', 'input_port', 'input_position', 'output_port', 'output_position', 'split_ratio')

    def get_input_port_name(self, obj):
        return str(obj.input_port) if obj.input_port else ''

    def get_output_port_name(self, obj):
        return str(obj.output_port) if obj.output_port else ''


class TrayLabelSerializer(NetBoxModelSerializer):
    cable_display = serializers.SerializerMethodField(read_only=True)

    class Meta:
        model = TrayLabel
        fields = [
            'id', 'display',
            'rear_port', 'cable', 'cable_display', 'label', 'tube_color', 'description',
            'tags', 'custom_fields', 'created', 'last_updated',
        ]
        brief_fields = ('id', 'display', 'rear_port', 'label', 'tube_color')

    def get_cable_display(self, obj):
        if obj.cable:
            return obj.cable.label or f'Cable #{obj.cable.pk}'
        return ''


class FiberLabelSerializer(NetBoxModelSerializer):
    class Meta:
        model = FiberLabel
        fields = [
            'id', 'display',
            'rear_port', 'position', 'label', 'color',
            'tags', 'custom_fields', 'created', 'last_updated',
        ]
        brief_fields = ('id', 'display', 'rear_port', 'position', 'label')
