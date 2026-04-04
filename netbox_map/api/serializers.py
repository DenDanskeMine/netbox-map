from django.contrib.contenttypes.models import ContentType
from rest_framework import serializers

from dcim.api.serializers_.sites import SiteSerializer
from dcim.api.serializers import LocationSerializer
from netbox.api.fields import ContentTypeField
from netbox.api.serializers import NetBoxModelSerializer
from utilities.api import get_serializer_for_model
from ..choices import BUILTIN_TYPE_SLUGS
from ..models import (
    FloorPlan, FloorPlanTile, CustomMarkerType, LocationCoordinates, MapMarker, TilePortAssignment, CablePath, TopologySavedView,
    ApplicationGroup, ApplicationTemplate, Application, ApplicationDeployment, ApplicationDependency,
)


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


class CablePathSerializer(NetBoxModelSerializer):
    start_marker = MapMarkerSerializer(nested=True, required=False, allow_null=True, default=None)
    end_marker = MapMarkerSerializer(nested=True, required=False, allow_null=True, default=None)
    status_color = serializers.SerializerMethodField(read_only=True)
    display_color = serializers.SerializerMethodField(read_only=True)

    class Meta:
        model = CablePath
        fields = [
            'id', 'url', 'display_url', 'display',
            'label', 'path_coordinates', 'fiber_count', 'cable_type', 'status', 'status_color',
            'color', 'weight', 'display_color',
            'start_marker', 'end_marker',
            'tags', 'custom_fields', 'created', 'last_updated',
        ]
        brief_fields = ('id', 'url', 'display', 'label', 'status', 'fiber_count', 'cable_type')

    def get_status_color(self, obj):
        return obj.get_status_color()

    def get_display_color(self, obj):
        return obj.get_display_color()


class TopologySavedViewSerializer(NetBoxModelSerializer):
    class Meta:
        model = TopologySavedView
        fields = [
            'id', 'url', 'display_url', 'display',
            'name', 'description', 'site', 'filters', 'layout_data', 'view_mode',
            'tags', 'custom_fields', 'created', 'last_updated',
        ]
        brief_fields = ('id', 'url', 'display', 'name')


class ApplicationGroupSerializer(NetBoxModelSerializer):
    class Meta:
        model = ApplicationGroup
        fields = [
            'id', 'url', 'display_url', 'display',
            'name', 'slug', 'color', 'description',
            'tags', 'custom_fields', 'created', 'last_updated',
        ]
        brief_fields = ('id', 'url', 'display', 'name', 'slug', 'color')


class ApplicationTemplateSerializer(NetBoxModelSerializer):
    group = ApplicationGroupSerializer(nested=True, required=False, allow_null=True, default=None)

    class Meta:
        model = ApplicationTemplate
        fields = [
            'id', 'url', 'display_url', 'display',
            'name', 'slug', 'description',
            'default_status', 'default_criticality', 'default_environment', 'default_version',
            'default_port', 'default_protocol', 'default_role',
            'group', 'name_format',
            'tags', 'custom_fields', 'created', 'last_updated',
        ]
        brief_fields = ('id', 'url', 'display', 'name', 'slug')


class ApplicationSerializer(NetBoxModelSerializer):
    group = ApplicationGroupSerializer(nested=True, required=False, allow_null=True, default=None)
    site = SiteSerializer(nested=True, required=False, allow_null=True, default=None)

    class Meta:
        model = Application
        fields = [
            'id', 'url', 'display_url', 'display',
            'name', 'status', 'criticality', 'environment', 'version',
            'default_port', 'default_protocol', 'primary_ip',
            'description', 'comments', 'external_url',
            'group', 'site', 'tenant',
            'tags', 'custom_fields', 'created', 'last_updated',
        ]
        brief_fields = ('id', 'url', 'display', 'name', 'status', 'environment')


class ApplicationDeploymentSerializer(NetBoxModelSerializer):
    application = ApplicationSerializer(nested=True)
    host_type = ContentTypeField(
        queryset=ContentType.objects.filter(
            app_label__in=['dcim', 'virtualization'],
            model__in=['device', 'virtualmachine'],
        ),
    )
    host = serializers.SerializerMethodField(read_only=True)

    class Meta:
        model = ApplicationDeployment
        fields = [
            'id', 'url', 'display_url', 'display',
            'application', 'host_type', 'host_id', 'host',
            'role', 'port', 'protocol', 'ip_address', 'service', 'description',
            'tags', 'custom_fields', 'created', 'last_updated',
        ]
        brief_fields = ('id', 'url', 'display', 'application', 'role')

    def get_host(self, obj):
        if obj.host is not None:
            serializer = get_serializer_for_model(obj.host)
            return serializer(obj.host, nested=True, context=self.context).data
        return None


class ApplicationDependencySerializer(NetBoxModelSerializer):
    source_application = ApplicationSerializer(nested=True)
    target_application = ApplicationSerializer(nested=True)

    class Meta:
        model = ApplicationDependency
        fields = [
            'id', 'url', 'display_url', 'display',
            'source_application', 'target_application',
            'dependency_type', 'protocol', 'port', 'status',
            'description',
            'tags', 'custom_fields', 'created', 'last_updated',
        ]
        brief_fields = ('id', 'url', 'display', 'source_application', 'target_application', 'dependency_type')
