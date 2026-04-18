from django import forms
from django.template.loader import render_to_string
from django.utils.translation import gettext_lazy as _
from extras.dashboard.utils import register_widget
from extras.dashboard.widgets import DashboardWidget, WidgetConfigForm


@register_widget
class AppHealthWidget(DashboardWidget):
    default_title = _('Application Health')
    description = _('Shows application health summary from the topology view')
    width = 4
    height = 3

    class ConfigForm(WidgetConfigForm):
        max_items = forms.IntegerField(
            required=False,
            initial=5,
            label=_('Max items to show'),
            help_text=_('Maximum number of impacted apps to display'),
        )

    def render(self, request):
        from dcim.models import Device
        from django.contrib.contenttypes.models import ContentType

        from .models import Application, ApplicationDeployment

        # Count apps by deployment health
        device_ct = ContentType.objects.get_for_model(Device)
        DOWN_STATUSES = {'offline', 'failed', 'decommissioning'}

        total_apps = Application.objects.count()

        # Find apps on down devices
        down_device_ids = set(
            Device.objects.filter(status__in=DOWN_STATUSES).values_list('pk', flat=True)
        )
        impacted_app_ids = set()
        if down_device_ids:
            impacted_app_ids = set(
                ApplicationDeployment.objects.filter(
                    host_type=device_ct,
                    host_id__in=down_device_ids,
                ).values_list('application_id', flat=True)
            )

        down_count = len(impacted_app_ids)
        healthy_count = total_apps - down_count
        max_items = self.config.get('max_items', 5) or 5

        impacted_apps = []
        if impacted_app_ids:
            impacted_apps = list(
                Application.objects.filter(pk__in=impacted_app_ids)
                .select_related('group')
                .order_by('-criticality', 'name')[:max_items]
            )

        return render_to_string('netbox_map/widgets/app_health.html', {
            'total': total_apps,
            'down': down_count,
            'healthy': healthy_count,
            'impacted_apps': impacted_apps,
        })
