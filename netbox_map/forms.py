from dcim.choices import CableTypeChoices, SiteStatusChoices
from dcim.models import (
    Device,
    DeviceRole,
    FrontPort,
    Location,
    PowerFeed,
    PowerPanel,
    Rack,
    RearPort,
    Region,
    Site,
    SiteGroup,
)
from django import forms
from django.contrib.contenttypes.models import ContentType
from django.utils.translation import gettext_lazy as _
from ipam.models import IPAddress, Service
from netbox.forms import NetBoxModelBulkEditForm, NetBoxModelFilterSetForm, NetBoxModelForm, NetBoxModelImportForm
from tenancy.models import Tenant
from utilities.forms.fields import (
    CommentField,
    ContentTypeChoiceField,
    CSVChoiceField,
    CSVModelChoiceField,
    DynamicModelChoiceField,
    DynamicModelMultipleChoiceField,
    SlugField,
    TagFilterField,
)
from utilities.forms.rendering import FieldSet
from utilities.forms.widgets import APISelect, APISelectMultiple

from .choices import (
    ApplicationCriticalityChoices,
    ApplicationEnvironmentChoices,
    ApplicationStatusChoices,
    CablePathStatusChoices,
    DependencyProtocolChoices,
    DependencyTypeChoices,
    DeploymentRoleChoices,
    FloorPlanTileStatusChoices,
    FloorPlanTileTypeChoices,
    get_all_tile_type_choices,
    get_all_type_configs,
)
from .models import (
    Application,
    ApplicationDependency,
    ApplicationDeployment,
    ApplicationGroup,
    ApplicationTemplate,
    CablePath,
    CustomMarkerType,
    FloorPlan,
    FloorPlanTile,
    MapMarker,
    MapSettings,
    TopologySavedView,
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

    # #52 / #67 — opt-in checkbox for the JS auto-suggest. Default ON for
    # new plans (you usually want the suggestion) and OFF when editing an
    # existing plan (so you don't accidentally overwrite a custom grid).
    autofill_grid = forms.BooleanField(
        required=False,
        label=_('Auto-fill grid from background'),
        help_text=_(
            'When checked, picking a new background image (or PDF) auto-fills '
            'the grid width/height based on the image dimensions and tile size.'
        ),
    )

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
            'background_image', 'autofill_grid',
            name=_('Background')
        ),
    )

    class Media:
        # #52 — auto-suggest grid_width / grid_height from the chosen
        # background image dimensions (pure client-side).
        js = ('netbox_map/js/floorplan_form_autosuggest.js',)

    class Meta:
        model = FloorPlan
        fields = [
            'site', 'location', 'name', 'grid_width', 'grid_height',
            'tile_size', 'background_image', 'description', 'comments', 'tags',
        ]

    # Allowed background_image content types — raster images plus PDF.
    # PDF is intercepted and rasterized in clean_background_image() before
    # the file ever hits storage, so everything downstream still sees a PNG.
    _ALLOWED_IMAGE_EXTS = {'.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tif', '.tiff'}
    _ALLOWED_EXTS = _ALLOWED_IMAGE_EXTS | {'.pdf'}

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        # Default autofill_grid: ON for new plans, OFF when editing
        if self.instance and not self.instance.pk:
            self.fields['autofill_grid'].initial = True

    def clean_background_image(self):
        """Accept image OR PDF — store both as-is.

        PDFs are rendered to canvas in the browser via PDF.js at the user's
        current zoom level, which keeps them sharp at any scale instead of
        the blurry rasterized PNG approach we used before. Server-side we
        only validate the file extension; the actual file bytes go straight
        to FileStorage.
        """
        f = self.cleaned_data.get('background_image')
        if not f or not hasattr(f, 'name'):
            return f
        import os
        ext = os.path.splitext(f.name)[1].lower()
        if ext not in self._ALLOWED_EXTS:
            raise forms.ValidationError(
                _('Unsupported file type. Allowed: %(exts)s.') % {
                    'exts': ', '.join(sorted(self._ALLOWED_EXTS)),
                }
            )
        return f


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
            'name', 'slug', 'color', 'icon', 'icon_foreground', 'description', 'tags',
            name=_('Custom Marker Type')
        ),
    )

    class Media:
        # #63 — icon picker widget (loaded via custom template since
        # NetBox's default ObjectEditView doesn't emit form media)
        js = ('netbox_map/js/icon_picker.js',)
        css = {'all': ('netbox_map/css/icon_picker.css',)}

    class Meta:
        model = CustomMarkerType
        fields = ['name', 'slug', 'color', 'icon', 'icon_foreground', 'description', 'tags']
        widgets = {
            'color': forms.TextInput(attrs={'type': 'color'}),
            # #63 — the icon picker JS hooks onto this field's id
            'icon': forms.TextInput(attrs={'class': 'icon-picker-input', 'placeholder': 'mdi-…'}),
        }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields['icon'].help_text = _(
            'Click an icon below or type any Material Design Icons (mdi-) name. '
            'Browse the full set at https://pictogrammers.com/library/mdi/.'
        )
        if not self.instance.pk:
            self.fields['slug'].required = False
            self.fields['slug'].help_text = _(
                'Leave blank to auto-generate from name. Will be prefixed with "custom_".'
            )


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

    # #63 — Inverted UI: admins tick the types they want **active** in the
    # toolbar. The model field stores the inverse (hidden list) so adding
    # new types in future plugin versions keeps them visible by default.
    # `form-check-input` is the Bootstrap class NetBox uses for checkboxes.
    _cbm_attrs = {'class': 'form-check-input'}
    visible_tile_types = forms.MultipleChoiceField(
        choices=(),  # populated dynamically in __init__
        widget=forms.CheckboxSelectMultiple(attrs=_cbm_attrs),
        required=False,
        label=_('Active Tile Types — Floor Plan'),
        help_text=_(
            'Ticked types appear in the floor-plan editor toolbar. '
            'Existing tiles of unticked types still render normally.'
        ),
    )
    visible_tile_types_sitemap = forms.MultipleChoiceField(
        choices=(),  # populated dynamically in __init__
        widget=forms.CheckboxSelectMultiple(attrs=_cbm_attrs),
        required=False,
        label=_('Active Tile Types — Site Map'),
        help_text=_(
            'Ticked types appear in the Site Map create-chip tray. '
            'Existing markers of unticked types still render normally.'
        ),
    )

    class Meta:
        model = MapSettings
        fields = (
            'show_mac', 'show_custom_fields', 'sync_device_gps',
            'site_map_load_empty',
            'device_fields', 'rack_fields', 'powerpanel_fields', 'powerfeed_fields',
            'popover_fields',
            # NB: hidden_tile_types is set via the visible_tile_types proxy field
            # in save() — not exposed directly to the user.
        )

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)

        # Dynamically discover NetBox custom fields for assignable object types.
        all_cf_choices = []
        try:
            from django.contrib.contenttypes.models import ContentType
            from extras.models import CustomField

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

        # #63 — Build the (active types) checkbox choices from every known
        # tile type (built-in + custom). Initial value = all types NOT
        # in hidden_tile_types.
        from .choices import BUILTIN_TYPE_CONFIG
        from .models import CustomMarkerType
        type_choices = [(slug, info['name']) for slug, info in BUILTIN_TYPE_CONFIG.items()]
        try:
            for ct in CustomMarkerType.objects.order_by('name'):
                type_choices.append((ct.slug, f'{ct.name} (custom)'))
        except Exception:
            pass
        self.fields['visible_tile_types'].choices = type_choices
        self.fields['visible_tile_types_sitemap'].choices = type_choices
        if self.instance and self.instance.pk:
            hidden_fp = set(self.instance.hidden_tile_types or [])
            hidden_sm = set(self.instance.hidden_tile_types_sitemap or [])
        else:
            hidden_fp = hidden_sm = set()
        self.initial['visible_tile_types'] = [slug for slug, _ in type_choices if slug not in hidden_fp]
        self.initial['visible_tile_types_sitemap'] = [slug for slug, _ in type_choices if slug not in hidden_sm]

    def save(self, commit=True):
        instance = super().save(commit=False)

        # Reconstruct tile_popover_config dict from per-type form fields
        config = {}
        for type_key, _label in self._tile_type_info:
            field_name = f'{type_key}_popover_fields'
            config[type_key] = self.cleaned_data.get(field_name, [])
        instance.tile_popover_config = config

        # #63 — Invert each "active" selection into its stored hidden list
        from .choices import BUILTIN_TYPE_CONFIG
        from .models import CustomMarkerType
        all_slugs = set(BUILTIN_TYPE_CONFIG.keys())
        try:
            all_slugs.update(CustomMarkerType.objects.values_list('slug', flat=True))
        except Exception:
            pass
        visible_fp = set(self.cleaned_data.get('visible_tile_types') or [])
        visible_sm = set(self.cleaned_data.get('visible_tile_types_sitemap') or [])
        instance.hidden_tile_types = sorted(all_slugs - visible_fp)
        instance.hidden_tile_types_sitemap = sorted(all_slugs - visible_sm)

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
    # #64 — Filter sites by tag. NetBox's SiteFilterSet already accepts
    # ?tag=<slug> for the queryset side; this just exposes it in the UI as a
    # dropdown of tags actually used on Site.
    tag = TagFilterField(model=Site)


#
# Topology filter form
#

class TopologyFilterForm(forms.Form):
    # #53 — multi-site selection so users can render topologies that span
    # multiple sites (eg primary DC + DR, or campus + branch with inter-site
    # cables). Sites with cables to selected sites are still drawn from the
    # union; if both endpoints are in the picked set the edge appears too.
    site_id = DynamicModelMultipleChoiceField(
        queryset=Site.objects.all(),
        required=False,
        label=_('Site'),
        widget=APISelectMultiple(attrs={'data-placeholder': _('Site')}),
    )
    tenant_id = DynamicModelChoiceField(
        queryset=Tenant.objects.all(),
        required=False,
        label=_('Tenant'),
        widget=APISelect(attrs={'data-placeholder': _('Tenant')}),
    )
    location_id = DynamicModelChoiceField(
        queryset=Location.objects.all(),
        required=False,
        label=_('Location'),
        query_params={'site_id': '$site_id'},
        widget=APISelect(attrs={'data-placeholder': _('Location')}),
    )
    rack_id = DynamicModelChoiceField(
        queryset=Rack.objects.all(),
        required=False,
        label=_('Rack'),
        query_params={'site_id': '$site_id', 'location_id': '$location_id'},
        widget=APISelect(attrs={'data-placeholder': _('Rack')}),
    )
    role_id = DynamicModelMultipleChoiceField(
        queryset=DeviceRole.objects.all(),
        required=False,
        label=_('Device Role'),
        widget=APISelectMultiple(attrs={'data-placeholder': _('Role')}),
    )
    cable_type = forms.ChoiceField(
        choices=[('', _('Cable type'))] + list(CableTypeChoices),
        required=False,
        label=_('Cable Type'),
    )
    # #44 — Filter devices by tag (multi-select dropdown of tags actually
    # used on Device, instead of a free-text slug input).
    tag = TagFilterField(model=Device)
    # #35 — Toggle to include MPTT descendants for hierarchical filters
    include_sub_locations = forms.BooleanField(
        required=False,
        label=_('Include sub-locations'),
        help_text=_('When a Location is selected, also include its descendants.'),
    )
    include_sub_roles = forms.BooleanField(
        required=False,
        label=_('Include sub-roles'),
        help_text=_('When Device Role(s) are selected, also include their descendants.'),
    )

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        # TagFilterField doesn't accept a custom widget kwarg, so set
        # its placeholder here so it matches the other filter dropdowns.
        self.fields['tag'].widget.attrs['data-placeholder'] = _('Tag')


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
    slug = SlugField()

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
# ApplicationTemplate forms
#

class ApplicationTemplateForm(NetBoxModelForm):
    slug = SlugField()
    group = DynamicModelChoiceField(queryset=ApplicationGroup.objects.all(), required=False)

    fieldsets = (
        FieldSet('name', 'slug', 'description', 'group', 'tags', name=_('Template')),
        FieldSet(
            'default_status', 'default_criticality', 'default_environment', 'default_version',
            name=_('Application Defaults'),
        ),
        FieldSet('default_role', 'default_port', 'default_protocol', name=_('Deployment Defaults')),
        FieldSet('name_format', name=_('Instance Naming')),
    )

    class Meta:
        model = ApplicationTemplate
        fields = [
            'name', 'slug', 'description', 'group', 'default_status',
            'default_criticality', 'default_environment', 'default_version',
            'default_role', 'default_port', 'default_protocol',
            'name_format', 'tags',
        ]


class ApplicationTemplateFilterForm(NetBoxModelFilterSetForm):
    model = ApplicationTemplate
    group_id = DynamicModelChoiceField(queryset=ApplicationGroup.objects.all(), required=False, label=_('Group'))
    default_criticality = forms.MultipleChoiceField(
        choices=ApplicationCriticalityChoices, required=False, label=_('Criticality'),
    )

    fieldsets = (FieldSet('group_id', 'default_criticality'),)


class ApplicationTemplateDeployForm(forms.Form):
    """Deploy a template to multiple hosts — creates an Application per host."""
    devices = DynamicModelMultipleChoiceField(
        label=_('Devices'),
        queryset=Device.objects.all(),
        required=False,
    )

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        try:
            from virtualization.models import VirtualMachine
            self.fields['virtual_machines'] = DynamicModelMultipleChoiceField(
                label=_('Virtual Machines'),
                queryset=VirtualMachine.objects.all(),
                required=False,
            )
        except ImportError:
            pass


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
    primary_ip = DynamicModelChoiceField(
        label=_('Primary IP'),
        queryset=IPAddress.objects.all(),
        required=False,
    )
    comments = CommentField()

    fieldsets = (
        FieldSet(
            'name', 'status', 'criticality', 'environment', 'version', 'description', 'tags',
            name=_('Application')
        ),
        FieldSet(
            'default_port', 'default_protocol', 'primary_ip',
            name=_('Service Defaults')
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
            'default_port', 'default_protocol', 'primary_ip',
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
    template = DynamicModelChoiceField(
        label=_('From Template'),
        queryset=ApplicationTemplate.objects.all(),
        required=False,
        help_text=_('Select a template to auto-create an application. Leave empty to use an existing application.'),
    )
    application = DynamicModelChoiceField(
        label=_('Application'),
        queryset=Application.objects.all(),
        required=False,
        quick_add=True,
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
    ip_address = DynamicModelChoiceField(
        label=_('IP Address'),
        queryset=IPAddress.objects.all(),
        required=False,
    )
    service = DynamicModelChoiceField(
        label=_('Service'),
        queryset=Service.objects.all(),
        required=False,
        help_text=_('Link to an existing NetBox application service'),
    )

    fieldsets = (
        FieldSet(
            'template', 'application', 'role', 'port', 'protocol', 'ip_address', 'service', 'description', 'tags',
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
            'port', 'protocol', 'ip_address', 'service', 'description', 'tags',
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

        # Template logic: if template is provided, application is not required
        template = self.cleaned_data.get('template')
        if template and not self.cleaned_data.get('application'):
            # Will create app from template in save()
            pass
        elif not template and not self.cleaned_data.get('application'):
            raise forms.ValidationError({'application': 'Select an application or a template.'})

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

        # If a template was selected, create an Application from it
        template = self.cleaned_data.get('template')
        if template and not self.instance.application_id:
            # Get host name for the name format
            host_obj = None
            if self.cleaned_data.get('device'):
                host_obj = self.cleaned_data['device']
            elif self.cleaned_data.get('virtual_machine'):
                host_obj = self.cleaned_data['virtual_machine']

            host_name = str(host_obj) if host_obj else 'unknown'
            app_name = template.name_format.replace('{app}', template.name).replace('{host}', host_name)

            app = Application.objects.create(
                name=app_name,
                status=template.default_status,
                criticality=template.default_criticality,
                environment=template.default_environment,
                version=template.default_version,
                group=template.group,
                description=template.description,
            )
            self.instance.application = app

            # Pre-fill deployment fields from template if not set by user
            if not self.instance.port and template.default_port:
                self.instance.port = template.default_port
            if not self.instance.protocol and template.default_protocol:
                self.instance.protocol = template.default_protocol
            if not self.cleaned_data.get('role') or self.cleaned_data['role'] == 'primary':
                self.instance.role = template.default_role

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


class ApplicationBulkDeployForm(forms.Form):
    """Deploy an application to multiple devices at once."""

    DEPLOY_MODE_CHOICES = [
        ('instances', _('Separate instances (one app per host)')),
        ('shared', _('Shared (one app, multiple hosts)')),
    ]

    mode = forms.ChoiceField(
        label=_('Deploy Mode'),
        choices=DEPLOY_MODE_CHOICES,
        initial='instances',
        help_text=_('Separate: creates a copy of this app for each host — independent status per host. '
                    'Shared: links this single app to all selected hosts.'),
    )
    devices = DynamicModelMultipleChoiceField(
        label=_('Devices'),
        queryset=Device.objects.all(),
        required=False,
    )
    role = forms.ChoiceField(
        label=_('Role'),
        choices=DeploymentRoleChoices,
        initial='primary',
    )
    port = forms.IntegerField(
        label=_('Port'),
        required=False,
    )
    protocol = forms.CharField(
        label=_('Protocol'),
        max_length=50,
        required=False,
    )
    name_format = forms.CharField(
        label=_('Instance Name Format'),
        initial='{app}',
        required=False,
        help_text=_('Name for each instance. Use {app} for app name, {host} for hostname. '
                    'Example: "{app} ({host})" → "Redis (srv-db-01)". Leave as "{app}" to keep the original name.'),
    )

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        try:
            from virtualization.models import VirtualMachine
            self.fields['virtual_machines'] = DynamicModelMultipleChoiceField(
                label=_('Virtual Machines'),
                queryset=VirtualMachine.objects.all(),
                required=False,
            )
        except ImportError:
            pass


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
