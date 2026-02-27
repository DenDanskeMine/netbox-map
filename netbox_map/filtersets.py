import django_filters
from django.contrib.contenttypes.models import ContentType
from django.utils.translation import gettext_lazy as _

from dcim.models import Site, Location
from netbox.filtersets import NetBoxModelFilterSet
from .models import FloorPlan, FloorPlanTile, CustomMarkerType, MapMarker
from .choices import FloorPlanTileStatusChoices, get_all_tile_type_choices


class FloorPlanFilterSet(NetBoxModelFilterSet):
    site_id = django_filters.ModelMultipleChoiceFilter(
        queryset=Site.objects.all(),
        label=_('Site (ID)'),
    )
    site = django_filters.ModelMultipleChoiceFilter(
        field_name='site__slug',
        queryset=Site.objects.all(),
        to_field_name='slug',
        label=_('Site (slug)'),
    )
    location_id = django_filters.ModelMultipleChoiceFilter(
        queryset=Location.objects.all(),
        label=_('Location (ID)'),
    )

    class Meta:
        model = FloorPlan
        fields = ['id', 'name']

    def search(self, queryset, name, value):
        return queryset.filter(name__icontains=value)


class FloorPlanTileFilterSet(NetBoxModelFilterSet):
    floorplan_id = django_filters.ModelMultipleChoiceFilter(
        queryset=FloorPlan.objects.all(),
        label=_('Floor Plan (ID)'),
    )
    assigned_object_type = django_filters.ModelChoiceFilter(
        queryset=ContentType.objects.filter(
            app_label='dcim',
            model__in=['device', 'rack', 'powerpanel', 'powerfeed'],
        ),
        label=_('Object Type'),
    )
    tile_type = django_filters.MultipleChoiceFilter(
        choices=[],
        label=_('Tile Type'),
    )
    status = django_filters.MultipleChoiceFilter(
        choices=FloorPlanTileStatusChoices,
        label=_('Status'),
    )

    class Meta:
        model = FloorPlanTile
        fields = ['id', 'floorplan_id', 'assigned_object_type', 'tile_type', 'status',
                  'x_position', 'y_position']

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.filters['tile_type'].extra['choices'] = get_all_tile_type_choices()

    def search(self, queryset, name, value):
        return queryset.filter(label__icontains=value)


class CustomMarkerTypeFilterSet(NetBoxModelFilterSet):
    class Meta:
        model = CustomMarkerType
        fields = ['id', 'name', 'slug']

    def search(self, queryset, name, value):
        return queryset.filter(name__icontains=value)


class MapMarkerFilterSet(NetBoxModelFilterSet):
    site_id = django_filters.ModelMultipleChoiceFilter(
        queryset=Site.objects.all(),
        label=_('Site (ID)'),
    )
    site = django_filters.ModelMultipleChoiceFilter(
        field_name='site__slug',
        queryset=Site.objects.all(),
        to_field_name='slug',
        label=_('Site (slug)'),
    )
    marker_type = django_filters.MultipleChoiceFilter(
        choices=[],
        label=_('Marker Type'),
    )
    status = django_filters.MultipleChoiceFilter(
        choices=FloorPlanTileStatusChoices,
        label=_('Status'),
    )

    class Meta:
        model = MapMarker
        fields = ['id', 'site_id', 'marker_type', 'status']

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.filters['marker_type'].extra['choices'] = get_all_tile_type_choices()

    def search(self, queryset, name, value):
        return queryset.filter(label__icontains=value)
