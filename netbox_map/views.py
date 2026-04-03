import json

from django.contrib import messages
from django.contrib.auth.mixins import LoginRequiredMixin, PermissionRequiredMixin
from django.contrib.contenttypes.models import ContentType
from django.db.models import Count, Prefetch
from django.http import JsonResponse
from django.shortcuts import redirect, render
from django.utils.decorators import method_decorator
from django.utils.translation import gettext_lazy as _
from django.views import View
from django.views.decorators.csrf import ensure_csrf_cookie

from dcim.filtersets import SiteFilterSet
from dcim.models import Device, Location, Site
from netbox.views import generic
from utilities.views import ViewTab, register_model_view

from . import filtersets, forms, tables
from .choices import get_all_type_configs
from .models import (
    FloorPlan, FloorPlanTile, CustomMarkerType, LocationCoordinates, MapMarker, MapSettings, TilePortAssignment, CablePath, TopologySavedView,
    ApplicationGroup, ApplicationTemplate, Application, ApplicationDeployment, ApplicationDependency,
)


#
# Topology views
#

@method_decorator(ensure_csrf_cookie, name='dispatch')
class TopologyView(LoginRequiredMixin, View):
    """Interactive network topology visualization."""

    def get(self, request):
        filter_form = forms.TopologyFilterForm(data=request.GET or None)

        initial_filters = {}
        for key in ('site_id', 'tenant_id', 'location_id', 'rack_id', 'cable_type', 'device_ids'):
            val = request.GET.get(key)
            if val:
                initial_filters[key] = val
        # role_id supports multiple values
        role_ids = request.GET.getlist('role_id')
        if role_ids:
            initial_filters['role_id'] = role_ids

        # Load saved view if requested
        saved_view = None
        saved_view_data = '{}'
        view_id = request.GET.get('view_id')
        if view_id:
            try:
                saved_view = TopologySavedView.objects.get(pk=view_id)
                saved_view_data = json.dumps(saved_view.layout_data)
                # Use saved filters if no explicit filters provided
                if not initial_filters and saved_view.filters:
                    initial_filters = saved_view.filters
            except TopologySavedView.DoesNotExist:
                pass

        # All saved views for the dropdown
        saved_views = TopologySavedView.objects.all().order_by('name').values('pk', 'name')

        return render(request, 'netbox_map/topology.html', {
            'filter_form': filter_form,
            'initial_filters_json': json.dumps(initial_filters),
            'active_filters': bool(initial_filters),
            'saved_view': saved_view,
            'saved_view_data': saved_view_data,
            'saved_views': list(saved_views),
            'saved_views_json': json.dumps(list(saved_views)),
        })


#
# Topology saved view CRUD
#

class TopologySavedViewListView(generic.ObjectListView):
    queryset = TopologySavedView.objects.all()
    filterset = filtersets.TopologySavedViewFilterSet
    filterset_form = forms.TopologySavedViewFilterForm
    table = tables.TopologySavedViewTable


@register_model_view(TopologySavedView)
class TopologySavedViewView(generic.ObjectView):
    queryset = TopologySavedView.objects.all()


@register_model_view(TopologySavedView, 'edit')
class TopologySavedViewEditView(generic.ObjectEditView):
    queryset = TopologySavedView.objects.all()
    form = forms.TopologySavedViewForm


@register_model_view(TopologySavedView, 'delete')
class TopologySavedViewDeleteView(generic.ObjectDeleteView):
    queryset = TopologySavedView.objects.all()


class TopologySaveLayoutView(LoginRequiredMixin, View):
    """AJAX endpoint to save/create topology layout."""

    def post(self, request):
        try:
            data = json.loads(request.body)
        except json.JSONDecodeError:
            return JsonResponse({'error': 'Invalid JSON'}, status=400)

        view_id = data.get('view_id')
        layout_data = data.get('layout_data', {})
        filters = data.get('filters', {})
        view_mode = data.get('view_mode', 'stencil')
        name = data.get('name', '')

        if view_id:
            # Update existing
            try:
                view = TopologySavedView.objects.get(pk=view_id)
                view.layout_data = layout_data
                view.filters = filters
                view.view_mode = view_mode or 'stencil'
                view.save()
                return JsonResponse({'id': view.pk, 'name': view.name, 'saved': True})
            except TopologySavedView.DoesNotExist:
                return JsonResponse({'error': 'View not found'}, status=404)
        else:
            # Create new
            if not name:
                return JsonResponse({'error': 'Name is required'}, status=400)
            view = TopologySavedView.objects.create(
                name=name,
                layout_data=layout_data,
                filters=filters,
                view_mode=view_mode,
            )
            return JsonResponse({'id': view.pk, 'name': view.name, 'saved': True})


class TopologyDataView(LoginRequiredMixin, View):
    """AJAX endpoint returning topology graph data (nodes + edges).

    Returns nodes with their cabled interfaces/ports, and edges with
    port-level connection details for the stencil view.
    """

    def get(self, request):
        from dcim.models import (
            Device, Interface, Cable, FrontPort, RearPort,
            ConsolePort, ConsoleServerPort, PowerPort, PowerOutlet,
        )
        from dcim.models import CableTermination

        site_id = request.GET.get('site_id')
        tenant_id = request.GET.get('tenant_id')
        location_id = request.GET.get('location_id')
        rack_id = request.GET.get('rack_id')
        role_ids = request.GET.getlist('role_id')
        cable_type = request.GET.get('cable_type')
        device_ids_param = request.GET.get('device_ids')

        devices = Device.objects.select_related(
            'device_type__manufacturer', 'role', 'site', 'location',
            'rack', 'tenant', 'primary_ip4', 'primary_ip6',
            'virtual_chassis',
        )

        if device_ids_param:
            # Explicit device IDs — no filter required
            ids = [int(x) for x in device_ids_param.split(',') if x.strip().isdigit()]
            devices = devices.filter(pk__in=ids)
        else:
            if site_id:
                devices = devices.filter(site_id=site_id)
            if tenant_id:
                devices = devices.filter(tenant_id=tenant_id)
            if location_id:
                devices = devices.filter(location_id=location_id)
            if rack_id:
                devices = devices.filter(rack_id=rack_id)
            if role_ids:
                devices = devices.filter(role_id__in=role_ids)

            # Require at least one filter when not using device_ids
            if not any([site_id, tenant_id, location_id, rack_id, role_ids]):
                return JsonResponse({'nodes': [], 'edges': [], 'stats': {'node_count': 0, 'edge_count': 0}})

        device_map = {}
        nodes = []
        for device in devices:
            primary_ip = None
            if device.primary_ip4:
                primary_ip = str(device.primary_ip4.address.ip)
            elif device.primary_ip6:
                primary_ip = str(device.primary_ip6.address.ip)

            node = {
                'id': f'device-{device.pk}',
                'device_id': device.pk,
                'name': device.name or str(device),
                'role': device.role.name if device.role else '',
                'role_slug': device.role.slug if device.role else '',
                'role_color': f'#{device.role.color}' if device.role and device.role.color else '#6c757d',
                'device_type': str(device.device_type) if device.device_type else '',
                'manufacturer': device.device_type.manufacturer.name if device.device_type and device.device_type.manufacturer else '',
                'site': device.site.name if device.site else '',
                'location': device.location.name if device.location else '',
                'rack': device.rack.name if device.rack else '',
                'tenant': device.tenant.name if device.tenant else '',
                'status': device.get_status_display(),
                'status_value': device.status,
                'primary_ip': primary_ip,
                'url': device.get_absolute_url(),
                'interface_count': 0,
                'ports': [],
                'virtual_chassis': device.virtual_chassis.name if device.virtual_chassis else None,
            }
            device_map[device.pk] = node
            nodes.append(node)

        if not device_map:
            return JsonResponse({'nodes': [], 'edges': [], 'stats': {'node_count': 0, 'edge_count': 0}})

        device_ids = set(device_map.keys())

        # Get content types for all port models
        port_models = [Interface, FrontPort, RearPort, ConsolePort, ConsoleServerPort, PowerPort, PowerOutlet]
        port_cts = [ContentType.objects.get_for_model(m) for m in port_models]
        port_ct_map = {ct.pk: model_cls for ct, model_cls in zip(port_cts, port_models)}

        # Build port-to-device mapping AND collect port details
        port_id_map = {}       # (ct_id, port_id) -> device_id
        port_info_map = {}     # (ct_id, port_id) -> port info dict

        # Interfaces — include name, type, speed
        iface_ct = port_cts[0]
        for iface in Interface.objects.filter(device_id__in=device_ids).values(
            'id', 'device_id', 'name', 'type', 'speed', 'cable_id',
        ):
            key = (iface_ct.pk, iface['id'])
            port_id_map[key] = iface['device_id']
            port_info_map[key] = {
                'id': f"iface-{iface['id']}",
                'name': iface['name'],
                'port_class': 'interface',
                'type': iface['type'] or '',
                'speed': iface['speed'],
                'cabled': bool(iface['cable_id']),
            }

        # FrontPort / RearPort
        fp_ct, rp_ct = port_cts[1], port_cts[2]
        for fp in FrontPort.objects.filter(device_id__in=device_ids).values(
            'id', 'device_id', 'name', 'type', 'cable_id',
        ):
            key = (fp_ct.pk, fp['id'])
            port_id_map[key] = fp['device_id']
            port_info_map[key] = {
                'id': f"fp-{fp['id']}",
                'name': fp['name'],
                'port_class': 'front-port',
                'type': fp['type'] or '',
                'speed': None,
                'cabled': bool(fp['cable_id']),
            }

        for rp in RearPort.objects.filter(device_id__in=device_ids).values(
            'id', 'device_id', 'name', 'type', 'cable_id',
        ):
            key = (rp_ct.pk, rp['id'])
            port_id_map[key] = rp['device_id']
            port_info_map[key] = {
                'id': f"rp-{rp['id']}",
                'name': rp['name'],
                'port_class': 'rear-port',
                'type': rp['type'] or '',
                'speed': None,
                'cabled': bool(rp['cable_id']),
            }

        # Console/Power ports (simpler)
        for ct_idx, model_cls, prefix in [
            (3, ConsolePort, 'cp'), (4, ConsoleServerPort, 'csp'),
            (5, PowerPort, 'pp'), (6, PowerOutlet, 'po'),
        ]:
            ct = port_cts[ct_idx]
            for p in model_cls.objects.filter(device_id__in=device_ids).values(
                'id', 'device_id', 'name', 'cable_id',
            ):
                key = (ct.pk, p['id'])
                port_id_map[key] = p['device_id']
                port_info_map[key] = {
                    'id': f"{prefix}-{p['id']}",
                    'name': p['name'],
                    'port_class': prefix,
                    'type': '',
                    'speed': None,
                    'cabled': bool(p['cable_id']),
                }

        # Attach cabled ports to their device nodes (only cabled ones for stencil view)
        for key, info in port_info_map.items():
            if info['cabled']:
                dev_id = port_id_map[key]
                if dev_id in device_map:
                    device_map[dev_id]['ports'].append(info)

        # Interface counts
        iface_counts = Interface.objects.filter(
            device_id__in=device_ids,
        ).values('device_id').annotate(count=Count('id'))
        for entry in iface_counts:
            dev_id = entry['device_id']
            if dev_id in device_map:
                device_map[dev_id]['interface_count'] = entry['count']

        # Find cables via CableTermination
        cable_terminations = CableTermination.objects.filter(
            termination_type__in=port_cts,
        ).select_related('cable')

        cable_terms = {}
        cable_objects = {}
        for ct_obj in cable_terminations:
            key = (ct_obj.termination_type_id, ct_obj.termination_id)
            if key not in port_id_map:
                continue
            if ct_obj.cable_id not in cable_terms:
                cable_terms[ct_obj.cable_id] = []
                cable_objects[ct_obj.cable_id] = ct_obj.cable
            cable_terms[ct_obj.cable_id].append(key)

        edges = []
        for cable_id, terms in cable_terms.items():
            # Gather terminations that belong to devices in scope
            term_infos = []
            for ct_id, term_id in terms:
                dev_id = port_id_map.get((ct_id, term_id))
                if dev_id and dev_id in device_ids:
                    port_info = port_info_map.get((ct_id, term_id))
                    term_infos.append((dev_id, port_info))

            if len(term_infos) < 2:
                continue

            cable = cable_objects[cable_id]
            if cable_type and cable.type != cable_type:
                continue

            # Create edges between pairs of terminations on different devices
            seen_pairs = set()
            for i in range(len(term_infos)):
                for j in range(i + 1, len(term_infos)):
                    dev_a, port_a = term_infos[i]
                    dev_b, port_b = term_infos[j]
                    if dev_a == dev_b:
                        continue
                    pair_key = (min(dev_a, dev_b), max(dev_a, dev_b), cable_id)
                    if pair_key in seen_pairs:
                        continue
                    seen_pairs.add(pair_key)

                    # Ensure consistent ordering
                    if dev_a > dev_b:
                        dev_a, dev_b = dev_b, dev_a
                        port_a, port_b = port_b, port_a

                    edges.append({
                        'id': f'cable-{cable_id}',
                        'source': f'device-{dev_a}',
                        'target': f'device-{dev_b}',
                        'source_port': port_a['id'] if port_a else None,
                        'target_port': port_b['id'] if port_b else None,
                        'source_port_name': port_a['name'] if port_a else '',
                        'target_port_name': port_b['name'] if port_b else '',
                        'source_port_speed': port_a['speed'] if port_a else None,
                        'target_port_speed': port_b['speed'] if port_b else None,
                        'cable_id': cable_id,
                        'cable_label': cable.label or f'Cable #{cable_id}',
                        'cable_type': cable.get_type_display() if cable.type else '',
                        'cable_type_value': cable.type or '',
                        'color': f'#{cable.color}' if cable.color else '#6c757d',
                        'status': cable.get_status_display(),
                        'status_value': cable.status,
                        'length': str(cable.length) if cable.length else '',
                        'length_unit': cable.get_length_unit_display() if cable.length_unit else '',
                        'url': cable.get_absolute_url(),
                    })

        return JsonResponse({
            'nodes': nodes,
            'edges': edges,
            'stats': {'node_count': len(nodes), 'edge_count': len(edges)},
        })


class TopologyDeviceDetailView(LoginRequiredMixin, View):
    """AJAX endpoint returning interfaces and ports for a device."""

    def get(self, request, device_id):
        from dcim.models import Device, Interface, FrontPort, RearPort, CableTermination

        try:
            device = Device.objects.get(pk=device_id)
        except Device.DoesNotExist:
            return JsonResponse({'error': 'Device not found'}, status=404)

        interfaces = Interface.objects.filter(device=device).select_related(
            'cable', 'lag',
        ).order_by('name')

        iface_ct = ContentType.objects.get_for_model(Interface)

        result = []
        for iface in interfaces:
            iface_data = {
                'id': iface.pk,
                'name': iface.name,
                'type': iface.get_type_display(),
                'type_value': iface.type,
                'enabled': iface.enabled,
                'speed': iface.speed,
                'cable_id': iface.cable_id,
                'lag': iface.lag.name if iface.lag else None,
                'mode': iface.get_mode_display() if iface.mode else '',
                'connected_to': None,
                'url': iface.get_absolute_url(),
            }
            if iface.cable:
                iface_data['cable_color'] = f'#{iface.cable.color}' if iface.cable.color else ''
                iface_data['cable_label'] = iface.cable.label or f'Cable #{iface.cable.pk}'
                iface_data['cable_type'] = iface.cable.get_type_display() if iface.cable.type else ''

                # Find remote end via trace(), fall back to CableTermination
                connected = None
                try:
                    trace = iface.trace()
                    if trace:
                        last_hop = trace[-1]
                        far_terms = last_hop[2]
                        if far_terms:
                            far_obj = far_terms[0]
                            if hasattr(far_obj, 'device'):
                                connected = {
                                    'device': far_obj.device.name,
                                    'device_id': far_obj.device.pk,
                                    'port': far_obj.name,
                                    'port_type': type(far_obj).__name__,
                                }
                except Exception:
                    pass

                # Fallback: look up the other end via CableTermination
                if not connected:
                    try:
                        other_terms = CableTermination.objects.filter(
                            cable=iface.cable,
                        ).exclude(
                            termination_type=iface_ct,
                            termination_id=iface.pk,
                        ).select_related('termination_type')
                        for term in other_terms:
                            obj = term.termination
                            if obj and hasattr(obj, 'device'):
                                connected = {
                                    'device': obj.device.name,
                                    'device_id': obj.device.pk,
                                    'port': obj.name,
                                    'port_type': type(obj).__name__,
                                }
                                break
                    except Exception:
                        pass

                iface_data['connected_to'] = connected
            result.append(iface_data)

        ports = []
        for port in FrontPort.objects.filter(device=device).select_related('cable').order_by('name'):
            port_data = {
                'id': port.pk,
                'name': port.name,
                'port_type': 'Front Port',
                'type': port.get_type_display(),
                'cable_id': port.cable_id,
                'url': port.get_absolute_url(),
            }
            if port.cable:
                port_data['cable_color'] = f'#{port.cable.color}' if port.cable.color else ''
            ports.append(port_data)

        for port in RearPort.objects.filter(device=device).select_related('cable').order_by('name'):
            port_data = {
                'id': port.pk,
                'name': port.name,
                'port_type': 'Rear Port',
                'type': port.get_type_display(),
                'cable_id': port.cable_id,
                'url': port.get_absolute_url(),
            }
            if port.cable:
                port_data['cable_color'] = f'#{port.cable.color}' if port.cable.color else ''
            ports.append(port_data)

        return JsonResponse({
            'interfaces': result,
            'ports': ports,
            'device_name': device.name,
            'device_url': device.get_absolute_url(),
        })


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
# LocationCoordinates views
#

class LocationCoordinatesRedirectView(LoginRequiredMixin, View):
    """Redirect to the parent Location's detail page."""

    def get(self, request, pk):
        from .models import LocationCoordinates as LC
        try:
            lc = LC.objects.select_related('location').get(pk=pk)
        except LC.DoesNotExist:
            from django.http import Http404
            raise Http404
        return redirect(lc.location.get_absolute_url())


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
# ApplicationGroup views
#

class ApplicationGroupListView(generic.ObjectListView):
    queryset = ApplicationGroup.objects.all()
    filterset = filtersets.ApplicationGroupFilterSet
    filterset_form = forms.ApplicationGroupFilterForm
    table = tables.ApplicationGroupTable


@register_model_view(ApplicationGroup)
class ApplicationGroupView(generic.ObjectView):
    queryset = ApplicationGroup.objects.all()


@register_model_view(ApplicationGroup, 'edit')
class ApplicationGroupEditView(generic.ObjectEditView):
    queryset = ApplicationGroup.objects.all()
    form = forms.ApplicationGroupForm


@register_model_view(ApplicationGroup, 'delete')
class ApplicationGroupDeleteView(generic.ObjectDeleteView):
    queryset = ApplicationGroup.objects.all()


class ApplicationGroupBulkEditView(generic.BulkEditView):
    queryset = ApplicationGroup.objects.all()
    filterset = filtersets.ApplicationGroupFilterSet
    table = tables.ApplicationGroupTable
    form = forms.ApplicationGroupFilterForm


class ApplicationGroupBulkDeleteView(generic.BulkDeleteView):
    queryset = ApplicationGroup.objects.all()
    filterset = filtersets.ApplicationGroupFilterSet
    table = tables.ApplicationGroupTable


#
# ApplicationTemplate views
#

class ApplicationTemplateListView(generic.ObjectListView):
    queryset = ApplicationTemplate.objects.select_related('group')
    filterset = filtersets.ApplicationTemplateFilterSet
    filterset_form = forms.ApplicationTemplateFilterForm
    table = tables.ApplicationTemplateTable


@register_model_view(ApplicationTemplate)
class ApplicationTemplateView(generic.ObjectView):
    queryset = ApplicationTemplate.objects.select_related('group')


@register_model_view(ApplicationTemplate, 'edit')
class ApplicationTemplateEditView(generic.ObjectEditView):
    queryset = ApplicationTemplate.objects.all()
    form = forms.ApplicationTemplateForm


@register_model_view(ApplicationTemplate, 'delete')
class ApplicationTemplateDeleteView(generic.ObjectDeleteView):
    queryset = ApplicationTemplate.objects.all()


class ApplicationTemplateBulkDeleteView(generic.BulkDeleteView):
    queryset = ApplicationTemplate.objects.all()
    filterset = filtersets.ApplicationTemplateFilterSet
    table = tables.ApplicationTemplateTable


class ApplicationTemplateDeployView(LoginRequiredMixin, PermissionRequiredMixin, View):
    """Deploy a template to multiple hosts — creates an Application per host."""
    permission_required = 'netbox_map.add_applicationdeployment'

    def _get_template(self, request, pk):
        from django.shortcuts import get_object_or_404
        return get_object_or_404(ApplicationTemplate, pk=pk)

    def get(self, request, pk):
        template = self._get_template(request, pk)
        form = forms.ApplicationTemplateDeployForm()
        return render(request, 'netbox_map/applicationtemplate_deploy.html', {
            'object': template,
            'form': form,
        })

    def post(self, request, pk):
        template = self._get_template(request, pk)
        form = forms.ApplicationTemplateDeployForm(request.POST)

        if form.is_valid():
            created = 0
            device_ct = ContentType.objects.get_for_model(Device)

            hosts = []
            for device in form.cleaned_data.get('devices', []):
                hosts.append((device_ct, device))

            vms = form.cleaned_data.get('virtual_machines', [])
            if vms:
                from virtualization.models import VirtualMachine
                vm_ct = ContentType.objects.get_for_model(VirtualMachine)
                for vm in vms:
                    hosts.append((vm_ct, vm))

            for ct, host in hosts:
                host_name = host.name or str(host)
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
                ApplicationDeployment.objects.create(
                    application=app,
                    host_type=ct,
                    host_id=host.pk,
                    role=template.default_role,
                    port=template.default_port,
                    protocol=template.default_protocol or '',
                )
                created += 1

            messages.success(request, f'Deployed "{template.name}" to {created} host(s).')
            return redirect(template.get_absolute_url())

        return render(request, 'netbox_map/applicationtemplate_deploy.html', {
            'object': template,
            'form': form,
        })


#
# Application views
#

class ApplicationListView(generic.ObjectListView):
    queryset = Application.objects.select_related('group', 'site', 'tenant')
    filterset = filtersets.ApplicationFilterSet
    filterset_form = forms.ApplicationFilterForm
    table = tables.ApplicationTable


@register_model_view(Application)
class ApplicationView(generic.ObjectView):
    queryset = Application.objects.select_related('group', 'site', 'tenant')


@register_model_view(Application, 'edit')
class ApplicationEditView(generic.ObjectEditView):
    queryset = Application.objects.all()
    form = forms.ApplicationForm


@register_model_view(Application, 'delete')
class ApplicationDeleteView(generic.ObjectDeleteView):
    queryset = Application.objects.all()


class ApplicationBulkEditView(generic.BulkEditView):
    queryset = Application.objects.all()
    filterset = filtersets.ApplicationFilterSet
    table = tables.ApplicationTable
    form = forms.ApplicationBulkEditForm


class ApplicationBulkImportView(generic.BulkImportView):
    queryset = Application.objects.all()
    model_form = forms.ApplicationImportForm


class ApplicationBulkDeleteView(generic.BulkDeleteView):
    queryset = Application.objects.all()
    filterset = filtersets.ApplicationFilterSet
    table = tables.ApplicationTable


#
# Application Bulk Deploy
#

class ApplicationBulkDeployView(LoginRequiredMixin, PermissionRequiredMixin, View):
    """Deploy an application to multiple devices/VMs at once."""
    permission_required = 'netbox_map.add_applicationdeployment'

    def _get_application(self, request, pk):
        from django.shortcuts import get_object_or_404
        return get_object_or_404(Application.objects.restrict(request.user, 'view'), pk=pk)

    def get(self, request, pk):
        application = self._get_application(request, pk)
        form = forms.ApplicationBulkDeployForm()
        return render(request, 'netbox_map/application_bulk_deploy.html', {
            'object': application,
            'form': form,
        })

    def _create_instance(self, template_app, host_name, name_format):
        """Create a new Application instance copied from the template."""
        name = name_format.replace('{app}', template_app.name).replace('{host}', host_name)
        app = Application(
            name=name,
            status=template_app.status,
            criticality=template_app.criticality,
            environment=template_app.environment,
            version=template_app.version,
            description=template_app.description,
            group=template_app.group,
            tenant=template_app.tenant,
            site=template_app.site,
        )
        app.save()
        # Copy tags
        app.tags.set(template_app.tags.all())
        return app

    def post(self, request, pk):
        application = self._get_application(request, pk)
        form = forms.ApplicationBulkDeployForm(request.POST)

        if form.is_valid():
            mode = form.cleaned_data['mode']
            role = form.cleaned_data['role']
            port = form.cleaned_data.get('port')
            protocol = form.cleaned_data.get('protocol', '')
            name_format = form.cleaned_data.get('name_format', '{app}') or '{app}'
            created = 0

            # Collect all hosts: (content_type, host_obj) pairs
            hosts = []
            device_ct = ContentType.objects.get_for_model(Device)
            for device in form.cleaned_data.get('devices', []):
                hosts.append((device_ct, device))

            vms = form.cleaned_data.get('virtual_machines', [])
            if vms:
                from virtualization.models import VirtualMachine
                vm_ct = ContentType.objects.get_for_model(VirtualMachine)
                for vm in vms:
                    hosts.append((vm_ct, vm))

            if mode == 'instances':
                # Create a SEPARATE Application per host (template/instance pattern)
                for ct, host in hosts:
                    host_name = host.name or str(host)
                    app_instance = self._create_instance(application, host_name, name_format)
                    ApplicationDeployment.objects.create(
                        application=app_instance,
                        host_type=ct,
                        host_id=host.pk,
                        role=role,
                        port=port,
                        protocol=protocol,
                    )
                    created += 1
                messages.success(request, f'Created {created} instance(s) of "{application.name}".')
            else:
                # Shared mode: ONE application, multiple deployments
                for ct, host in hosts:
                    _, was_created = ApplicationDeployment.objects.get_or_create(
                        application=application,
                        host_type=ct,
                        host_id=host.pk,
                        defaults={'role': role, 'port': port, 'protocol': protocol},
                    )
                    if was_created:
                        created += 1
                messages.success(request, f'Deployed "{application.name}" to {created} host(s).')

            return redirect(application.get_absolute_url())

        return render(request, 'netbox_map/application_bulk_deploy.html', {
            'object': application,
            'form': form,
        })


#
# ApplicationDeployment views
#

class ApplicationDeploymentListView(generic.ObjectListView):
    queryset = ApplicationDeployment.objects.select_related('application', 'host_type')
    filterset = filtersets.ApplicationDeploymentFilterSet
    filterset_form = forms.ApplicationDeploymentFilterForm
    table = tables.ApplicationDeploymentTable


@register_model_view(ApplicationDeployment)
class ApplicationDeploymentView(generic.ObjectView):
    queryset = ApplicationDeployment.objects.select_related('application', 'host_type')


@register_model_view(ApplicationDeployment, 'edit')
class ApplicationDeploymentEditView(generic.ObjectEditView):
    queryset = ApplicationDeployment.objects.all()
    form = forms.ApplicationDeploymentForm


@register_model_view(ApplicationDeployment, 'delete')
class ApplicationDeploymentDeleteView(generic.ObjectDeleteView):
    queryset = ApplicationDeployment.objects.all()


class ApplicationDeploymentBulkDeleteView(generic.BulkDeleteView):
    queryset = ApplicationDeployment.objects.all()
    filterset = filtersets.ApplicationDeploymentFilterSet
    table = tables.ApplicationDeploymentTable


#
# ApplicationDependency views
#

class ApplicationDependencyListView(generic.ObjectListView):
    queryset = ApplicationDependency.objects.select_related('source_application', 'target_application')
    filterset = filtersets.ApplicationDependencyFilterSet
    filterset_form = forms.ApplicationDependencyFilterForm
    table = tables.ApplicationDependencyTable


@register_model_view(ApplicationDependency)
class ApplicationDependencyView(generic.ObjectView):
    queryset = ApplicationDependency.objects.select_related('source_application', 'target_application')


@register_model_view(ApplicationDependency, 'edit')
class ApplicationDependencyEditView(generic.ObjectEditView):
    queryset = ApplicationDependency.objects.all()
    form = forms.ApplicationDependencyForm


@register_model_view(ApplicationDependency, 'delete')
class ApplicationDependencyDeleteView(generic.ObjectDeleteView):
    queryset = ApplicationDependency.objects.all()


class ApplicationDependencyBulkEditView(generic.BulkEditView):
    queryset = ApplicationDependency.objects.all()
    filterset = filtersets.ApplicationDependencyFilterSet
    table = tables.ApplicationDependencyTable
    form = forms.ApplicationDependencyBulkEditForm


class ApplicationDependencyBulkImportView(generic.BulkImportView):
    queryset = ApplicationDependency.objects.all()
    model_form = forms.ApplicationDependencyForm


class ApplicationDependencyBulkDeleteView(generic.BulkDeleteView):
    queryset = ApplicationDependency.objects.all()
    filterset = filtersets.ApplicationDependencyFilterSet
    table = tables.ApplicationDependencyTable


#
# App Topology Data Views
#

class AppTopologyDataView(LoginRequiredMixin, View):
    """AJAX endpoint returning application topology graph data (nodes + edges)."""

    CRITICALITY_COLORS = {
        'critical': '#e74c3c',
        'high': '#e67e22',
        'medium': '#f39c12',
        'low': '#3498db',
    }

    def get(self, request):
        environments = request.GET.getlist('environment')
        criticalities = request.GET.getlist('criticality')
        statuses = request.GET.getlist('status')
        tenant_id = request.GET.get('tenant_id')
        site_id = request.GET.get('site_id')
        group_id = request.GET.get('group_id')
        app_ids_param = request.GET.get('app_ids')
        tags = request.GET.getlist('tag')

        apps = Application.objects.select_related('group', 'tenant', 'site').annotate(
            deploy_count=Count('deployments', distinct=True),
            dep_out_count=Count('dependencies', distinct=True),
            dep_in_count=Count('dependents', distinct=True),
        )

        if app_ids_param:
            ids = [int(x) for x in app_ids_param.split(',') if x.strip().isdigit()]
            apps = apps.filter(pk__in=ids)
        else:
            if environments:
                apps = apps.filter(environment__in=environments)
            if criticalities:
                apps = apps.filter(criticality__in=criticalities)
            if statuses:
                apps = apps.filter(status__in=statuses)
            if tenant_id:
                apps = apps.filter(tenant_id=tenant_id)
            if site_id:
                apps = apps.filter(site_id=site_id)
            if group_id:
                apps = apps.filter(group_id=group_id)
            if tags:
                apps = apps.filter(tags__slug__in=tags).distinct()

            # Require at least one filter when not using app_ids
            if not any([environments, criticalities, statuses, tenant_id, site_id, group_id, tags]):
                # Return all apps if no filter (app topology is typically smaller than device topology)
                pass

        app_map = {}
        nodes = []
        for app in apps:
            crit_color = self.CRITICALITY_COLORS.get(app.criticality, '#6c757d')
            group_color = app.group.color if app.group else '#6c757d'

            node = {
                'id': f'app-{app.pk}',
                'app_id': app.pk,
                'node_type': 'application',
                'name': app.name,
                'category': app.get_environment_display(),
                'category_color': group_color,
                'role_color': group_color,
                'status': app.get_status_display(),
                'status_value': app.status,
                'criticality': app.criticality,
                'criticality_color': crit_color,
                'environment': app.get_environment_display(),
                'environment_value': app.environment,
                'version': app.version,
                'owner': app.tenant.name if app.tenant else '',
                'group': app.group.name if app.group else '',
                'site': app.site.name if app.site else '',
                'description': app.description,
                'url': app.get_absolute_url(),
                'ports': [],
                'deploy_count': app.deploy_count,
                'dependency_count': app.dep_out_count + app.dep_in_count,
            }
            app_map[app.pk] = node
            nodes.append(node)

        if not app_map:
            return JsonResponse({'nodes': [], 'edges': [], 'stats': {'node_count': 0, 'edge_count': 0}})

        app_ids = set(app_map.keys())

        # Get dependencies where both source and target are in scope
        deps = ApplicationDependency.objects.filter(
            source_application_id__in=app_ids,
            target_application_id__in=app_ids,
        ).select_related('source_application', 'target_application')

        # Build "service ports" on each app from its dependencies
        # Split into DEPENDS ON (outgoing) and NEEDED BY (incoming) sections
        app_ports = {}  # app_pk -> [port_dicts]
        for app_pk in app_ids:
            app_ports[app_pk] = []

        edges = []
        for dep in deps:
            crit = dep.source_application.criticality
            crit_color = self.CRITICALITY_COLORS.get(crit, '#6c757d')

            proto_display = dep.get_protocol_display() if dep.protocol else ''
            port_str = f':{dep.port}' if dep.port else ''
            label = f'{proto_display}{port_str}' if proto_display else ''

            # Port on SOURCE app (outgoing — "DEPENDS ON" section)
            src_port_id = f'dep-out-{dep.pk}'
            target_name = dep.target_application.name
            app_ports[dep.source_application_id].append({
                'id': src_port_id,
                'name': target_name,
                'port_class': 'dep-outgoing',
                'type': label,
                'speed': None,
                'cabled': True,
            })

            # Port on TARGET app (incoming — "NEEDED BY" section)
            tgt_port_id = f'dep-in-{dep.pk}'
            source_name = dep.source_application.name
            app_ports[dep.target_application_id].append({
                'id': tgt_port_id,
                'name': source_name,
                'port_class': 'dep-incoming',
                'type': label,
                'speed': None,
                'cabled': True,
            })

            edges.append({
                'id': f'dep-{dep.pk}',
                'edge_type': 'dependency',
                'source': f'app-{dep.source_application_id}',
                'target': f'app-{dep.target_application_id}',
                'source_port': src_port_id,
                'target_port': tgt_port_id,
                'source_port_name': target_name,
                'target_port_name': source_name,
                'directed': True,
                'dependency_type': dep.dependency_type,
                'color': crit_color,
                'cable_type': label,
                'cable_label': label or dep.dependency_type,
                'cable_id': f'd{dep.pk}',
                'status': dep.get_status_display(),
                'status_value': dep.status,
            })

        # Build port list with section header rows
        for app_pk, ports in app_ports.items():
            outgoing = [p for p in ports if p['port_class'] == 'dep-outgoing']
            incoming = [p for p in ports if p['port_class'] == 'dep-incoming']
            sorted_ports = []
            if outgoing:
                sorted_ports.append({
                    'id': f'hdr-out-{app_pk}',
                    'name': 'DEPENDS ON',
                    'port_class': 'section-header',
                    'type': '', 'speed': None, 'cabled': False,
                })
                sorted_ports.extend(outgoing)
            if incoming:
                sorted_ports.append({
                    'id': f'hdr-in-{app_pk}',
                    'name': 'NEEDED BY',
                    'port_class': 'section-header',
                    'type': '', 'speed': None, 'cabled': False,
                })
                sorted_ports.extend(incoming)
            if app_pk in app_map:
                app_map[app_pk]['ports'] = sorted_ports
                app_map[app_pk]['outgoing_count'] = len(outgoing)
                app_map[app_pk]['incoming_count'] = len(incoming)

        # Also include devices that apps are deployed on + deployed-on edges
        deployments = ApplicationDeployment.objects.filter(
            application_id__in=app_ids,
        ).select_related('host_type')

        device_ct = ContentType.objects.get_for_model(Device)
        device_ids = set()
        for dep in deployments:
            if dep.host_type_id == device_ct.pk:
                device_ids.add(dep.host_id)

        # Add device nodes
        if device_ids:
            devices = Device.objects.filter(pk__in=device_ids).select_related(
                'device_type__manufacturer', 'role', 'site', 'rack',
            )
            for device in devices:
                device_node = {
                    'id': f'device-{device.pk}',
                    'device_id': device.pk,
                    'node_type': 'device',
                    'name': device.name or str(device),
                    'role': device.role.name if device.role else '',
                    'role_slug': device.role.slug if device.role else '',
                    'role_color': f'#{device.role.color}' if device.role and device.role.color else '#6c757d',
                    'device_type': str(device.device_type) if device.device_type else '',
                    'status': device.get_status_display(),
                    'status_value': device.status,
                    'site': device.site.name if device.site else '',
                    'rack': device.rack.name if device.rack else '',
                    'url': device.get_absolute_url(),
                    'ports': [],
                    'interface_count': 0,
                }
                nodes.append(device_node)

        # ── Role-aware status propagation ──
        # Statuses: 'down' (all hosts dead), 'degraded' (primary down but standby exists),
        #           'healthy' (all hosts up)
        DOWN_STATUSES = {'offline', 'failed', 'decommissioning'}
        FAILOVER_ROLES = {'standby', 'replica'}

        if device_ids:
            down_devices = {}  # device_id -> device_name
            for node in nodes:
                if node.get('node_type') == 'device' and node.get('status_value') in DOWN_STATUSES:
                    down_devices[node['device_id']] = node['name']

            if down_devices:
                # Step 1: Classify each app's health based on host roles
                # Build per-app deployment map: app_pk -> [(device_id, role)]
                app_hosts = {}
                for dep in deployments:
                    if dep.host_type_id == device_ct.pk:
                        app_hosts.setdefault(dep.application_id, []).append(
                            (dep.host_id, dep.role)
                        )

                for app_pk, host_list in app_hosts.items():
                    app_node = app_map.get(app_pk)
                    if not app_node:
                        continue

                    primaries = [(did, r) for did, r in host_list if r not in FAILOVER_ROLES]
                    failovers = [(did, r) for did, r in host_list if r in FAILOVER_ROLES]
                    down_primary_names = [down_devices[did] for did, r in primaries if did in down_devices]
                    down_failover_names = [down_devices[did] for did, r in failovers if did in down_devices]

                    if not down_primary_names and not down_failover_names:
                        continue  # all hosts up

                    all_primaries_down = len(down_primary_names) == len(primaries) if primaries else True
                    all_failovers_down = len(down_failover_names) == len(failovers) if failovers else True
                    has_live_failover = failovers and not all_failovers_down

                    reasons = down_primary_names + down_failover_names

                    if all_primaries_down and all_failovers_down:
                        app_node['host_status'] = 'down'
                        app_node['host_down'] = True
                    elif all_primaries_down and has_live_failover:
                        app_node['host_status'] = 'degraded'
                        app_node['host_down'] = False
                    elif down_primary_names:
                        app_node['host_status'] = 'degraded'
                        app_node['host_down'] = False
                    else:
                        app_node['host_status'] = 'degraded'
                        app_node['host_down'] = False

                    app_node['host_down_reasons'] = reasons

                # Step 2: Cascade through dependency chain (BFS)
                # Edge convention: source DEPENDS ON target
                # Build reverse adjacency with dep type: target_pk -> [(source_pk, dep_type)]
                reverse_deps = {}
                for d in deps:
                    reverse_deps.setdefault(d.target_application_id, []).append(
                        (d.source_application_id, d.dependency_type)
                    )

                # BFS cascade with cycle safety and status escalation
                from collections import deque
                queue = deque()
                for pk_seed, node_seed in app_map.items():
                    if node_seed.get('host_status') in ('down', 'degraded'):
                        queue.append(pk_seed)

                max_iterations = len(app_map) * 3  # cycle safety
                iterations = 0
                while queue and iterations < max_iterations:
                    iterations += 1
                    current_pk = queue.popleft()
                    current_node = app_map.get(current_pk)
                    if not current_node:
                        continue
                    current_status = current_node.get('host_status', 'healthy')
                    if current_status == 'healthy':
                        continue
                    reason = current_node['name']

                    for dependent_pk, dep_type in reverse_deps.get(current_pk, []):
                        dep_node = app_map.get(dependent_pk)
                        if not dep_node:
                            continue

                        # Determine propagated status
                        new_status = 'down' if (current_status == 'down' and dep_type == 'hard') else 'degraded'

                        existing = dep_node.get('host_status', 'healthy')
                        escalated = False

                        # Only escalate, never downgrade
                        # IMPORTANT: host_down stays unchanged — it tracks OWN host state only
                        # dep_down_reasons tracks cascaded dependency failures separately
                        if existing == 'down':
                            pass  # already worst
                        elif new_status == 'down':
                            dep_node['host_status'] = 'down'
                            escalated = True
                        elif existing == 'healthy':
                            dep_node['host_status'] = 'degraded'
                            escalated = True

                        # Track dependency reasons separately from host reasons
                        if 'dep_down_reasons' not in dep_node:
                            dep_node['dep_down_reasons'] = []
                        if reason not in dep_node['dep_down_reasons']:
                            dep_node['dep_down_reasons'].append(reason)

                        # Re-enqueue if status was escalated (handles cycles correctly)
                        if escalated:
                            queue.append(dependent_pk)

        # Add deployed-on edges
        for dep in deployments:
            if dep.host_type_id == device_ct.pk and dep.host_id in device_ids:
                edges.append({
                    'id': f'deploy-{dep.pk}',
                    'edge_type': 'deployed_on',
                    'source': f'app-{dep.application_id}',
                    'target': f'device-{dep.host_id}',
                    'directed': False,
                    'color': '#5a6080',
                    'label': dep.get_role_display(),
                    'cable_type': f'{dep.get_role_display()} :{dep.port}' if dep.port else dep.get_role_display(),
                })

        # Count affected apps (no DB writes in GET — notifications handled separately)
        down_apps = [n for n in nodes if n.get('node_type') == 'application' and n.get('host_status') == 'down']
        degraded_apps = [n for n in nodes if n.get('node_type') == 'application' and n.get('host_status') == 'degraded']

        return JsonResponse({
            'nodes': nodes,
            'edges': edges,
            'stats': {
                'node_count': len(nodes),
                'edge_count': len(edges),
                'down_count': len(down_apps),
                'degraded_count': len(degraded_apps),
            },
        })


class AppTopologyDetailView(LoginRequiredMixin, View):
    """AJAX endpoint returning dependency details for an application."""

    def get(self, request, app_id):
        try:
            app = Application.objects.select_related('group', 'tenant', 'site').get(pk=app_id)
        except Application.DoesNotExist:
            return JsonResponse({'error': 'Application not found'}, status=404)

        # Upstream: what this app depends on
        upstream = []
        for dep in ApplicationDependency.objects.filter(
            source_application=app,
        ).select_related('target_application'):
            upstream.append({
                'id': dep.pk,
                'app_id': dep.target_application.pk,
                'app_name': dep.target_application.name,
                'dependency_type': dep.dependency_type,
                'protocol': dep.get_protocol_display() if dep.protocol else '',
                'port': dep.port,
                'status': dep.get_status_display(),
            })

        # Downstream: what depends on this app
        downstream = []
        for dep in ApplicationDependency.objects.filter(
            target_application=app,
        ).select_related('source_application'):
            downstream.append({
                'id': dep.pk,
                'app_id': dep.source_application.pk,
                'app_name': dep.source_application.name,
                'dependency_type': dep.dependency_type,
                'protocol': dep.get_protocol_display() if dep.protocol else '',
                'port': dep.port,
                'status': dep.get_status_display(),
            })

        # Deployments — batch-fetch hosts to avoid N+1
        deploy_qs = list(ApplicationDeployment.objects.filter(
            application=app,
        ).select_related('host_type'))

        # Group by content type, batch-fetch host objects
        device_ct = ContentType.objects.get_for_model(Device)
        device_deploy_ids = [d.host_id for d in deploy_qs if d.host_type_id == device_ct.pk]
        device_map = {}
        if device_deploy_ids:
            device_map = Device.objects.in_bulk(device_deploy_ids)

        vm_map = {}
        try:
            from virtualization.models import VirtualMachine
            vm_ct = ContentType.objects.get_for_model(VirtualMachine)
            vm_deploy_ids = [d.host_id for d in deploy_qs if d.host_type_id == vm_ct.pk]
            if vm_deploy_ids:
                vm_map = VirtualMachine.objects.in_bulk(vm_deploy_ids)
        except ImportError:
            pass

        deployments = []
        for deploy in deploy_qs:
            if deploy.host_type_id == device_ct.pk:
                host_obj = device_map.get(deploy.host_id)
            else:
                host_obj = vm_map.get(deploy.host_id)
            host_status = host_obj.status if host_obj and hasattr(host_obj, 'status') else 'unknown'
            deployments.append({
                'id': deploy.pk,
                'host_name': str(host_obj) if host_obj else 'Unknown',
                'host_type': deploy.host_type.model if deploy.host_type else '',
                'role': deploy.get_role_display(),
                'role_value': deploy.role,
                'port': deploy.port,
                'protocol': deploy.protocol,
                'host_status': host_status,
            })

        return JsonResponse({
            'app_name': app.name,
            'app_url': app.get_absolute_url(),
            'site': app.site.name if app.site else '',
            'group': app.group.name if app.group else '',
            'environment': app.get_environment_display(),
            'upstream': upstream,
            'downstream': downstream,
            'deployments': deployments,
        })


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


#
# Device / VM Applications Tab
#

def _count_device_apps(device):
    device_ct = ContentType.objects.get_for_model(Device)
    return ApplicationDeployment.objects.filter(
        host_type=device_ct, host_id=device.pk,
    ).count()


@register_model_view(Device, 'applications', path='applications')
class DeviceApplicationsTabView(generic.ObjectChildrenView):
    queryset = Device.objects.all()
    child_model = ApplicationDeployment
    table = tables.ApplicationDeploymentTable
    template_name = 'netbox_map/device_applications_tab.html'
    tab = ViewTab(
        label=_('Applications'),
        badge=lambda obj: _count_device_apps(obj),
        permission='netbox_map.view_applicationdeployment',
        hide_if_empty=True,
    )

    def get_children(self, request, parent):
        device_ct = ContentType.objects.get_for_model(Device)
        return ApplicationDeployment.objects.filter(
            host_type=device_ct, host_id=parent.pk,
        ).select_related('application')

    def get_extra_context(self, request, instance):
        from django.urls import reverse
        device_ct = ContentType.objects.get_for_model(Device)
        add_url = reverse('plugins:netbox_map:applicationdeployment_add')
        add_url += f'?host_type={device_ct.pk}&device={instance.pk}'
        return {'add_deployment_url': add_url}


def _count_vm_apps(vm):
    from virtualization.models import VirtualMachine
    vm_ct = ContentType.objects.get_for_model(VirtualMachine)
    return ApplicationDeployment.objects.filter(
        host_type=vm_ct, host_id=vm.pk,
    ).count()


try:
    from virtualization.models import VirtualMachine

    @register_model_view(VirtualMachine, 'applications', path='applications')
    class VMApplicationsTabView(generic.ObjectChildrenView):
        queryset = VirtualMachine.objects.all()
        child_model = ApplicationDeployment
        table = tables.ApplicationDeploymentTable
        template_name = 'netbox_map/device_applications_tab.html'
        tab = ViewTab(
            label=_('Applications'),
            badge=lambda obj: _count_vm_apps(obj),
            permission='netbox_map.view_applicationdeployment',
            hide_if_empty=True,
        )

        def get_children(self, request, parent):
            vm_ct = ContentType.objects.get_for_model(VirtualMachine)
            return ApplicationDeployment.objects.filter(
                host_type=vm_ct, host_id=parent.pk,
            ).select_related('application')

        def get_extra_context(self, request, instance):
            from django.urls import reverse
            vm_ct = ContentType.objects.get_for_model(VirtualMachine)
            add_url = reverse('plugins:netbox_map:applicationdeployment_add')
            add_url += f'?host_type={vm_ct.pk}&virtual_machine={instance.pk}'
            return {'add_deployment_url': add_url}
except ImportError:
    pass
