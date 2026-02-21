from django.utils.translation import gettext_lazy as _
from netbox.choices import ButtonColorChoices
from netbox.plugins import PluginMenu, PluginMenuButton, PluginMenuItem

menu = PluginMenu(
    label=_('Floor Plans'),
    groups=(
        (_('Floor Plans'), (
            PluginMenuItem(
                link='plugins:netbox_sitemap:floorplan_list',
                link_text=_('Floor Plans'),
                permissions=['netbox_sitemap.view_floorplan'],
                buttons=(
                    PluginMenuButton(
                        link='plugins:netbox_sitemap:floorplan_add',
                        title=_('Add'),
                        icon_class='mdi mdi-plus-thick',
                        color=ButtonColorChoices.GREEN,
                        permissions=['netbox_sitemap.add_floorplan'],
                    ),
                )
            ),
            PluginMenuItem(
                link='plugins:netbox_sitemap:floorplantile_list',
                link_text=_('Floor Plan Tiles'),
                permissions=['netbox_sitemap.view_floorplantile'],
                buttons=(
                    PluginMenuButton(
                        link='plugins:netbox_sitemap:floorplantile_add',
                        title=_('Add'),
                        icon_class='mdi mdi-plus-thick',
                        color=ButtonColorChoices.GREEN,
                        permissions=['netbox_sitemap.add_floorplantile'],
                    ),
                )
            ),
        )),
    ),
    icon_class='mdi mdi-floor-plan'
)
