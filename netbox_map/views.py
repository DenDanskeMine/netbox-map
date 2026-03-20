import json

from django.contrib import messages
from django.contrib.auth.mixins import LoginRequiredMixin, PermissionRequiredMixin
from django.contrib.contenttypes.models import ContentType
from django.db.models import Count, Prefetch
from django.http import JsonResponse
from django.shortcuts import redirect, render
from django.utils.translation import gettext_lazy as _
from django.views import View

from dcim.filtersets import SiteFilterSet
from dcim.models import Device, Location, Site
from netbox.views import generic
from utilities.views import ViewTab, register_model_view

from . import filtersets, forms, tables
from .choices import get_all_type_configs
from .models import FloorPlan, FloorPlanTile, CustomMarkerType, LocationCoordinates, MapMarker, MapSettings, TilePortAssignment, CablePath


#
# CustomMarkerType views
#

class CustomMarkerTypeListView(generic.ObjectListView):
    queryset = CustomMarkerType.objects.all()
    filterset = filtersets.CustomMarkerTypeFilterSet
    filterset_form = forms.CustomMarkerTypeFilterForm
    table = tables.CustomMarkerTypeTable


@register_model_view(CustomMarkerType)
class CustomMarkerTypeView(generic.ObjectView):
    queryset = CustomMarkerType.objects.all()


@register_model_view(CustomMarkerType, 'edit')
class CustomMarkerTypeEditView(generic.ObjectEditView):
    queryset = CustomMarkerType.objects.all()
    form = forms.CustomMarkerTypeForm


@register_model_view(CustomMarkerType, 'delete')
class CustomMarkerTypeDeleteView(generic.ObjectDeleteView):
    queryset = CustomMarkerType.objects.all()


class CustomMarkerTypeBulkEditView(generic.BulkEditView):
    queryset = CustomMarkerType.objects.all()
    filterset = filtersets.CustomMarkerTypeFilterSet
    table = tables.CustomMarkerTypeTable
    form = forms.CustomMarkerTypeBulkEditForm


class CustomMarkerTypeBulkImportView(generic.BulkImportView):
    queryset = CustomMarkerType.objects.all()
    model_form = forms.CustomMarkerTypeImportForm


class CustomMarkerTypeBulkDeleteView(generic.BulkDeleteView):
    queryset = CustomMarkerType.objects.all()
    filterset = filtersets.CustomMarkerTypeFilterSet
    table = tables.CustomMarkerTypeTable


#
# Site Map (global geographic view)
#

class SiteMapView(LoginRequiredMixin, View):
    """Interactive map of all sites, locations, and geo-placed tiles."""

    def get(self, request):
        base_qs = (
            Site.objects.select_related('region')
            .annotate(floorplan_count=Count('floorplans'))
            .prefetch_related(
                Prefetch('floorplans', queryset=FloorPlan.objects.only('id', 'name', 'site_id'))
            )
        )
        # Apply filters from GET params (status, region, cf_* custom fields, etc.)
        filter_params = request.GET.copy()
        filter_params.pop('q', None)  # q is used for lat/lng focus — don't pass to filterset
        site_filterset = SiteFilterSet(data=filter_params or None, queryset=base_qs)
        all_sites = site_filterset.qs

        # Device role filter — not in SiteFilterSet, applied separately
        device_role_ids = request.GET.getlist('device_role_id')
        if device_role_ids:
            all_sites = all_sites.filter(devices__role__id__in=device_role_ids).distinct()

        filter_form = forms.SiteMapFilterForm(data=request.GET or None)

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

        # Cable paths
        all_cable_paths = CablePath.objects.select_related('start_marker', 'end_marker')
        cable_paths_data = []
        for cp in all_cable_paths:
            cable_paths_data.append({
                'id': cp.pk,
                'label': cp.label,
                'path_coordinates': cp.path_coordinates,
                'fiber_count': cp.fiber_count,
                'cable_type': cp.cable_type,
                'status': cp.status,
                'status_color': cp.get_status_color(),
                'color': cp.color,
                'weight': cp.weight,
                'display_color': cp.get_display_color(),
                'start_marker_id': cp.start_marker_id,
                'end_marker_id': cp.end_marker_id,
                'start_marker_label': str(cp.start_marker) if cp.start_marker else '',
                'end_marker_label': str(cp.end_marker) if cp.end_marker else '',
            })

        can_edit = request.user.has_perm('netbox_map.change_mapmarker')

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

        type_configs = get_all_type_configs()

        return render(request, 'netbox_map/site_map.html', {
            'placed_sites_json': json.dumps(placed_sites),
            'unplaced_sites_json': json.dumps(unplaced_sites),
            'locations_json': json.dumps(locations_data),
            'unplaced_locations_json': json.dumps(unplaced_locations),
            'tiles_json': json.dumps(tiles_data),
            'unplaced_tiles_json': json.dumps(unplaced_tiles),
            'markers_json': json.dumps(markers_data),
            'cable_paths_json': json.dumps(cable_paths_data),
            'can_edit': can_edit,
            'focus_lat': focus_lat,
            'focus_lng': focus_lng,
            'type_configs': type_configs,
            'type_configs_json': json.dumps(type_configs),
            'filter_form': filter_form,
            'active_filters': bool(filter_params),
            'active_statuses': request.GET.getlist('status'),
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

    result = {
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
        'linked_floorplan_id': tile.linked_floorplan_id,
        'linked_floorplan_name': str(tile.linked_floorplan) if tile.linked_floorplan else None,
        'linked_floorplan_url': (
            f'/plugins/map/floorplans/{tile.linked_floorplan_id}/visualization/'
            if tile.linked_floorplan_id else None
        ),
    }

    if tile.tile_type == 'drop':
        result['drop_port_count'] = getattr(tile, '_port_count', None) or tile.port_assignments.count()

    return result


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
        tiles = instance.tiles.select_related(
            'assigned_object_type', 'linked_floorplan'
        ).annotate(_port_count=Count('port_assignments')).all()
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
        tiles = instance.tiles.select_related(
            'assigned_object_type', 'linked_floorplan'
        ).annotate(_port_count=Count('port_assignments')).all()
        tile_data = [_serialize_tile(tile) for tile in tiles]

        site_floorplans = list(FloorPlan.objects.filter(
            site=instance.site
        ).values('id', 'name', 'location__name'))

        settings = MapSettings.load()

        popover_config = {'default': settings.popover_fields}
        popover_config.update(settings.tile_popover_config or {})

        type_configs = get_all_type_configs()

        return {
            'tile_data_json': json.dumps(tile_data),
            'grid_width': instance.grid_width,
            'grid_height': instance.grid_height,
            'tile_size': instance.tile_size,
            'site_floorplans': site_floorplans,
            'edit_mode': request.GET.get('edit', '') == 'true',
            'site_id': instance.site_id,
            'popover_fields_json': json.dumps(popover_config),
            'type_configs': type_configs,
            'type_configs_json': json.dumps(type_configs),
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


class FloorPlanTileBulkEditView(generic.BulkEditView):
    queryset = FloorPlanTile.objects.all()
    filterset = filtersets.FloorPlanTileFilterSet
    table = tables.FloorPlanTileTable
    form = forms.FloorPlanTileBulkEditForm


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


class MapMarkerBulkEditView(generic.BulkEditView):
    queryset = MapMarker.objects.all()
    filterset = filtersets.MapMarkerFilterSet
    table = tables.MapMarkerTable
    form = forms.MapMarkerBulkEditForm


class MapMarkerBulkImportView(generic.BulkImportView):
    queryset = MapMarker.objects.all()
    model_form = forms.MapMarkerImportForm


class MapMarkerBulkDeleteView(generic.BulkDeleteView):
    queryset = MapMarker.objects.all()
    filterset = filtersets.MapMarkerFilterSet
    table = tables.MapMarkerTable


#
# CablePath views
#

class CablePathListView(generic.ObjectListView):
    queryset = CablePath.objects.select_related('start_marker', 'end_marker')
    filterset = filtersets.CablePathFilterSet
    filterset_form = forms.CablePathFilterForm
    table = tables.CablePathTable


@register_model_view(CablePath)
class CablePathView(generic.ObjectView):
    queryset = CablePath.objects.select_related('start_marker', 'end_marker')


@register_model_view(CablePath, 'edit')
class CablePathEditView(generic.ObjectEditView):
    queryset = CablePath.objects.all()
    form = forms.CablePathForm


@register_model_view(CablePath, 'delete')
class CablePathDeleteView(generic.ObjectDeleteView):
    queryset = CablePath.objects.all()


class CablePathBulkEditView(generic.BulkEditView):
    queryset = CablePath.objects.all()
    filterset = filtersets.CablePathFilterSet
    table = tables.CablePathTable
    form = forms.CablePathBulkEditForm


class CablePathBulkImportView(generic.BulkImportView):
    queryset = CablePath.objects.all()
    model_form = forms.CablePathImportForm


class CablePathBulkDeleteView(generic.BulkDeleteView):
    queryset = CablePath.objects.all()
    filterset = filtersets.CablePathFilterSet
    table = tables.CablePathTable


#
# AJAX: Split Cable at Marker
#

class SplitCableView(LoginRequiredMixin, View):
    """Split a CablePath at the position of a given MapMarker."""

    def post(self, request, pk):
        import math

        try:
            cable = CablePath.objects.get(pk=pk)
        except CablePath.DoesNotExist:
            return JsonResponse({'error': 'Cable path not found'}, status=404)

        try:
            data = json.loads(request.body)
        except json.JSONDecodeError:
            return JsonResponse({'error': 'Invalid JSON'}, status=400)

        marker_id = data.get('marker_id')
        if not marker_id:
            return JsonResponse({'error': 'marker_id required'}, status=400)

        try:
            marker = MapMarker.objects.get(pk=marker_id)
        except MapMarker.DoesNotExist:
            return JsonResponse({'error': 'Marker not found'}, status=404)

        coords = cable.path_coordinates
        if len(coords) < 2:
            return JsonResponse({'error': 'Cable has fewer than 2 coordinates'}, status=400)

        mlat = float(marker.latitude)
        mlng = float(marker.longitude)

        # Find the nearest segment on the polyline
        best_dist = float('inf')
        best_seg = 0
        best_point = [mlat, mlng]

        for i in range(len(coords) - 1):
            p = self._nearest_point_on_segment(
                coords[i][0], coords[i][1],
                coords[i + 1][0], coords[i + 1][1],
                mlat, mlng
            )
            d = math.hypot(p[0] - mlat, p[1] - mlng)
            if d < best_dist:
                best_dist = d
                best_seg = i
                best_point = p

        split_point = [round(best_point[0], 6), round(best_point[1], 6)]

        # First cable: start → split point
        coords_a = coords[:best_seg + 1] + [split_point]
        # Second cable: split point → end
        coords_b = [split_point] + coords[best_seg + 1:]

        # Update original cable
        original_end = cable.end_marker
        cable.path_coordinates = coords_a
        cable.end_marker = marker
        cable.save()

        # Create new cable for the second segment
        new_cable = CablePath.objects.create(
            label=cable.label + ' (split)' if cable.label else '',
            path_coordinates=coords_b,
            fiber_count=cable.fiber_count,
            start_marker=marker,
            end_marker=original_end,
            status=cable.status,
        )

        return JsonResponse({
            'cable_a': {
                'id': cable.pk,
                'label': cable.label,
                'path_coordinates': cable.path_coordinates,
                'fiber_count': cable.fiber_count,
                'status': cable.status,
                'status_color': cable.get_status_color(),
                'color': cable.color,
                'weight': cable.weight,
                'display_color': cable.get_display_color(),
                'start_marker_id': cable.start_marker_id,
                'end_marker_id': cable.end_marker_id,
            },
            'cable_b': {
                'id': new_cable.pk,
                'label': new_cable.label,
                'path_coordinates': new_cable.path_coordinates,
                'fiber_count': new_cable.fiber_count,
                'status': new_cable.status,
                'status_color': new_cable.get_status_color(),
                'color': new_cable.color,
                'weight': new_cable.weight,
                'display_color': new_cable.get_display_color(),
                'start_marker_id': new_cable.start_marker_id,
                'end_marker_id': new_cable.end_marker_id,
            },
        })

    @staticmethod
    def _nearest_point_on_segment(ax, ay, bx, by, px, py):
        """Find the nearest point on segment AB to point P."""
        dx = bx - ax
        dy = by - ay
        if dx == 0 and dy == 0:
            return [ax, ay]
        t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)
        t = max(0, min(1, t))
        return [ax + t * dx, ay + t * dy]


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
        'rearport': ['device__site'],
        'frontport': ['device__site'],
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

        # Cable traces
        try:
            interfaces = self._get_cable_traces(obj, object_type) if object_type in ('device', 'rearport', 'frontport') else []
        except Exception:
            interfaces = []

        return JsonResponse({
            'standard_fields': standard_fields,
            'mac_address': mac_address,
            'custom_fields': custom_fields,
            'interfaces': interfaces,
        })

    def _get_cable_traces(self, obj, object_type):
        """Return cable trace data for a device or port object."""
        traces = []
        if object_type == 'device':
            from dcim.models import Interface
            interfaces = Interface.objects.filter(
                device=obj, cable__isnull=False
            ).select_related('cable')
            for iface in interfaces:
                trace_data = self._trace_port(iface)
                if trace_data:
                    traces.append({
                        'name': iface.name,
                        'type': 'Interface',
                        'trace': trace_data,
                    })
        elif object_type in ('rearport', 'frontport'):
            from dcim.models import RearPort, FrontPort
            # Build a single unified trace that shows the full path through
            # the patch panel: e.g. Server:eth0 → Cable → FrontPort →
            # RearPort → Cable → Switch:GigabitEthernet.
            own_hops = self._trace_through_panels(obj)
            peer_hops = []
            peer_name = None
            try:
                from dcim.models import PortMapping
                if object_type == 'rearport':
                    mappings = PortMapping.objects.filter(
                        rear_port=obj
                    ).select_related('front_port__cable')
                    for mapping in mappings:
                        peer = mapping.front_port
                        if peer and peer.cable:
                            peer_hops = self._trace_through_panels(peer)
                            peer_name = peer.name
                            break
                else:
                    mappings = PortMapping.objects.filter(
                        front_port=obj
                    ).select_related('rear_port__cable')
                    for mapping in mappings:
                        peer = mapping.rear_port
                        if peer and peer.cable:
                            peer_hops = self._trace_through_panels(peer)
                            peer_name = peer.name
                            break
            except Exception:
                pass

            # Combine traces into a single end-to-end path.
            if object_type == 'rearport':
                # peer = FrontPort trace (front side) — reverse it
                reversed_peer = []
                for hop in peer_hops:
                    reversed_peer.append({
                        'cable': hop['cable'],
                        'near_end': hop.get('far_end'),
                        'far_end': hop.get('near_end'),
                    })
                reversed_peer.reverse()
                combined = reversed_peer + own_hops
            else:
                # own = FrontPort trace (front side) — reverse it
                reversed_own = []
                for hop in own_hops:
                    reversed_own.append({
                        'cable': hop['cable'],
                        'near_end': hop.get('far_end'),
                        'far_end': hop.get('near_end'),
                    })
                reversed_own.reverse()
                combined = reversed_own + peer_hops

            if combined:
                traces.append({
                    'name': obj.name,
                    'type': obj.__class__.__name__,
                    'trace': combined,
                })
        return traces

    def _serialize_endpoint(self, ep):
        """Serialize a cable termination endpoint (port/interface) to dict."""
        ep_data = {
            'name': str(ep),
            'type': ep.__class__.__name__,
        }
        if hasattr(ep, 'get_absolute_url'):
            ep_data['url'] = ep.get_absolute_url()
        if hasattr(ep, 'device') and ep.device:
            dev = ep.device
            ep_data['device'] = str(dev)
            ep_data['device_id'] = dev.pk
            ep_data['device_url'] = dev.get_absolute_url()
            ep_data['device_type'] = str(dev.device_type) if hasattr(dev, 'device_type') and dev.device_type else ''
            ep_data['device_role'] = str(dev.role) if hasattr(dev, 'role') and dev.role else ''
            ep_data['device_site'] = str(dev.site) if hasattr(dev, 'site') and dev.site else ''
            if hasattr(dev, 'rack') and dev.rack:
                ep_data['device_rack'] = str(dev.rack)
                ep_data['device_rack_url'] = dev.rack.get_absolute_url()
        return ep_data

    def _serialize_cable(self, cable):
        """Serialize a Cable object to dict."""
        data = {
            'id': cable.id,
            'label': str(cable),
            'url': cable.get_absolute_url(),
            'status': cable.get_status_display() if hasattr(cable, 'get_status_display') else '',
            'status_color': cable.get_status_color() if hasattr(cable, 'get_status_color') else '',
        }
        if cable.type:
            data['type'] = cable.type
            data['type_display'] = cable.get_type_display()
        if cable.length is not None:
            data['length'] = float(cable.length)
            data['length_unit'] = cable.get_length_unit_display() if cable.length_unit else ''
        return data

    def _trace_port(self, port):
        """Call .trace() on a port/interface and serialize each hop.

        NetBox's trace() returns a list of 3-tuples:
            (near_ends_list, cables_list, far_ends_list)
        Each element is a *list* of model instances (not a single object).
        """
        import logging
        logger = logging.getLogger('netbox_map')

        try:
            trace_result = port.trace()
            if not trace_result:
                return self._direct_cable_hop(port)

            hops = []
            for near_ends, cables, far_ends in trace_result:
                if not cables:
                    continue
                cable = cables[0] if isinstance(cables, (list, tuple)) else cables
                hop = {'cable': self._serialize_cable(cable)}
                for key, ep_list in (('near_end', near_ends), ('far_end', far_ends)):
                    if not ep_list:
                        hop[key] = None
                        continue
                    ep = ep_list[0] if isinstance(ep_list, (list, tuple)) else ep_list
                    hop[key] = self._serialize_endpoint(ep)
                hops.append(hop)

            # If .trace() returned data but all hops were passthrough (no cables),
            # fall back to direct cable inspection.
            return hops if hops else self._direct_cable_hop(port)

        except Exception as e:
            logger.debug('Cable trace failed for %s (pk=%s): %s', port, getattr(port, 'pk', '?'), e)
            return self._direct_cable_hop(port)

    def _trace_through_panels(self, port):
        """Trace a port and follow through patch panel RearPort→FrontPort
        internal mappings so the full end-to-end path is returned.

        RearPort has no trace() method in NetBox, so for RearPorts we
        build a single hop from the directly attached cable.  After each
        batch of hops we check whether the trace ended at a RearPort; if
        so we look up the corresponding FrontPort via PortMapping and
        keep tracing (FrontPort *does* have trace()).
        """
        from dcim.models import PortMapping
        import logging
        logger = logging.getLogger('netbox_map')

        all_hops = []
        visited = set()
        current_port = port

        while current_port and current_port.pk not in visited:
            visited.add(current_port.pk)

            last_far_end_raw = None
            hops = []

            # Try trace() — works for FrontPort / Interface, not RearPort
            try:
                trace_result = current_port.trace()
                if trace_result:
                    for near_ends, cables, far_ends in trace_result:
                        if not cables:
                            continue
                        cable = cables[0] if isinstance(cables, (list, tuple)) else cables
                        hop = {'cable': self._serialize_cable(cable)}
                        for key, ep_list in (('near_end', near_ends), ('far_end', far_ends)):
                            if not ep_list:
                                hop[key] = None
                                continue
                            ep = ep_list[0] if isinstance(ep_list, (list, tuple)) else ep_list
                            hop[key] = self._serialize_endpoint(ep)
                            if key == 'far_end':
                                last_far_end_raw = ep
                        hops.append(hop)
            except Exception:
                pass

            # Fallback for RearPort (no trace()) — build hop from cable
            if not hops:
                cable = getattr(current_port, 'cable', None)
                if not cable:
                    break
                hop = {
                    'cable': self._serialize_cable(cable),
                    'near_end': self._serialize_endpoint(current_port),
                    'far_end': None,
                }
                link_peers = getattr(current_port, 'link_peers', None)
                if link_peers:
                    peers = list(link_peers) if not isinstance(link_peers, (list, tuple)) else link_peers
                    if peers:
                        last_far_end_raw = peers[0]
                        hop['far_end'] = self._serialize_endpoint(peers[0])
                hops.append(hop)

            all_hops.extend(hops)

            # If trace ended at a RearPort, find the corresponding
            # FrontPort via PortMapping and keep tracing from there.
            if last_far_end_raw and last_far_end_raw.__class__.__name__ == 'RearPort':
                try:
                    mapping = PortMapping.objects.filter(
                        rear_port=last_far_end_raw
                    ).first()
                    if mapping and mapping.front_port and getattr(mapping.front_port, 'cable', None):
                        current_port = mapping.front_port
                        continue
                except Exception as e:
                    logger.debug('PortMapping lookup failed: %s', e)
            break

        return all_hops

    def _direct_cable_hop(self, port):
        """Fallback: build a single hop from the port's directly attached cable."""
        try:
            cable = getattr(port, 'cable', None)
            if not cable:
                return []

            hop = {
                'cable': self._serialize_cable(cable),
                'near_end': self._serialize_endpoint(port),
                'far_end': None,
            }

            # Try to find the far-end termination via link_peers
            link_peers = getattr(port, 'link_peers', None)
            if link_peers:
                peers = list(link_peers) if not isinstance(link_peers, (list, tuple)) else link_peers
                if peers:
                    hop['far_end'] = self._serialize_endpoint(peers[0])
            else:
                # Fallback: query cable terminations directly
                from dcim.models import CableTermination
                terms = CableTermination.objects.filter(cable=cable).exclude(
                    termination_type=ContentType.objects.get_for_model(port),
                    termination_id=port.pk,
                ).select_related('termination_type')
                for term in terms:
                    far_obj = term.termination
                    if far_obj:
                        hop['far_end'] = self._serialize_endpoint(far_obj)
                        break

            return [hop]
        except Exception:
            return []

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
# AJAX Drop Detail endpoint
#

class DropDetailView(LoginRequiredMixin, View):
    """AJAX endpoint returning cable traces for all ports assigned to a drop tile."""

    def get(self, request, tile_id):
        try:
            tile = FloorPlanTile.objects.get(pk=tile_id, tile_type='drop')
        except FloorPlanTile.DoesNotExist:
            return JsonResponse({'error': 'Drop tile not found'}, status=404)

        assignments = tile.port_assignments.select_related('port_type').all()

        # Reuse MarkerDetailView's trace methods
        marker_view = MarkerDetailView()

        interfaces = []
        for assignment in assignments:
            port = assignment.port
            if port is None:
                continue
            port_type = assignment.port_type.model  # 'frontport' or 'rearport'
            try:
                traces = marker_view._get_cable_traces(port, port_type)
                for trace in traces:
                    interfaces.append(trace)
            except Exception:
                pass

        return JsonResponse({
            'standard_fields': [],
            'mac_address': None,
            'custom_fields': [],
            'interfaces': interfaces,
        })


#
# Map Settings
#

class MapSettingsView(LoginRequiredMixin, PermissionRequiredMixin, View):
    permission_required = 'netbox_map.view_floorplan'

    def _build_tile_popover_types(self):
        return [
            {
                'key': tc['slug'],
                'label': tc['name'],
                'icon': tc['icon'],
                'field_name': f'{tc["slug"]}_popover_fields',
            }
            for tc in get_all_type_configs()
        ]

    def _get_context(self, form):
        return {
            'form': form,
            'tile_popover_types': self._build_tile_popover_types(),
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
    from dcim.models import Rack as _Rack
    device_ct = ContentType.objects.get_for_model(device)
    tile_count = FloorPlanTile.objects.filter(
        assigned_object_type=device_ct,
        assigned_object_id=device.pk,
    ).count()
    if not tile_count and device.rack_id:
        rack_ct = ContentType.objects.get_for_model(_Rack)
        tile_count += FloorPlanTile.objects.filter(
            assigned_object_type=rack_ct,
            assigned_object_id=device.rack_id,
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
        from dcim.models import Rack as _Rack
        device_ct = ContentType.objects.get_for_model(Device)
        tiles = FloorPlanTile.objects.filter(
            assigned_object_type=device_ct,
            assigned_object_id=instance.pk,
        ).select_related('floorplan__site')
        markers = MapMarker.objects.filter(
            assigned_object_type=device_ct,
            assigned_object_id=instance.pk,
        ).select_related('site')
        rack_tiles = []
        if instance.rack_id:
            rack_ct = ContentType.objects.get_for_model(_Rack)
            rack_tiles = list(
                FloorPlanTile.objects.filter(
                    assigned_object_type=rack_ct,
                    assigned_object_id=instance.rack_id,
                ).select_related('floorplan__site')
            )
        return {
            'tiles': tiles,
            'markers': markers,
            'rack_tiles': rack_tiles,
            'rack': instance.rack if instance.rack_id else None,
        }
