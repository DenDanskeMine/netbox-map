from django.contrib.contenttypes.models import ContentType
from rest_framework import serializers

from dcim.api.serializers_.sites import SiteSerializer
from dcim.api.serializers import LocationSerializer
from netbox.api.fields import ContentTypeField
from netbox.api.serializers import NetBoxModelSerializer
from utilities.api import get_serializer_for_model
from ..models import FloorPlan, FloorPlanTile


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
    assigned_object_type = ContentTypeField(
        queryset=ContentType.objects.filter(
            app_label='dcim',
            model__in=['device', 'rack', 'powerpanel', 'powerfeed'],
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
            'fov_direction', 'fov_angle', 'fov_distance',
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
