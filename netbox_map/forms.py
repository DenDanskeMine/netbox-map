from django import forms
from django.contrib.contenttypes.models import ContentType
from django.utils.translation import gettext_lazy as _

from dcim.models import Site, Location, Rack, Device, DeviceRole, PowerPanel, PowerFeed, RearPort, FrontPort, Region, SiteGroup
from tenancy.models import Tenant
from netbox.forms import NetBoxModelForm, NetBoxModelFilterSetForm, NetBoxModelBulkEditForm, NetBoxModelImportForm
from utilities.forms.fields import (
    ContentTypeChoiceField,
    CSVChoiceField,
    CSVModelChoiceField,
    DynamicModelChoiceField,
    DynamicModelMultipleChoiceField,
    CommentField,
)
from utilities.forms.rendering import FieldSet
from .models import (
    FloorPlan, FloorPlanTile, CustomMarkerType, MapMarker, MapSettings, CablePath, TopologySavedView, ASSIGNABLE_MODELS,
    ApplicationGroup, Application, ApplicationDeployment, ApplicationDependency,
)
from dcim.choices import CableTypeChoices, SiteStatusChoices
from .choices import (
    FloorPlanTileTypeChoices, FloorPlanTileStatusChoices,
    CablePathStatusChoices,
    ApplicationStatusChoices, ApplicationCriticalityChoices,
    ApplicationEnvironmentChoices, DependencyTypeChoices,
    DependencyProtocolChoices, DeploymentRoleChoices,
    get_all_tile_type_choices, get_all_type_configs,
)


def get_assignable_content_types():
    """Return a queryset of ContentTypes for assignable models."""
    return ContentType.objects.filter(
        app_label='dcim',
        model__in=['device', 'rack', 'powerpanel', 'powerfeed', 'rearport', 'frontport'],
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


class FloorPlanImportForm(NetBoxModelImportForm):
    site = CSVModelChoiceField(
        queryset=Site.objects.all(),
        to_field_name='name',
        help_text=_('Site name'),
    )
    location = CSVModelChoiceField(
        queryset=Location.objects.all(),
        to_field_name='name',
        required=False,
        help_text=_('Location name'),
    )

    class Meta:
        model = FloorPlan
        fields = (
            'name', 'site', 'location', 'grid_width', 'grid_height',
            'tile_size', 'description',
        )

    # Headers to silently drop (computed / non-importable columns)
    _SKIP_HEADERS = {'tiles', 'id', ''}

    def __init__(self, data=None, *args, headers=None, **kwargs):
        if headers:
            headers = self._normalize_headers(headers)
        if data and isinstance(data, dict):
            data = self._normalize_row(data)
        super().__init__(data=data, *args, headers=headers, **kwargs)

    @classmethod
    def _normalize_headers(cls, headers):
        """Remap export-format CSV headers to import field names."""
        new_headers = {}
        for header, to_field in headers.items():
            k = header.strip().lower().replace(' ', '_')
            if k in cls._SKIP_HEADERS:
                continue
            if k == 'grid_size':
                # Split into two fields
                new_headers['grid_width'] = None
                new_headers['grid_height'] = None
                continue
            new_headers[k] = to_field
        return new_headers

    @staticmethod
    def _normalize_row(row):
        """Accept both export-format and import-format CSV values."""
        import re
        normalized = {}
        for key, value in row.items():
            k = key.strip().lower().replace(' ', '_')
            v = str(value).strip() if value is not None else ''

            if k == 'grid_size':
                m = re.match(r'(\d+)\s*x\s*(\d+)', v)
                if m:
                    normalized['grid_width'] = m.group(1)
                    normalized['grid_height'] = m.group(2)
            elif k in ('tiles', 'id', ''):
                continue
            else:
                normalized[k] = v

        # Default tile_size when importing from old export (which lacks it)
        if 'tile_size' not in normalized:
            normalized['tile_size'] = '60'

        return normalized


#
# CustomMarkerType forms
#

class CustomMarkerTypeForm(NetBoxModelForm):
    fieldsets = (
        FieldSet(
            'name', 'slug', 'color', 'icon', 'description', 'tags',
            name=_('Custom Marker Type')
        ),
    )

    class Meta:
        model = CustomMarkerType
        fields = ['name', 'slug', 'color', 'icon', 'description', 'tags']
        widgets = {
            'color': forms.TextInput(attrs={'type': 'color'}),
        }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        if not self.instance.pk:
            self.fields['slug'].required = False
            self.fields['slug'].help_text = _('Leave blank to auto-generate from name. Will be prefixed with "custom_".')


class CustomMarkerTypeBulkEditForm(NetBoxModelBulkEditForm):
    color = forms.CharField(max_length=7, required=False)
    icon = forms.CharField(max_length=100, required=False)
    description = forms.CharField(max_length=200, required=False)

    model = CustomMarkerType
    nullable_fields = ('description',)


class CustomMarkerTypeImportForm(NetBoxModelImportForm):
    class Meta:
        model = CustomMarkerType
        fields = ('name', 'slug', 'color', 'icon', 'description')

    _SKIP_HEADERS = {'id', 'pk', ''}

    def __init__(self, data=None, *args, headers=None, **kwargs):
        if headers:
            headers = self._normalize_headers(headers)
        if data and isinstance(data, dict):
            data = self._normalize_row(data)
        super().__init__(data=data, *args, headers=headers, **kwargs)

    @classmethod
    def _normalize_headers(cls, headers):
        new_headers = {}
        for header, to_field in headers.items():
            k = header.strip().lower().replace(' ', '_')
            if k in cls._SKIP_HEADERS:
                continue
            new_headers[k] = to_field
        return new_headers

    @staticmethod
    def _normalize_row(row):
        normalized = {}
        for key, value in row.items():
            k = key.strip().lower().replace(' ', '_')
            if k in ('id', 'pk', ''):
                continue
            normalized[k] = str(value).strip() if value is not None else ''
        return normalized


class CustomMarkerTypeFilterForm(NetBoxModelFilterSetForm):
    model = CustomMarkerType

    fieldsets = (
        FieldSet('q'),
    )


#
# FloorPlanTile forms
#

class FloorPlanTileForm(NetBoxModelForm):
    floorplan = DynamicModelChoiceField(
        label=_('Floor Plan'),
        queryset=FloorPlan.objects.all()
    )
    # Hidden field — auto-populated via JS when floorplan is selected.
    # Used as the site_id source for dependent rack/device/powerpanel dropdowns.
    site = forms.IntegerField(
        required=False,
        widget=forms.HiddenInput(),
    )
    # Resolved in clean() from the per-type selector (rack/device/etc.).
    # Must be declared so Django's _post_clean() can find it in self.fields.
    assigned_object_id = forms.IntegerField(
        required=False,
        widget=forms.HiddenInput(),
    )
    linked_floorplan = DynamicModelChoiceField(
        label=_('Linked Floor Plan'),
        queryset=FloorPlan.objects.all(),
        required=False,
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
            'site_id': '$site',
        }
    )
    device = DynamicModelChoiceField(
        label=_('Device'),
        queryset=Device.objects.all(),
        required=False,
        query_params={
            'site_id': '$site',
        }
    )
    powerpanel = DynamicModelChoiceField(
        label=_('Power Panel'),
        queryset=PowerPanel.objects.all(),
        required=False,
        query_params={
            'site_id': '$site',
        }
    )
    powerfeed = DynamicModelChoiceField(
        label=_('Power Feed'),
        queryset=PowerFeed.objects.all(),
        required=False,
    )
    rearport = DynamicModelChoiceField(
        label=_('Rear Port'),
        queryset=RearPort.objects.all(),
        required=False,
    )
    frontport = DynamicModelChoiceField(
        label=_('Front Port'),
        queryset=FrontPort.objects.all(),
        required=False,
    )

    fieldsets = (
        FieldSet(
            'floorplan', 'x_position', 'y_position', 'width', 'height',
            'orientation', 'tags',
            name=_('Position')
        ),
        FieldSet(
            'tile_type', 'status', 'label', 'linked_floorplan',
            name=_('Tile')
        ),
        FieldSet(
            'fov_direction', 'fov_angle', 'fov_distance',
            name=_('Camera FOV Settings')
        ),
        FieldSet(
            'assigned_object_type', 'rack', 'device', 'powerpanel', 'powerfeed',
            'rearport', 'frontport',
            name=_('Assigned Object')
        ),
    )

    class Meta:
        model = FloorPlanTile
        fields = [
            'floorplan', 'x_position', 'y_position', 'width', 'height',
            'label', 'tile_type', 'status', 'orientation',
            'linked_floorplan',
            'fov_direction', 'fov_angle', 'fov_distance',
            'assigned_object_type', 'assigned_object_id', 'tags',
        ]

    class Media:
        js = ('netbox_map/js/floorplan_tile_form.js',)

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)

        # Dynamic tile_type choices (built-in + custom)
        self.fields['tile_type'].choices = get_all_tile_type_choices()

        # Pre-populate the hidden site field and object selector when editing
        if self.instance.pk:
            if hasattr(self.instance, 'floorplan') and self.instance.floorplan_id:
                try:
                    self.fields['site'].initial = self.instance.floorplan.site_id
                except Exception:
                    pass

            if self.instance.assigned_object_type:
                model_name = self.instance.assigned_object_type.model
                if model_name in ('rack', 'device', 'powerpanel', 'powerfeed', 'rearport', 'frontport'):
                    field = self.fields.get(model_name)
                    if field and self.instance.assigned_object_id:
                        field.initial = self.instance.assigned_object_id

    def clean(self):
        super().clean()

        tile_type = self.cleaned_data.get('tile_type')

        # Drop tiles use port_assignments, not the single generic FK
        if tile_type == 'drop':
            self.cleaned_data['assigned_object_type'] = None
            self.cleaned_data['assigned_object_id'] = None
            return self.cleaned_data

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
        choices=[],
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

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields['tile_type'].choices = get_all_tile_type_choices()


class FloorPlanTileBulkEditForm(NetBoxModelBulkEditForm):
    tile_type = forms.ChoiceField(choices=[], required=False, label=_('Tile Type'))
    status = forms.ChoiceField(choices=FloorPlanTileStatusChoices, required=False, label=_('Status'))

    model = FloorPlanTile
    nullable_fields = ()

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields['tile_type'].choices = [('', '---------')] + list(get_all_tile_type_choices())


class FloorPlanTileImportForm(NetBoxModelImportForm):
    floorplan = CSVModelChoiceField(
        queryset=FloorPlan.objects.all(),
        to_field_name='name',
        help_text=_('Floor plan name'),
    )
    tile_type = CSVChoiceField(
        choices=[],
        help_text=_('Tile type (key or display name, e.g. "ap" or "Access Point")'),
    )
    status = CSVChoiceField(
        choices=FloorPlanTileStatusChoices,
        help_text=_('Status (key or display name, e.g. "active" or "Active")'),
    )
    linked_floorplan = CSVModelChoiceField(
        queryset=FloorPlan.objects.all(),
        to_field_name='name',
        required=False,
        help_text=_('Linked floor plan name (for floorplan_link tiles)'),
    )

    fov_direction = forms.IntegerField(required=False)
    fov_angle = forms.IntegerField(required=False)
    fov_distance = forms.IntegerField(required=False)

    # Accept assigned_object_type as "app_label.model" string (e.g. "dcim.rack").
    # Resolved to a ContentType in clean() and set directly on the instance.
    assigned_object_type = forms.CharField(
        required=False,
        help_text=_('Object type in app_label.model format (e.g. dcim.rack)'),
    )
    assigned_object_id = forms.IntegerField(
        required=False,
        help_text=_('Primary key of the assigned object'),
    )

    class Meta:
        model = FloorPlanTile
        fields = (
            'floorplan', 'x_position', 'y_position', 'width', 'height',
            'label', 'tile_type', 'status', 'orientation',
            'linked_floorplan',
            'fov_direction', 'fov_angle', 'fov_distance',
        )

    # Build reverse maps: display name → key (e.g. "Access Point" → "ap")
    _TILE_TYPE_MAP = {str(v).lower(): k for k, v, *_ in FloorPlanTileTypeChoices.CHOICES}
    _STATUS_MAP = {str(v).lower(): k for k, v, *_ in FloorPlanTileStatusChoices.CHOICES}
    _SKIP_HEADERS = {'id', 'object_type', 'assigned_object'}

    def __init__(self, data=None, *args, headers=None, **kwargs):
        if headers:
            headers = self._normalize_headers(headers)
        if data and isinstance(data, dict):
            data = self._normalize_row(data)
        super().__init__(data=data, *args, headers=headers, **kwargs)
        self.fields['tile_type'].choices = get_all_tile_type_choices()

    @classmethod
    def _normalize_headers(cls, headers):
        """Remap export-format CSV headers to import field names."""
        new_headers = {}
        for header, to_field in headers.items():
            k = header.strip().lower().replace(' ', '_')
            if k in cls._SKIP_HEADERS:
                continue
            if k == 'floor_plan':
                new_headers['floorplan'] = to_field
                continue
            if k == 'position':
                new_headers['x_position'] = None
                new_headers['y_position'] = None
                continue
            new_headers[k] = to_field
        return new_headers

    @classmethod
    def _normalize_row(cls, row):
        """Accept both export-format and import-format CSV values."""
        import re
        normalized = {}
        for key, value in row.items():
            k = key.strip().lower().replace(' ', '_')
            v = str(value).strip() if value is not None else ''

            if k == 'floor_plan':
                # Export gives "1. Floor (Test)" — strip the "(Site)" suffix
                normalized['floorplan'] = re.sub(r'\s*\([^)]+\)\s*$', '', v)
            elif k == 'floorplan':
                normalized['floorplan'] = v
            elif k == 'position':
                # Export gives "(31, 18)" — split into x_position / y_position
                m = re.match(r'\((\d+),\s*(\d+)\)', v)
                if m:
                    normalized['x_position'] = m.group(1)
                    normalized['y_position'] = m.group(2)
            elif k == 'tile_type':
                # Accept display name ("Access Point") or key ("ap")
                normalized['tile_type'] = cls._TILE_TYPE_MAP.get(v.lower(), v) if v else v
            elif k == 'status':
                normalized['status'] = cls._STATUS_MAP.get(v.lower(), v) if v else v
            elif k in cls._SKIP_HEADERS:
                continue
            else:
                normalized[k] = v

        return normalized

    def clean(self):
        super().clean()

        type_str = self.cleaned_data.pop('assigned_object_type', None)
        obj_id = self.cleaned_data.pop('assigned_object_id', None)

        if type_str and obj_id:
            try:
                app_label, model = type_str.strip().split('.')
            except ValueError:
                self.add_error('assigned_object_type', _(
                    'Invalid format. Use app_label.model (e.g. dcim.rack).'
                ))
                return self.cleaned_data

            try:
                ct = ContentType.objects.get(app_label=app_label, model=model)
            except ContentType.DoesNotExist:
                self.add_error('assigned_object_type', _(
                    f'Unknown content type: {type_str}'
                ))
                return self.cleaned_data

            model_class = ct.model_class()
            if not model_class.objects.filter(pk=obj_id).exists():
                self.add_error('assigned_object_id', _(
                    f'No {type_str} object found with id {obj_id}.'
                ))
                return self.cleaned_data

            self.instance.assigned_object_type = ct
            self.instance.assigned_object_id = obj_id

        return self.cleaned_data


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
    rearport = DynamicModelChoiceField(
        label=_('Rear Port'),
        queryset=RearPort.objects.all(),
        required=False,
    )
    frontport = DynamicModelChoiceField(
        label=_('Front Port'),
        queryset=FrontPort.objects.all(),
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
            'rearport', 'frontport',
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
        # Dynamic marker_type choices (built-in + custom)
        self.fields['marker_type'].choices = get_all_tile_type_choices()

        if self.instance.pk and self.instance.assigned_object_type:
            model_name = self.instance.assigned_object_type.model
            if model_name in ('rack', 'device', 'powerpanel', 'powerfeed', 'rearport', 'frontport'):
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


class MapMarkerBulkEditForm(NetBoxModelBulkEditForm):
    marker_type = forms.ChoiceField(choices=[], required=False, label=_('Marker Type'))
    status = forms.ChoiceField(choices=FloorPlanTileStatusChoices, required=False, label=_('Status'))
    description = forms.CharField(max_length=200, required=False, label=_('Description'))

    model = MapMarker
    nullable_fields = ('description',)

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields['marker_type'].choices = [('', '---------')] + list(get_all_tile_type_choices())


class MapMarkerImportForm(NetBoxModelImportForm):
    site = CSVModelChoiceField(
        queryset=Site.objects.all(),
        to_field_name='name',
        required=False,
        help_text=_('Site name'),
    )
    marker_type = CSVChoiceField(
        choices=[],
        help_text=_('Marker type (key or display name, e.g. "camera" or "Camera")'),
    )
    status = CSVChoiceField(
        choices=FloorPlanTileStatusChoices,
        help_text=_('Status (key or display name, e.g. "active" or "Active")'),
    )

    fov_direction = forms.IntegerField(required=False)
    fov_angle = forms.IntegerField(required=False)
    fov_distance = forms.IntegerField(required=False)

    class Meta:
        model = MapMarker
        fields = (
            'latitude', 'longitude', 'label', 'marker_type', 'status', 'site',
            'fov_direction', 'fov_angle', 'fov_distance', 'description',
        )

    _TILE_TYPE_MAP = {str(v).lower(): k for k, v, *_ in FloorPlanTileTypeChoices.CHOICES}
    _STATUS_MAP = {str(v).lower(): k for k, v, *_ in FloorPlanTileStatusChoices.CHOICES}
    _SKIP_HEADERS = {'id'}

    def __init__(self, data=None, *args, headers=None, **kwargs):
        if headers:
            headers = self._normalize_headers(headers)
        if data and isinstance(data, dict):
            data = self._normalize_row(data)
        super().__init__(data=data, *args, headers=headers, **kwargs)
        self.fields['marker_type'].choices = get_all_tile_type_choices()

    @classmethod
    def _normalize_headers(cls, headers):
        """Remap export-format CSV headers to import field names."""
        new_headers = {}
        for header, to_field in headers.items():
            k = header.strip().lower().replace(' ', '_')
            if k in cls._SKIP_HEADERS:
                continue
            if k == 'type':
                new_headers['marker_type'] = to_field
                continue
            new_headers[k] = to_field
        return new_headers

    @classmethod
    def _normalize_row(cls, row):
        """Accept both export-format and import-format CSV values."""
        normalized = {}
        for key, value in row.items():
            k = key.strip().lower().replace(' ', '_')
            v = str(value).strip() if value is not None else ''

            if k == 'type':
                normalized['marker_type'] = cls._TILE_TYPE_MAP.get(v.lower(), v) if v else v
            elif k == 'marker_type':
                normalized['marker_type'] = cls._TILE_TYPE_MAP.get(v.lower(), v) if v else v
            elif k == 'status':
                normalized['status'] = cls._STATUS_MAP.get(v.lower(), v) if v else v
            elif k in cls._SKIP_HEADERS:
                continue
            else:
                normalized[k] = v

        return normalized


#
# CablePath forms
#

class CablePathForm(NetBoxModelForm):
    start_marker = DynamicModelChoiceField(
        label=_('Start Marker'),
        queryset=MapMarker.objects.all(),
        required=False,
    )
    end_marker = DynamicModelChoiceField(
        label=_('End Marker'),
        queryset=MapMarker.objects.all(),
        required=False,
    )

    fieldsets = (
        FieldSet(
            'label', 'status', 'cable_type', 'fiber_count', 'tags',
            name=_('Cable Path')
        ),
        FieldSet(
            'color', 'weight',
            name=_('Appearance')
        ),
        FieldSet(
            'start_marker', 'end_marker',
            name=_('Connections')
        ),
    )

    class Meta:
        model = CablePath
        fields = [
            'label', 'status', 'cable_type', 'fiber_count',
            'color', 'weight',
            'start_marker', 'end_marker',
            'path_coordinates', 'tags',
        ]
        widgets = {
            'path_coordinates': forms.HiddenInput(),
            'color': forms.TextInput(attrs={'type': 'color'}),
        }


class CablePathFilterForm(NetBoxModelFilterSetForm):
    model = CablePath
    status = forms.MultipleChoiceField(
        choices=CablePathStatusChoices,
        required=False,
        label=_('Status')
    )
    cable_type = forms.MultipleChoiceField(
        choices=CableTypeChoices,
        required=False,
        label=_('Cable Type')
    )

    fieldsets = (
        FieldSet('status', 'cable_type'),
    )


class CablePathBulkEditForm(NetBoxModelBulkEditForm):
    status = forms.ChoiceField(
        choices=CablePathStatusChoices,
        required=False,
        label=_('Status'),
    )
    cable_type = forms.ChoiceField(
        choices=CableTypeChoices,
        required=False,
        label=_('Cable Type'),
    )
    fiber_count = forms.IntegerField(required=False, label=_('Fiber Count'))

    model = CablePath
    nullable_fields = ('label',)

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields['status'].choices = [('', '---------')] + list(CablePathStatusChoices)
        self.fields['cable_type'].choices = [('', '---------')] + list(CableTypeChoices)


class CablePathImportForm(NetBoxModelImportForm):
    status = CSVChoiceField(
        choices=CablePathStatusChoices,
        help_text=_('Status'),
    )
    cable_type = CSVChoiceField(
        choices=CableTypeChoices,
        required=False,
        help_text=_('Cable type (e.g. cat6a, smf-os2)'),
    )
    start_marker = CSVModelChoiceField(
        queryset=MapMarker.objects.all(),
        to_field_name='pk',
        required=False,
        help_text=_('Start marker ID'),
    )
    end_marker = CSVModelChoiceField(
        queryset=MapMarker.objects.all(),
        to_field_name='pk',
        required=False,
        help_text=_('End marker ID'),
    )

    class Meta:
        model = CablePath
        fields = (
            'label', 'status', 'cable_type', 'fiber_count', 'start_marker', 'end_marker',
        )


#
# MapSettings form
#

DEVICE_FIELD_CHOICES = [
    ('status', _('Status')),
    ('role', _('Role')),
    ('device_type', _('Device Type')),
    ('platform', _('Platform')),
    ('serial', _('Serial')),
    ('asset_tag', _('Asset Tag')),
    ('tenant', _('Tenant')),
    ('site', _('Site')),
    ('location', _('Location')),
    ('rack', _('Rack')),
    ('position', _('Position')),
    ('face', _('Face')),
    ('airflow', _('Airflow')),
    ('primary_ip4', _('Primary IPv4')),
    ('primary_ip6', _('Primary IPv6')),
    ('oob_ip', _('OOB IP')),
    ('cluster', _('Cluster')),
    ('virtual_chassis', _('Virtual Chassis')),
    ('vc_position', _('VC Position')),
    ('description', _('Description')),
]

RACK_FIELD_CHOICES = [
    ('status', _('Status')),
    ('role', _('Role')),
    ('facility_id', _('Facility ID')),
    ('serial', _('Serial')),
    ('asset_tag', _('Asset Tag')),
    ('u_height', _('U Height')),
    ('width', _('Width')),
    ('type', _('Type')),
    ('weight', _('Weight')),
    ('max_weight', _('Max Weight')),
    ('tenant', _('Tenant')),
    ('site', _('Site')),
    ('location', _('Location')),
    ('description', _('Description')),
]

POWERPANEL_FIELD_CHOICES = [
    ('site', _('Site')),
    ('location', _('Location')),
    ('description', _('Description')),
]

POWERFEED_FIELD_CHOICES = [
    ('status', _('Status')),
    ('type', _('Type')),
    ('supply', _('Supply')),
    ('voltage', _('Voltage')),
    ('amperage', _('Amperage')),
    ('max_utilization', _('Max Utilization')),
    ('power_panel', _('Power Panel')),
    ('rack', _('Rack')),
    ('description', _('Description')),
]

POPOVER_FIELD_CHOICES = [
    ('label', _('Label')),
    ('object_info', _('Object Type & Name')),
    ('primary_ip', _('IP Address')),
    ('mac', _('MAC Address')),
    ('utilization', _('Utilization')),
    ('position', _('Position')),
    ('size', _('Size')),
    ('status', _('Status')),
    ('type', _('Tile Type')),
    ('orientation', _('Orientation')),
    ('cable_trace', _('Cable Trace (Simple)')),
    ('cable_trace_full', _('Cable Trace (Full)')),
]

def _get_tile_type_info():
    """Return [(slug, label), ...] for all types (built-in + custom)."""
    return [(tc['slug'], tc['name']) for tc in get_all_type_configs()]


class MapSettingsForm(forms.ModelForm):
    """Form for editing map detail panel settings."""

    device_fields = forms.MultipleChoiceField(
        choices=DEVICE_FIELD_CHOICES,
        widget=forms.CheckboxSelectMultiple,
        required=False,
        label=_('Device Fields'),
    )
    rack_fields = forms.MultipleChoiceField(
        choices=RACK_FIELD_CHOICES,
        widget=forms.CheckboxSelectMultiple,
        required=False,
        label=_('Rack Fields'),
    )
    powerpanel_fields = forms.MultipleChoiceField(
        choices=POWERPANEL_FIELD_CHOICES,
        widget=forms.CheckboxSelectMultiple,
        required=False,
        label=_('Power Panel Fields'),
    )
    powerfeed_fields = forms.MultipleChoiceField(
        choices=POWERFEED_FIELD_CHOICES,
        widget=forms.CheckboxSelectMultiple,
        required=False,
        label=_('Power Feed Fields'),
    )
    popover_fields = forms.MultipleChoiceField(
        choices=POPOVER_FIELD_CHOICES,
        widget=forms.CheckboxSelectMultiple,
        required=False,
        label=_('Popover Fields'),
    )

    class Meta:
        model = MapSettings
        fields = (
            'show_mac', 'show_custom_fields', 'sync_device_gps',
            'device_fields', 'rack_fields', 'powerpanel_fields', 'powerfeed_fields',
            'popover_fields',
        )

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)

        # Dynamically discover NetBox custom fields for assignable object types.
        all_cf_choices = []
        try:
            from extras.models import CustomField
            from django.contrib.contenttypes.models import ContentType

            ct_ids = list(ContentType.objects.filter(
                app_label='dcim',
                model__in=['device', 'rack', 'powerpanel', 'powerfeed', 'rearport', 'frontport'],
            ).values_list('id', flat=True))
            cf_choices = list(
                CustomField.objects.filter(object_types__in=ct_ids)
                .exclude(ui_visible='hidden')
                .distinct()
                .order_by('name')
                .values_list('name', 'label')
            )
            all_cf_choices = [
                (f'cf_{name}', f'CF: {label or name}')
                for name, label in cf_choices
            ]
        except Exception:
            pass

        extended_choices = list(POPOVER_FIELD_CHOICES) + all_cf_choices
        if all_cf_choices:
            self.fields['popover_fields'].choices = extended_choices

        # Add per-tile-type popover fields from tile_popover_config
        config = {}
        if self.instance and self.instance.pk:
            config = self.instance.tile_popover_config or {}

        self._tile_type_info = _get_tile_type_info()
        for type_key, type_label in self._tile_type_info:
            field_name = f'{type_key}_popover_fields'
            self.fields[field_name] = forms.MultipleChoiceField(
                choices=extended_choices,
                widget=forms.CheckboxSelectMultiple,
                required=False,
                label=_('%s Popover Fields') % type_label,
            )
            if type_key in config:
                self.initial[field_name] = config[type_key]

    def save(self, commit=True):
        instance = super().save(commit=False)

        # Reconstruct tile_popover_config dict from per-type form fields
        config = {}
        for type_key, _ in self._tile_type_info:
            field_name = f'{type_key}_popover_fields'
            config[type_key] = self.cleaned_data.get(field_name, [])
        instance.tile_popover_config = config

        if commit:
            instance.save()
        return instance


class MapMarkerFilterForm(NetBoxModelFilterSetForm):
    model = MapMarker
    site_id = DynamicModelChoiceField(
        queryset=Site.objects.all(),
        required=False,
        label=_('Site')
    )
    marker_type = forms.MultipleChoiceField(
        choices=[],
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

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields['marker_type'].choices = get_all_tile_type_choices()


#
# Site Map filter form (#26)
#

class SiteMapFilterForm(forms.Form):
    status = forms.MultipleChoiceField(
        choices=SiteStatusChoices,
        required=False,
        label=_('Status'),
        widget=forms.CheckboxSelectMultiple(),
    )
    region_id = DynamicModelMultipleChoiceField(
        queryset=Region.objects.all(),
        required=False,
        label=_('Region'),
    )
    group_id = DynamicModelMultipleChoiceField(
        queryset=SiteGroup.objects.all(),
        required=False,
        label=_('Site Group'),
    )
    tenant_id = DynamicModelMultipleChoiceField(
        queryset=Tenant.objects.all(),
        required=False,
        label=_('Tenant'),
    )
    device_role_id = DynamicModelMultipleChoiceField(
        queryset=DeviceRole.objects.all(),
        required=False,
        label=_('Device Role'),
        help_text=_('Only show sites that have devices with these roles'),
    )


#
# Topology filter form
#

class TopologyFilterForm(forms.Form):
    site_id = DynamicModelChoiceField(
        queryset=Site.objects.all(),
        required=False,
        label=_('Site'),
    )
    tenant_id = DynamicModelChoiceField(
        queryset=Tenant.objects.all(),
        required=False,
        label=_('Tenant'),
    )
    location_id = DynamicModelChoiceField(
        queryset=Location.objects.all(),
        required=False,
        label=_('Location'),
        query_params={'site_id': '$site_id'},
    )
    rack_id = DynamicModelChoiceField(
        queryset=Rack.objects.all(),
        required=False,
        label=_('Rack'),
        query_params={'site_id': '$site_id', 'location_id': '$location_id'},
    )
    role_id = DynamicModelMultipleChoiceField(
        queryset=DeviceRole.objects.all(),
        required=False,
        label=_('Device Role'),
    )
    cable_type = forms.ChoiceField(
        choices=[('', '---------')] + list(CableTypeChoices),
        required=False,
        label=_('Cable Type'),
    )


#
# Topology saved view forms
#

class TopologySavedViewForm(NetBoxModelForm):
    site = DynamicModelChoiceField(
        queryset=Site.objects.all(),
        required=False,
        label=_('Site'),
    )

    fieldsets = (
        FieldSet('name', 'description', 'site', name=_('Saved View')),
        FieldSet('tags', name=_('Tags')),
    )

    class Meta:
        model = TopologySavedView
        fields = ['name', 'description', 'site', 'tags']


class TopologySavedViewFilterForm(NetBoxModelFilterSetForm):
    model = TopologySavedView
    site_id = DynamicModelChoiceField(
        queryset=Site.objects.all(),
        required=False,
        label=_('Site'),
    )
    fieldsets = (
        FieldSet('site_id'),
    )


#
# ApplicationGroup forms
#

class ApplicationGroupForm(NetBoxModelForm):
    fieldsets = (
        FieldSet(
            'name', 'slug', 'color', 'description', 'tags',
            name=_('Application Group')
        ),
    )

    class Meta:
        model = ApplicationGroup
        fields = ['name', 'slug', 'color', 'description', 'tags']
        widgets = {
            'color': forms.TextInput(attrs={'type': 'color'}),
        }


class ApplicationGroupFilterForm(NetBoxModelFilterSetForm):
    model = ApplicationGroup

    fieldsets = (
        FieldSet('q'),
    )


#
# Application forms
#

class ApplicationForm(NetBoxModelForm):
    site = DynamicModelChoiceField(
        label=_('Site'),
        queryset=Site.objects.all(),
        required=False,
    )
    tenant = DynamicModelChoiceField(
        label=_('Tenant'),
        queryset=Tenant.objects.all(),
        required=False,
    )
    group = DynamicModelChoiceField(
        label=_('Group'),
        queryset=ApplicationGroup.objects.all(),
        required=False,
    )
    comments = CommentField()

    fieldsets = (
        FieldSet(
            'name', 'status', 'criticality', 'environment', 'version', 'description', 'tags',
            name=_('Application')
        ),
        FieldSet(
            'group', 'site', 'tenant',
            name=_('Assignment')
        ),
        FieldSet(
            'external_url',
            name=_('Links')
        ),
    )

    class Meta:
        model = Application
        fields = [
            'name', 'status', 'criticality', 'environment', 'version',
            'description', 'comments', 'external_url',
            'group', 'site', 'tenant', 'tags',
        ]


class ApplicationFilterForm(NetBoxModelFilterSetForm):
    model = Application
    status = forms.MultipleChoiceField(
        choices=ApplicationStatusChoices,
        required=False,
        label=_('Status')
    )
    criticality = forms.MultipleChoiceField(
        choices=ApplicationCriticalityChoices,
        required=False,
        label=_('Criticality')
    )
    environment = forms.MultipleChoiceField(
        choices=ApplicationEnvironmentChoices,
        required=False,
        label=_('Environment')
    )
    site_id = DynamicModelChoiceField(
        queryset=Site.objects.all(),
        required=False,
        label=_('Site')
    )
    tenant_id = DynamicModelChoiceField(
        queryset=Tenant.objects.all(),
        required=False,
        label=_('Tenant')
    )
    group_id = DynamicModelChoiceField(
        queryset=ApplicationGroup.objects.all(),
        required=False,
        label=_('Group')
    )

    fieldsets = (
        FieldSet('status', 'criticality', 'environment', 'site_id', 'tenant_id', 'group_id'),
    )


class ApplicationBulkEditForm(NetBoxModelBulkEditForm):
    status = forms.ChoiceField(
        choices=ApplicationStatusChoices,
        required=False,
        label=_('Status'),
    )
    criticality = forms.ChoiceField(
        choices=ApplicationCriticalityChoices,
        required=False,
        label=_('Criticality'),
    )
    environment = forms.ChoiceField(
        choices=ApplicationEnvironmentChoices,
        required=False,
        label=_('Environment'),
    )
    group = DynamicModelChoiceField(
        queryset=ApplicationGroup.objects.all(),
        required=False,
        label=_('Group'),
    )
    site = DynamicModelChoiceField(
        queryset=Site.objects.all(),
        required=False,
        label=_('Site'),
    )
    tenant = DynamicModelChoiceField(
        queryset=Tenant.objects.all(),
        required=False,
        label=_('Tenant'),
    )
    description = forms.CharField(max_length=500, required=False)

    model = Application
    nullable_fields = ('group', 'site', 'tenant', 'description', 'version', 'external_url')

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields['status'].choices = [('', '---------')] + list(ApplicationStatusChoices)
        self.fields['criticality'].choices = [('', '---------')] + list(ApplicationCriticalityChoices)
        self.fields['environment'].choices = [('', '---------')] + list(ApplicationEnvironmentChoices)


class ApplicationImportForm(NetBoxModelImportForm):
    status = CSVChoiceField(
        choices=ApplicationStatusChoices,
        help_text=_('Status'),
    )
    criticality = CSVChoiceField(
        choices=ApplicationCriticalityChoices,
        help_text=_('Criticality'),
    )
    environment = CSVChoiceField(
        choices=ApplicationEnvironmentChoices,
        help_text=_('Environment'),
    )
    site = CSVModelChoiceField(
        queryset=Site.objects.all(),
        to_field_name='name',
        required=False,
        help_text=_('Site name'),
    )
    tenant = CSVModelChoiceField(
        queryset=Tenant.objects.all(),
        to_field_name='name',
        required=False,
        help_text=_('Tenant name'),
    )
    group = CSVModelChoiceField(
        queryset=ApplicationGroup.objects.all(),
        to_field_name='name',
        required=False,
        help_text=_('Application group name'),
    )

    class Meta:
        model = Application
        fields = (
            'name', 'status', 'criticality', 'environment', 'version',
            'description', 'external_url', 'group', 'site', 'tenant',
        )


#
# ApplicationDeployment forms
#

def get_host_content_types():
    """Return a queryset of ContentTypes for host models (Device, VirtualMachine)."""
    return ContentType.objects.filter(
        app_label__in=['dcim', 'virtualization'],
        model__in=['device', 'virtualmachine'],
    ).order_by('model')


class ApplicationDeploymentForm(NetBoxModelForm):
    application = DynamicModelChoiceField(
        label=_('Application'),
        queryset=Application.objects.all(),
    )
    host_type = ContentTypeChoiceField(
        label=_('Host Type'),
        queryset=get_host_content_types(),
        help_text=_('Select Device or Virtual Machine'),
    )
    host_id = forms.IntegerField(
        label=_('Host ID'),
        widget=forms.HiddenInput(),
        required=False,
    )
    device = DynamicModelChoiceField(
        label=_('Device'),
        queryset=Device.objects.all(),
        required=False,
    )
    virtual_machine = DynamicModelChoiceField(
        label=_('Virtual Machine'),
        queryset=Device.objects.none(),
        required=False,
    )

    fieldsets = (
        FieldSet(
            'application', 'role', 'port', 'protocol', 'description', 'tags',
            name=_('Deployment')
        ),
        FieldSet(
            'host_type', 'device', 'virtual_machine',
            name=_('Host')
        ),
    )

    class Meta:
        model = ApplicationDeployment
        fields = [
            'application', 'host_type', 'host_id', 'role',
            'port', 'protocol', 'description', 'tags',
        ]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        try:
            from virtualization.models import VirtualMachine
            self.fields['virtual_machine'] = DynamicModelChoiceField(
                label=_('Virtual Machine'),
                queryset=VirtualMachine.objects.all(),
                required=False,
            )
        except ImportError:
            pass

        if self.instance.pk and self.instance.host_type:
            model_name = self.instance.host_type.model
            if model_name == 'device' and self.instance.host_id:
                self.fields['device'].initial = self.instance.host_id
            elif model_name == 'virtualmachine' and self.instance.host_id:
                self.fields['virtual_machine'].initial = self.instance.host_id

    def clean(self):
        super().clean()
        host_type = self.cleaned_data.get('host_type')
        if host_type:
            model_name = host_type.model
            if model_name == 'device':
                obj = self.cleaned_data.get('device')
            elif model_name == 'virtualmachine':
                obj = self.cleaned_data.get('virtual_machine')
            else:
                obj = None

            if obj:
                self.cleaned_data['host_id'] = obj.pk
            else:
                self.cleaned_data['host_id'] = None
        return self.cleaned_data

    def save(self, *args, **kwargs):
        self.instance.host_type = self.cleaned_data.get('host_type')
        self.instance.host_id = self.cleaned_data.get('host_id')
        return super().save(*args, **kwargs)


class ApplicationDeploymentFilterForm(NetBoxModelFilterSetForm):
    model = ApplicationDeployment
    application_id = DynamicModelChoiceField(
        queryset=Application.objects.all(),
        required=False,
        label=_('Application')
    )
    role = forms.MultipleChoiceField(
        choices=DeploymentRoleChoices,
        required=False,
        label=_('Role')
    )

    fieldsets = (
        FieldSet('application_id', 'role'),
    )


#
# ApplicationDependency forms
#

class ApplicationDependencyForm(NetBoxModelForm):
    source_application = DynamicModelChoiceField(
        label=_('Source Application'),
        queryset=Application.objects.all(),
    )
    target_application = DynamicModelChoiceField(
        label=_('Target Application'),
        queryset=Application.objects.all(),
    )

    fieldsets = (
        FieldSet(
            'source_application', 'target_application',
            'dependency_type', 'protocol', 'port', 'status',
            'description', 'tags',
            name=_('Dependency')
        ),
    )

    class Meta:
        model = ApplicationDependency
        fields = [
            'source_application', 'target_application',
            'dependency_type', 'protocol', 'port', 'status',
            'description', 'tags',
        ]


class ApplicationDependencyFilterForm(NetBoxModelFilterSetForm):
    model = ApplicationDependency
    source_application_id = DynamicModelChoiceField(
        queryset=Application.objects.all(),
        required=False,
        label=_('Source Application')
    )
    target_application_id = DynamicModelChoiceField(
        queryset=Application.objects.all(),
        required=False,
        label=_('Target Application')
    )
    dependency_type = forms.MultipleChoiceField(
        choices=DependencyTypeChoices,
        required=False,
        label=_('Dependency Type')
    )
    protocol = forms.MultipleChoiceField(
        choices=DependencyProtocolChoices,
        required=False,
        label=_('Protocol')
    )
    status = forms.MultipleChoiceField(
        choices=ApplicationStatusChoices,
        required=False,
        label=_('Status')
    )

    fieldsets = (
        FieldSet('source_application_id', 'target_application_id', 'dependency_type', 'protocol', 'status'),
    )


class ApplicationDependencyBulkEditForm(NetBoxModelBulkEditForm):
    dependency_type = forms.ChoiceField(
        choices=DependencyTypeChoices,
        required=False,
        label=_('Dependency Type'),
    )
    protocol = forms.ChoiceField(
        choices=DependencyProtocolChoices,
        required=False,
        label=_('Protocol'),
    )
    status = forms.ChoiceField(
        choices=ApplicationStatusChoices,
        required=False,
        label=_('Status'),
    )
    description = forms.CharField(max_length=500, required=False)

    model = ApplicationDependency
    nullable_fields = ('protocol', 'port', 'description')

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields['dependency_type'].choices = [('', '---------')] + list(DependencyTypeChoices)
        self.fields['protocol'].choices = [('', '---------')] + list(DependencyProtocolChoices)
        self.fields['status'].choices = [('', '---------')] + list(ApplicationStatusChoices)
