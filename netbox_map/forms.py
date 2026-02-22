from django import forms
from django.contrib.contenttypes.models import ContentType
from django.utils.translation import gettext_lazy as _

from dcim.models import Site, Location, Rack, Device, PowerPanel, PowerFeed
from netbox.forms import NetBoxModelForm, NetBoxModelFilterSetForm, NetBoxModelBulkEditForm
from utilities.forms.fields import (
    ContentTypeChoiceField,
    DynamicModelChoiceField,
    CommentField,
)
from utilities.forms.rendering import FieldSet
from .models import FloorPlan, FloorPlanTile, MapMarker, ASSIGNABLE_MODELS
from .choices import FloorPlanTileTypeChoices, FloorPlanTileStatusChoices


def get_assignable_content_types():
    """Return a queryset of ContentTypes for assignable models."""
    return ContentType.objects.filter(
        app_label='dcim',
        model__in=['device', 'rack', 'powerpanel', 'powerfeed'],
    ).order_by('model')


#
# FloorPlan forms
#

class FloorPlanForm(NetBoxModelForm):
    site = DynamicModelChoiceField(
        label=_('Site'),
        queryset=Site.objects.all(),
    )
    location = DynamicModelChoiceField(
        label=_('Location'),
        queryset=Location.objects.all(),
        required=False,
        query_params={
            'site_id': '$site'
        }
    )
    comments = CommentField()

    fieldsets = (
        FieldSet(
            'site', 'location', 'name', 'description', 'tags',
            name=_('Floor Plan')
        ),
        FieldSet(
            'grid_width', 'grid_height', 'tile_size',
            name=_('Grid Configuration')
        ),
        FieldSet(
            'background_image',
            name=_('Background')
        ),
    )

    class Meta:
        model = FloorPlan
        fields = [
            'site', 'location', 'name', 'grid_width', 'grid_height',
            'tile_size', 'background_image', 'description', 'comments', 'tags',
        ]


class FloorPlanFilterForm(NetBoxModelFilterSetForm):
    model = FloorPlan
    site_id = DynamicModelChoiceField(
        queryset=Site.objects.all(),
        required=False,
        label=_('Site')
    )
    location_id = DynamicModelChoiceField(
        queryset=Location.objects.all(),
        required=False,
        label=_('Location'),
        query_params={
            'site_id': '$site_id'
        }
    )

    fieldsets = (
        FieldSet('site_id', 'location_id'),
    )


class FloorPlanBulkEditForm(NetBoxModelBulkEditForm):
    grid_width = forms.IntegerField(required=False)
    grid_height = forms.IntegerField(required=False)
    tile_size = forms.IntegerField(required=False)
    description = forms.CharField(max_length=200, required=False)

    model = FloorPlan
    nullable_fields = ('location', 'description', 'background_image')


#
# FloorPlanTile forms
#

class FloorPlanTileForm(NetBoxModelForm):
    floorplan = DynamicModelChoiceField(
        label=_('Floor Plan'),
        queryset=FloorPlan.objects.all()
    )
    assigned_object_type = ContentTypeChoiceField(
        label=_('Object Type'),
        queryset=get_assignable_content_types(),
        required=False,
        help_text=_('Select the type of object to assign (Rack, Device, etc.)')
    )
    rack = DynamicModelChoiceField(
        label=_('Rack'),
        queryset=Rack.objects.all(),
        required=False,
        query_params={
            'site_id': '$floorplan',
        }
    )
    device = DynamicModelChoiceField(
        label=_('Device'),
        queryset=Device.objects.all(),
        required=False,
        query_params={
            'site_id': '$floorplan',
        }
    )
    powerpanel = DynamicModelChoiceField(
        label=_('Power Panel'),
        queryset=PowerPanel.objects.all(),
        required=False,
        query_params={
            'site_id': '$floorplan',
        }
    )
    powerfeed = DynamicModelChoiceField(
        label=_('Power Feed'),
        queryset=PowerFeed.objects.all(),
        required=False,
    )

    fieldsets = (
        FieldSet(
            'floorplan', 'x_position', 'y_position', 'width', 'height',
            'orientation', 'tags',
            name=_('Position')
        ),
        FieldSet(
            'tile_type', 'status', 'label',
            name=_('Tile')
        ),
        FieldSet(
            'fov_direction', 'fov_angle', 'fov_distance',
            name=_('Camera FOV Settings')
        ),
        FieldSet(
            'assigned_object_type', 'rack', 'device', 'powerpanel', 'powerfeed',
            name=_('Assigned Object')
        ),
    )

    class Meta:
        model = FloorPlanTile
        fields = [
            'floorplan', 'x_position', 'y_position', 'width', 'height',
            'label', 'tile_type', 'status', 'orientation',
            'fov_direction', 'fov_angle', 'fov_distance',
            'assigned_object_type', 'tags',
        ]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)

        # Pre-populate the object selector if editing an existing tile
        if self.instance.pk and self.instance.assigned_object_type:
            model_name = self.instance.assigned_object_type.model
            if model_name in ('rack', 'device', 'powerpanel', 'powerfeed'):
                field = self.fields.get(model_name)
                if field and self.instance.assigned_object_id:
                    field.initial = self.instance.assigned_object_id

    def clean(self):
        super().clean()

        assigned_object_type = self.cleaned_data.get('assigned_object_type')

        if assigned_object_type:
            model_name = assigned_object_type.model
            obj = self.cleaned_data.get(model_name)
            if obj:
                self.cleaned_data['assigned_object_id'] = obj.pk
            else:
                self.cleaned_data['assigned_object_id'] = None
                self.cleaned_data['assigned_object_type'] = None
        else:
            self.cleaned_data['assigned_object_type'] = None
            self.cleaned_data['assigned_object_id'] = None

        return self.cleaned_data

    def save(self, *args, **kwargs):
        # Set the assigned_object_id from the cleaned data
        self.instance.assigned_object_type = self.cleaned_data.get('assigned_object_type')
        self.instance.assigned_object_id = self.cleaned_data.get('assigned_object_id')
        return super().save(*args, **kwargs)


class FloorPlanTileFilterForm(NetBoxModelFilterSetForm):
    model = FloorPlanTile
    floorplan_id = DynamicModelChoiceField(
        queryset=FloorPlan.objects.all(),
        required=False,
        label=_('Floor Plan')
    )
    assigned_object_type = ContentTypeChoiceField(
        queryset=get_assignable_content_types(),
        required=False,
        label=_('Object Type')
    )
    tile_type = forms.MultipleChoiceField(
        choices=FloorPlanTileTypeChoices,
        required=False,
        label=_('Tile Type')
    )
    status = forms.MultipleChoiceField(
        choices=FloorPlanTileStatusChoices,
        required=False,
        label=_('Status')
    )

    fieldsets = (
        FieldSet('floorplan_id', 'assigned_object_type', 'tile_type', 'status'),
    )


#
# MapMarker forms
#

class MapMarkerForm(NetBoxModelForm):
    site = DynamicModelChoiceField(
        label=_('Site'),
        queryset=Site.objects.all(),
        required=False,
    )
    assigned_object_type = ContentTypeChoiceField(
        label=_('Object Type'),
        queryset=get_assignable_content_types(),
        required=False,
        help_text=_('Select the type of object to assign')
    )
    rack = DynamicModelChoiceField(
        label=_('Rack'),
        queryset=Rack.objects.all(),
        required=False,
        query_params={'site_id': '$site'},
    )
    device = DynamicModelChoiceField(
        label=_('Device'),
        queryset=Device.objects.all(),
        required=False,
        query_params={'site_id': '$site'},
    )
    powerpanel = DynamicModelChoiceField(
        label=_('Power Panel'),
        queryset=PowerPanel.objects.all(),
        required=False,
        query_params={'site_id': '$site'},
    )
    powerfeed = DynamicModelChoiceField(
        label=_('Power Feed'),
        queryset=PowerFeed.objects.all(),
        required=False,
    )

    fieldsets = (
        FieldSet(
            'latitude', 'longitude', 'label', 'marker_type', 'status', 'site', 'description', 'tags',
            name=_('Map Marker')
        ),
        FieldSet(
            'fov_direction', 'fov_angle', 'fov_distance',
            name=_('Camera FOV Settings')
        ),
        FieldSet(
            'assigned_object_type', 'rack', 'device', 'powerpanel', 'powerfeed',
            name=_('Assigned Object')
        ),
    )

    class Meta:
        model = MapMarker
        fields = [
            'latitude', 'longitude', 'label', 'marker_type', 'status', 'site',
            'fov_direction', 'fov_angle', 'fov_distance',
            'assigned_object_type', 'description', 'tags',
        ]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        if self.instance.pk and self.instance.assigned_object_type:
            model_name = self.instance.assigned_object_type.model
            if model_name in ('rack', 'device', 'powerpanel', 'powerfeed'):
                field = self.fields.get(model_name)
                if field and self.instance.assigned_object_id:
                    field.initial = self.instance.assigned_object_id

    def clean(self):
        super().clean()
        assigned_object_type = self.cleaned_data.get('assigned_object_type')
        if assigned_object_type:
            model_name = assigned_object_type.model
            obj = self.cleaned_data.get(model_name)
            if obj:
                self.instance.assigned_object_id = obj.pk
            else:
                self.instance.assigned_object_id = None
                self.cleaned_data['assigned_object_type'] = None
        else:
            self.cleaned_data['assigned_object_type'] = None
            self.instance.assigned_object_id = None
        return self.cleaned_data

    def save(self, *args, **kwargs):
        self.instance.assigned_object_type = self.cleaned_data.get('assigned_object_type')
        return super().save(*args, **kwargs)


class MapMarkerFilterForm(NetBoxModelFilterSetForm):
    model = MapMarker
    site_id = DynamicModelChoiceField(
        queryset=Site.objects.all(),
        required=False,
        label=_('Site')
    )
    marker_type = forms.MultipleChoiceField(
        choices=FloorPlanTileTypeChoices,
        required=False,
        label=_('Marker Type')
    )
    status = forms.MultipleChoiceField(
        choices=FloorPlanTileStatusChoices,
        required=False,
        label=_('Status')
    )

    fieldsets = (
        FieldSet('site_id', 'marker_type', 'status'),
    )
