import json

from django.contrib.auth.mixins import LoginRequiredMixin
from django.db.models import Count, Prefetch
from django.shortcuts import render
from django.utils.translation import gettext_lazy as _
from django.views import View

from netbox.views import generic
from utilities.views import ViewTab, register_model_view
from dcim.models import Location, Site
from . import filtersets, forms, tables
from .models import FloorPlan, FloorPlanTile, LocationCoordinates, MapMarker


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

        return render(request, 'netbox_map/site_map.html', {
            'placed_sites_json': json.dumps(placed_sites),
            'unplaced_sites_json': json.dumps(unplaced_sites),
            'locations_json': json.dumps(locations_data),
            'unplaced_locations_json': json.dumps(unplaced_locations),
            'tiles_json': json.dumps(tiles_data),
            'unplaced_tiles_json': json.dumps(unplaced_tiles),
            'markers_json': json.dumps(markers_data),
            'can_edit': can_edit,
        })


def _serialize_tile(tile):
    """Serialize a tile for JSON consumption by the JavaScript viewer."""
    primary_ip = None
    if (tile.assigned_object_type and
            tile.assigned_object_type.model == 'device' and
            tile.assigned_object):
        try:
            ip_obj = tile.assigned_object.primary_ip
            if ip_obj:
                primary_ip = str(ip_obj.address.ip)
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

        return {
            'tile_data_json': json.dumps(tile_data),
            'grid_width': instance.grid_width,
            'grid_height': instance.grid_height,
            'tile_size': instance.tile_size,
            'site_floorplans': site_floorplans,
            'edit_mode': request.GET.get('edit', '') == 'true',
            'site_id': instance.site_id,
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


class MapMarkerBulkDeleteView(generic.BulkDeleteView):
    queryset = MapMarker.objects.all()
    filterset = filtersets.MapMarkerFilterSet
    table = tables.MapMarkerTable
