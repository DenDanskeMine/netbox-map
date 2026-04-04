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
        all_deployments = list(
            ApplicationDeployment.objects
            .filter(host_type=device_ct, host_id=device.pk)
            .select_related('application')[:6]  # fetch 6 to know if there are more than 5
        )
        deployments = all_deployments[:5]
        total = len(all_deployments) if len(all_deployments) <= 5 else ApplicationDeployment.objects.filter(
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
        all_deployments = list(
            ApplicationDeployment.objects
            .filter(host_type=vm_ct, host_id=vm.pk)
            .select_related('application')[:6]
        )
        deployments = all_deployments[:5]
        total = len(all_deployments) if len(all_deployments) <= 5 else ApplicationDeployment.objects.filter(
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


class IPAddressApplicationPanel(PluginTemplateExtension):
    models = ['ipam.ipaddress']

    def right_page(self):
        ip = self.context['object']
        from .models import Application, ApplicationDeployment
        applications = list(Application.objects.filter(primary_ip=ip))
        deployments = list(
            ApplicationDeployment.objects
            .filter(ip_address=ip)
            .select_related('application')
        )
        if not applications and not deployments:
            return ''
        return self.render(
            'netbox_map/inc/ip_applications_panel.html',
            extra_context={
                'applications': applications,
                'deployments': deployments,
            }
        )


class ServiceApplicationPanel(PluginTemplateExtension):
    models = ['ipam.service']

    def right_page(self):
        service = self.context['object']
        from .models import ApplicationDeployment
        deployments = list(
            ApplicationDeployment.objects.filter(service=service)
            .select_related('application')[:10]
        )
        if not deployments:
            return ''
        return self.render(
            'netbox_map/inc/service_applications_panel.html',
            extra_context={'deployments': deployments}
        )


template_extensions = [SiteFloorPlanLink, DeviceFloorPlanLink, DeviceApplicationPanel, VMApplicationPanel, IPAddressApplicationPanel, ServiceApplicationPanel]
