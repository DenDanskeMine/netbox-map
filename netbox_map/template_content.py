from django.contrib.contenttypes.models import ContentType

from dcim.models import Rack
from netbox.plugins import PluginTemplateExtension
from .models import FloorPlan, FloorPlanTile


class SiteFloorPlanLink(PluginTemplateExtension):
    models = ['dcim.site']

    def right_page(self):
        obj = self.context['object']
        floorplans = FloorPlan.objects.filter(site=obj)
        if not floorplans.exists():
            return ''
        return self.render(
            'netbox_map/inc/site_floorplan_panel.html',
            extra_context={'floorplans': floorplans}
        )


class DeviceFloorPlanLink(PluginTemplateExtension):
    models = ['dcim.device']

    def right_page(self):
        device = self.context['object']
        device_ct = ContentType.objects.get_for_model(device)
        tile = (
            FloorPlanTile.objects
            .filter(assigned_object_type=device_ct, assigned_object_id=device.pk)
            .select_related('floorplan__site')
            .first()
        )
        via_rack = False
        if not tile and device.rack_id:
            rack_ct = ContentType.objects.get_for_model(Rack)
            tile = (
                FloorPlanTile.objects
                .filter(assigned_object_type=rack_ct, assigned_object_id=device.rack_id)
                .select_related('floorplan__site')
                .first()
            )
            via_rack = bool(tile)
        if not tile:
            return ''
        return self.render(
            'netbox_map/inc/device_floorplan_panel.html',
            extra_context={
                'tile': tile,
                'floorplan': tile.floorplan,
                'via_rack': via_rack,
                'rack': device.rack if via_rack else None,
            }
        )


class DeviceApplicationPanel(PluginTemplateExtension):
    models = ['dcim.device']

    def right_page(self):
        device = self.context['object']
        device_ct = ContentType.objects.get_for_model(device)
        from .models import ApplicationDeployment
        from django.urls import reverse
        deployments = list(
            ApplicationDeployment.objects
            .filter(host_type=device_ct, host_id=device.pk)
            .select_related('application')[:5]
        )
        total = ApplicationDeployment.objects.filter(
            host_type=device_ct, host_id=device.pk,
        ).count()
        add_url = reverse('plugins:netbox_map:applicationdeployment_add')
        add_url += f'?host_type={device_ct.pk}&device={device.pk}'
        return self.render(
            'netbox_map/inc/device_applications_panel.html',
            extra_context={
                'deployments': deployments,
                'total_count': total,
                'add_url': add_url,
            }
        )


class VMApplicationPanel(PluginTemplateExtension):
    models = ['virtualization.virtualmachine']

    def right_page(self):
        vm = self.context['object']
        vm_ct = ContentType.objects.get_for_model(vm)
        from .models import ApplicationDeployment
        from django.urls import reverse
        deployments = list(
            ApplicationDeployment.objects
            .filter(host_type=vm_ct, host_id=vm.pk)
            .select_related('application')[:5]
        )
        total = ApplicationDeployment.objects.filter(
            host_type=vm_ct, host_id=vm.pk,
        ).count()
        add_url = reverse('plugins:netbox_map:applicationdeployment_add')
        add_url += f'?host_type={vm_ct.pk}&virtual_machine={vm.pk}'
        return self.render(
            'netbox_map/inc/device_applications_panel.html',
            extra_context={
                'deployments': deployments,
                'total_count': total,
                'add_url': add_url,
            }
        )


template_extensions = [SiteFloorPlanLink, DeviceFloorPlanLink, DeviceApplicationPanel, VMApplicationPanel]
