from netbox.plugins import PluginTemplateExtension
from .models import FloorPlan


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


template_extensions = [SiteFloorPlanLink]
