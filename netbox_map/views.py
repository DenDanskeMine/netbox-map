import json

from django.contrib import messages
from django.contrib.auth.mixins import LoginRequiredMixin, PermissionRequiredMixin
from django.contrib.contenttypes.models import ContentType
from django.db.models import Count, Prefetch
from django.http import JsonResponse
from django.shortcuts import redirect, render
from django.utils.translation import gettext_lazy as _
from django.views import View

from dcim.models import Device, Location, Site
from netbox.views import generic
from utilities.views import ViewTab, register_model_view

from . import filtersets, forms, tables
from .models import FloorPlan, FloorPlanTile, LocationCoordinates, MapMarker, MapSettings


#
# Site Map (global geographic view)
#

class SiteMapView(LoginRequiredMixin, View):
    """Interactive map of all sites, locations, and geo-placed tiles."""

    def get(self, request):
        all_sites = (
            Site.objects.select_related('region')
            .annotate(floorplan_count=Count('floorplans'))
            .prefetch_related(
                Prefetch('floorplans', queryset=FloorPlan.objects.only('id', 'name', 'site_id'))
            )
        )

        placed_sites = []
        unplaced_sites = []

        for site in all_sites:
            floorplans = []
            for fp in site.floorplans.all():
                floorplans.append({
                    'id': fp.id,
                    'name': fp.name,
                    'visualization_url': f'/plugins/map/floorplans/{fp.id}/visualization/',
                })

            # Locations belonging to this site
            locations_list = []
            for loc in Location.objects.filter(site=site).only('id', 'name'):
                locations_list.append({'id': loc.pk, 'name': loc.name})

            entry = {
                'id': site.pk,
                'name': site.name,
                'status': site.get_status_display(),
                'latitude': float(site.latitude) if site.latitude is not None else None,
                'longitude': float(site.longitude) if site.longitude is not None else None,
                'physical_address': site.physical_address or '',
                'region': site.region.name if site.region else '',
                'url': site.get_absolute_url(),
                'floorplan_count': site.floorplan_count,
                'floorplans': floorplans,
                'locations': locations_list,
            }

            if site.latitude is not None and site.longitude is not None:
                placed_sites.append(entry)
            else:
                unplaced_sites.append(entry)

        # Locations with coordinates
        loc_coords = LocationCoordinates.objects.select_related('location__site')
        locations_data = []
        for lc in loc_coords:
            locations_data.append({
                'id': lc.pk,
                'location_id': lc.location_id,
                'name': lc.location.name,
                'site_name': lc.location.site.name if lc.location.site else '',
                'latitude': float(lc.latitude),
                'longitude': float(lc.longitude),
                'url': lc.location.get_absolute_url(),
            })

        # Unplaced locations (those without LocationCoordinates)
        placed_loc_ids = set(loc_coords.values_list('location_id', flat=True))
        unplaced_locations = []
        for loc in Location.objects.select_related('site').only('id', 'name', 'site__name'):
            if loc.pk not in placed_loc_ids:
                unplaced_locations.append({
                    'id': loc.pk,
                    'name': loc.name,
                    'site_name': loc.site.name if loc.site else '',
                })

        # Tiles with lat/lng (placed on global map)
        all_tiles = (
            FloorPlanTile.objects.select_related('floorplan__site', 'assigned_object_type')
        )
        tiles_data = []
        unplaced_tiles = []
        for tile in all_tiles:
            primary_ip = None
            assigned_obj_name = None
            if tile.assigned_object_type and tile.assigned_object:
                assigned_obj_name = str(tile.assigned_object)
                try:
                    ip_obj = getattr(tile.assigned_object, 'primary_ip', None)
                    if ip_obj:
                        primary_ip = str(ip_obj.address.ip)
                except Exception:
                    pass

            assigned_obj_url = None
            if tile.assigned_object_type and tile.assigned_object:
                try:
                    assigned_obj_url = tile.assigned_object.get_absolute_url()
                except Exception:
                    pass

            tile_entry = {
                'id': tile.pk,
                'label': tile.display_label,
                'type': tile.tile_type,
                'site_name': tile.floorplan.site.name if tile.floorplan and tile.floorplan.site else '',
                'floorplan_name': tile.floorplan.name if tile.floorplan else '',
                'primary_ip': primary_ip,
                'assigned_object_name': assigned_obj_name,
                'assigned_object_url': assigned_obj_url,
                'assigned_object_type': tile.assigned_object_type.model if tile.assigned_object_type else None,
                'assigned_object_id': tile.assigned_object_id,
            }

            if tile.latitude is not None and tile.longitude is not None:
                tile_entry['latitude'] = float(tile.latitude)
                tile_entry['longitude'] = float(tile.longitude)
                tiles_data.append(tile_entry)
            else:
                unplaced_tiles.append(tile_entry)

        # Map markers (standalone markers not linked to floor plans)
        all_markers = MapMarker.objects.select_related('site', 'assigned_object_type')
        markers_data = []
        for m in all_markers:
            primary_ip = None
            assigned_obj_name = None
            if m.assigned_object_type and m.assigned_object:
                assigned_obj_name = str(m.assigned_object)
                try:
                    ip_obj = getattr(m.assigned_object, 'primary_ip', None)
                    if ip_obj:
                        primary_ip = str(ip_obj.address.ip)
                except Exception:
                    pass

            assigned_obj_url = None
            if m.assigned_object_type and m.assigned_object:
                try:
                    assigned_obj_url = m.assigned_object.get_absolute_url()
                except Exception:
                    pass

            markers_data.append({
                'id': m.pk,
                'label': m.display_label,
                'type': m.marker_type,
                'status': m.status,
                'latitude': float(m.latitude),
                'longitude': float(m.longitude),
                'site_id': m.site_id,
                'site_name': m.site.name if m.site else '',
                'primary_ip': primary_ip,
                'fov_direction': m.fov_direction,
                'fov_angle': m.fov_angle,
                'fov_distance': m.fov_distance,
                'assigned_object_type': m.assigned_object_type.model if m.assigned_object_type else None,
                'assigned_object_id': m.assigned_object_id,
                'assigned_object_name': assigned_obj_name,
                'assigned_object_url': assigned_obj_url,
                'description': m.description,
            })

        can_edit = request.user.has_perm('dcim.change_site')

        # Support ?q=lat,lng from NetBox's Maps URL setting
        focus_lat = focus_lng = None
        q = request.GET.get('q', '').strip()
        if q:
            parts = q.split(',')
            if len(parts) == 2:
                try:
                    focus_lat = float(parts[0].strip())
                    focus_lng = float(parts[1].strip())
                except (ValueError, IndexError):
                    pass

        return render(request, 'netbox_map/site_map.html', {
            'placed_sites_json': json.dumps(placed_sites),
            'unplaced_sites_json': json.dumps(unplaced_sites),
            'locations_json': json.dumps(locations_data),
            'unplaced_locations_json': json.dumps(unplaced_locations),
            'tiles_json': json.dumps(tiles_data),
            'unplaced_tiles_json': json.dumps(unplaced_tiles),
            'markers_json': json.dumps(markers_data),
            'can_edit': can_edit,
            'focus_lat': focus_lat,
            'focus_lng': focus_lng,
        })


def _serialize_tile(tile):
    """Serialize a tile for JSON consumption by the JavaScript viewer."""
    primary_ip = None
    mac_address = None
    if (tile.assigned_object_type and
            tile.assigned_object_type.model == 'device' and
            tile.assigned_object):
        try:
            ip_obj = tile.assigned_object.primary_ip
            if ip_obj:
                primary_ip = str(ip_obj.address.ip)
                # Get MAC from the primary IP's assigned interface
                if hasattr(ip_obj, 'assigned_object') and ip_obj.assigned_object:
                    iface = ip_obj.assigned_object
                    if hasattr(iface, 'mac_address') and iface.mac_address:
                        mac_address = str(iface.mac_address)
        except Exception:
            pass
        # Fallback: first interface with a MAC
        if not mac_address:
            try:
                from dcim.models import Interface
                iface = Interface.objects.filter(
                    device=tile.assigned_object,
                    mac_address__isnull=False,
                ).exclude(mac_address='').first()
                if iface and iface.mac_address:
                    mac_address = str(iface.mac_address)
            except Exception:
                pass

    # Collect custom field values for popover display.
    # Read directly from custom_field_data (JSONField on the model) to avoid
    # the per-tile DB query that get_custom_fields() would trigger.
    custom_fields = {}
    if tile.assigned_object:
        try:
            cf_data = getattr(tile.assigned_object, 'custom_field_data', None) or {}
            for name, value in cf_data.items():
                if value is not None and value != '' and value != []:
                    custom_fields[name] = str(value)
        except Exception:
            pass

    return {
        'id': tile.pk,
        'x': tile.x_position,
        'y': tile.y_position,
        'w': tile.width,
        'h': tile.height,
        'label': tile.display_label,
        'type': tile.tile_type,
        'status': tile.status,
        'orientation': tile.orientation,
        'object_type': tile.assigned_object_type_name,
        'object_type_model': tile.assigned_object_type.model if tile.assigned_object_type else None,
        'object_name': str(tile.assigned_object) if tile.assigned_object else None,
        'object_id': tile.assigned_object_id,
        'object_url': tile.assigned_object_url,
        'primary_ip': primary_ip,
        'mac': mac_address,
        'custom_fields': custom_fields,
        'utilization': round(tile.utilization, 1) if tile.utilization is not None else None,
        'fov_direction': tile.fov_direction,
        'fov_angle': tile.fov_angle,
        'fov_distance': tile.fov_distance,
    }


#
# FloorPlan views
#

class FloorPlanListView(generic.ObjectListView):
    queryset = FloorPlan.objects.annotate(
        tile_count=Count('tiles')
    )
    filterset = filtersets.FloorPlanFilterSet
    filterset_form = forms.FloorPlanFilterForm
    table = tables.FloorPlanTable


@register_model_view(FloorPlan)
class FloorPlanView(generic.ObjectView):
    queryset = FloorPlan.objects.all()

    def get_extra_context(self, request, instance):
        tiles = instance.tiles.select_related('assigned_object_type').all()
        tile_data = [_serialize_tile(tile) for tile in tiles]
        return {
            'tile_data_json': json.dumps(tile_data),
            'linked_tile_count': instance.tiles.filter(assigned_object_type__isnull=False).count(),
        }


@register_model_view(FloorPlan, 'edit')
class FloorPlanEditView(generic.ObjectEditView):
    queryset = FloorPlan.objects.all()
    form = forms.FloorPlanForm


@register_model_view(FloorPlan, 'delete')
class FloorPlanDeleteView(generic.ObjectDeleteView):
    queryset = FloorPlan.objects.all()


class FloorPlanBulkImportView(generic.BulkImportView):
    queryset = FloorPlan.objects.all()
    model_form = forms.FloorPlanImportForm


class FloorPlanBulkEditView(generic.BulkEditView):
    queryset = FloorPlan.objects.all()
    filterset = filtersets.FloorPlanFilterSet
    table = tables.FloorPlanTable
    form = forms.FloorPlanBulkEditForm


class FloorPlanBulkDeleteView(generic.BulkDeleteView):
    queryset = FloorPlan.objects.all()
    filterset = filtersets.FloorPlanFilterSet
    table = tables.FloorPlanTable


#
# FloorPlan Visualization (the main interactive view)
#

@register_model_view(FloorPlan, 'visualization', path='visualization')
class FloorPlanVisualizationView(generic.ObjectView):
    queryset = FloorPlan.objects.all()
    template_name = 'netbox_map/floorplan_visualization.html'
    tab = ViewTab(
        label=_('Visualization'),
    )

    def get_extra_context(self, request, instance):
        tiles = instance.tiles.select_related('assigned_object_type').all()
        tile_data = [_serialize_tile(tile) for tile in tiles]

        site_floorplans = list(FloorPlan.objects.filter(
            site=instance.site
        ).values('id', 'name', 'location__name'))

        settings = MapSettings.load()

        popover_config = {'default': settings.popover_fields}
        popover_config.update(settings.tile_popover_config or {})

        return {
            'tile_data_json': json.dumps(tile_data),
            'grid_width': instance.grid_width,
            'grid_height': instance.grid_height,
            'tile_size': instance.tile_size,
            'site_floorplans': site_floorplans,
            'edit_mode': request.GET.get('edit', '') == 'true',
            'site_id': instance.site_id,
            'popover_fields_json': json.dumps(popover_config),
        }


#
# FloorPlanTile views
#

class FloorPlanTileListView(generic.ObjectListView):
    queryset = FloorPlanTile.objects.select_related('floorplan', 'assigned_object_type')
    filterset = filtersets.FloorPlanTileFilterSet
    filterset_form = forms.FloorPlanTileFilterForm
    table = tables.FloorPlanTileTable


@register_model_view(FloorPlanTile)
class FloorPlanTileView(generic.ObjectView):
    queryset = FloorPlanTile.objects.select_related('floorplan', 'assigned_object_type')


@register_model_view(FloorPlanTile, 'edit')
class FloorPlanTileEditView(generic.ObjectEditView):
    queryset = FloorPlanTile.objects.all()
    form = forms.FloorPlanTileForm


@register_model_view(FloorPlanTile, 'delete')
class FloorPlanTileDeleteView(generic.ObjectDeleteView):
    queryset = FloorPlanTile.objects.all()


class FloorPlanTileBulkImportView(generic.BulkImportView):
    queryset = FloorPlanTile.objects.all()
    model_form = forms.FloorPlanTileImportForm


class FloorPlanTileBulkDeleteView(generic.BulkDeleteView):
    queryset = FloorPlanTile.objects.all()
    filterset = filtersets.FloorPlanTileFilterSet
    table = tables.FloorPlanTileTable


#
# Site tab: Register a "Floor Plans" tab on the Site detail view
#

@register_model_view(Site, 'floorplans', path='floorplans')
class SiteFloorPlansView(generic.ObjectChildrenView):
    queryset = Site.objects.all()
    child_model = FloorPlan
    table = tables.FloorPlanTable
    filterset = filtersets.FloorPlanFilterSet
    tab = ViewTab(
        label=_('Floor Plans'),
        badge=lambda obj: obj.floorplans.count(),
        permission='netbox_map.view_floorplan'
    )

    def get_children(self, request, parent):
        return FloorPlan.objects.filter(site=parent).annotate(
            tile_count=Count('tiles')
        )


#
# MapMarker views
#

class MapMarkerListView(generic.ObjectListView):
    queryset = MapMarker.objects.select_related('site', 'assigned_object_type')
    filterset = filtersets.MapMarkerFilterSet
    filterset_form = forms.MapMarkerFilterForm
    table = tables.MapMarkerTable


@register_model_view(MapMarker)
class MapMarkerView(generic.ObjectView):
    queryset = MapMarker.objects.select_related('site', 'assigned_object_type')


@register_model_view(MapMarker, 'edit')
class MapMarkerEditView(generic.ObjectEditView):
    queryset = MapMarker.objects.all()
    form = forms.MapMarkerForm


@register_model_view(MapMarker, 'delete')
class MapMarkerDeleteView(generic.ObjectDeleteView):
    queryset = MapMarker.objects.all()


class MapMarkerBulkImportView(generic.BulkImportView):
    queryset = MapMarker.objects.all()
    model_form = forms.MapMarkerImportForm


class MapMarkerBulkDeleteView(generic.BulkDeleteView):
    queryset = MapMarker.objects.all()
    filterset = filtersets.MapMarkerFilterSet
    table = tables.MapMarkerTable


#
# AJAX Marker Detail endpoint
#

class MarkerDetailView(LoginRequiredMixin, View):
    """AJAX endpoint returning enriched detail for a marker's assigned object."""

    SETTINGS_FIELD_MAP = {
        'device': 'device_fields',
        'rack': 'rack_fields',
        'powerpanel': 'powerpanel_fields',
        'powerfeed': 'powerfeed_fields',
    }

    SELECT_RELATED = {
        'device': ['role', 'platform', 'device_type__manufacturer', 'tenant', 'site'],
        'rack': ['role', 'site', 'location', 'tenant'],
        'powerpanel': ['site', 'location'],
        'powerfeed': ['power_panel', 'rack'],
    }

    def get(self, request, object_type, object_id):
        try:
            ct = ContentType.objects.get(app_label='dcim', model=object_type)
        except ContentType.DoesNotExist:
            return JsonResponse({'error': 'Unknown object type'}, status=404)

        model = ct.model_class()
        related = self.SELECT_RELATED.get(object_type, [])
        qs = model.objects.all()
        if related:
            qs = qs.select_related(*related)

        try:
            obj = qs.get(pk=object_id)
        except model.DoesNotExist:
            return JsonResponse({'error': 'Object not found'}, status=404)

        # Standard fields from DB settings
        settings = MapSettings.load()
        attr = self.SETTINGS_FIELD_MAP.get(object_type)
        fields_list = getattr(settings, attr, []) if attr else []

        standard_fields = []
        for field_name in fields_list:
            value = self._resolve_field(obj, field_name)
            if value is not None:
                label = field_name.replace('_', ' ').title()
                try:
                    label = obj._meta.get_field(field_name).verbose_name.title()
                except Exception:
                    pass
                standard_fields.append({'label': label, 'value': str(value)})

        # MAC address (device only)
        mac_address = None
        if object_type == 'device' and settings.show_mac:
            mac_address = self._get_mac_address(obj)

        # Custom fields
        custom_fields = []
        if settings.show_custom_fields:
            custom_fields = self._get_custom_fields(obj)

        return JsonResponse({
            'standard_fields': standard_fields,
            'mac_address': mac_address,
            'custom_fields': custom_fields,
        })

    def _resolve_field(self, obj, field_name):
        """Resolve a field value, handling FK and choice fields."""
        display_method = f'get_{field_name}_display'
        if hasattr(obj, display_method):
            return getattr(obj, display_method)()

        value = getattr(obj, field_name, None)
        if value is None:
            return None

        if hasattr(value, 'get_absolute_url'):
            return str(value)

        return value

    def _get_mac_address(self, device):
        """Get MAC from primary IP's interface, fallback to first interface with MAC."""
        try:
            primary_ip = device.primary_ip4 or device.primary_ip6
            if primary_ip and hasattr(primary_ip, 'assigned_object') and primary_ip.assigned_object:
                iface = primary_ip.assigned_object
                if hasattr(iface, 'mac_address') and iface.mac_address:
                    return str(iface.mac_address)

            from dcim.models import Interface
            iface = Interface.objects.filter(
                device=device,
                mac_address__isnull=False,
            ).exclude(mac_address='').first()
            if iface and iface.mac_address:
                return str(iface.mac_address)
        except Exception:
            pass
        return None

    def _get_custom_fields(self, obj):
        """Get visible custom fields with their values."""
        result = []
        try:
            for cf, value in obj.get_custom_fields(omit_hidden=True).items():
                if value is not None and value != '' and value != []:
                    result.append({
                        'label': cf.label,
                        'value': str(value),
                        'group': cf.group_name if cf.group_name else None,
                    })
        except Exception:
            pass
        return result


#
# Map Settings
#

class MapSettingsView(LoginRequiredMixin, PermissionRequiredMixin, View):
    permission_required = 'netbox_map.view_floorplan'

    TILE_POPOVER_TYPES = [
        {'key': 'rack', 'label': 'Rack', 'icon': 'mdi-collage', 'field_name': 'rack_popover_fields'},
        {'key': 'aisle', 'label': 'Aisle', 'icon': 'mdi-arrow-expand-horizontal', 'field_name': 'aisle_popover_fields'},
        {'key': 'wall', 'label': 'Wall', 'icon': 'mdi-wall', 'field_name': 'wall_popover_fields'},
        {'key': 'column', 'label': 'Column', 'icon': 'mdi-square-outline', 'field_name': 'column_popover_fields'},
        {'key': 'door', 'label': 'Door', 'icon': 'mdi-door-open', 'field_name': 'door_popover_fields'},
        {'key': 'cooling', 'label': 'Cooling', 'icon': 'mdi-snowflake', 'field_name': 'cooling_popover_fields'},
        {'key': 'power', 'label': 'Power', 'icon': 'mdi-flash-outline', 'field_name': 'power_popover_fields'},
        {'key': 'empty', 'label': 'Empty', 'icon': 'mdi-checkbox-blank-outline', 'field_name': 'empty_popover_fields'},
        {'key': 'reserved', 'label': 'Reserved', 'icon': 'mdi-calendar-clock', 'field_name': 'reserved_popover_fields'},
        {'key': 'ap', 'label': 'Access Point', 'icon': 'mdi-wifi', 'field_name': 'ap_popover_fields'},
        {'key': 'camera', 'label': 'Camera', 'icon': 'mdi-cctv', 'field_name': 'camera_popover_fields'},
        {'key': 'printer', 'label': 'Printer', 'icon': 'mdi-printer', 'field_name': 'printer_popover_fields'},
    ]

    def _get_context(self, form):
        return {
            'form': form,
            'tile_popover_types': self.TILE_POPOVER_TYPES,
        }

    def get(self, request):
        settings = MapSettings.load()
        form = forms.MapSettingsForm(instance=settings)
        return render(request, 'netbox_map/settings.html', self._get_context(form))

    def post(self, request):
        settings = MapSettings.load()
        form = forms.MapSettingsForm(request.POST, instance=settings)
        if form.is_valid():
            form.save()
            messages.success(request, 'Map settings saved.')
            return redirect('plugins:netbox_map:settings')
        return render(request, 'netbox_map/settings.html', self._get_context(form))


#
# Device tab: Map Locations
#

def _count_device_locations(device):
    device_ct = ContentType.objects.get_for_model(device)
    tile_count = FloorPlanTile.objects.filter(
        assigned_object_type=device_ct,
        assigned_object_id=device.pk,
    ).count()
    marker_count = MapMarker.objects.filter(
        assigned_object_type=device_ct,
        assigned_object_id=device.pk,
    ).count()
    return tile_count + marker_count


@register_model_view(Device, 'map_locations', path='map-locations')
class DeviceMapLocationsView(generic.ObjectView):
    queryset = Device.objects.all()
    template_name = 'netbox_map/device_map_locations.html'
    tab = ViewTab(
        label=_('Map Locations'),
        badge=lambda obj: _count_device_locations(obj),
        permission='netbox_map.view_floorplantile',
    )

    def get_extra_context(self, request, instance):
        device_ct = ContentType.objects.get_for_model(Device)
        tiles = FloorPlanTile.objects.filter(
            assigned_object_type=device_ct,
            assigned_object_id=instance.pk,
        ).select_related('floorplan__site')
        markers = MapMarker.objects.filter(
            assigned_object_type=device_ct,
            assigned_object_id=instance.pk,
        ).select_related('site')
        return {
            'tiles': tiles,
            'markers': markers,
        }
