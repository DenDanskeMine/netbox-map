from django.utils.translation import gettext_lazy as _
from netbox.choices import ButtonColorChoices
from netbox.plugins import PluginMenu, PluginMenuButton, PluginMenuItem

menu = PluginMenu(
    label=_('Floor Plans'),
    groups=(
        (_('Floor Plans'), (
            PluginMenuItem(
                link='plugins:netbox_map:floorplan_list',
                link_text=_('Floor Plans'),
                permissions=['netbox_map.view_floorplan'],
                buttons=(
                    PluginMenuButton(
                        link='plugins:netbox_map:floorplan_add',
                        title=_('Add'),
                        icon_class='mdi mdi-plus-thick',
                        color=ButtonColorChoices.GREEN,
                        permissions=['netbox_map.add_floorplan'],
                    ),
                )
            ),
            PluginMenuItem(
                link='plugins:netbox_map:floorplantile_list',
                link_text=_('Floor Plan Tiles'),
                permissions=['netbox_map.view_floorplantile'],
                buttons=(
                    PluginMenuButton(
                        link='plugins:netbox_map:floorplantile_add',
                        title=_('Add'),
                        icon_class='mdi mdi-plus-thick',
                        color=ButtonColorChoices.GREEN,
                        permissions=['netbox_map.add_floorplantile'],
                    ),
                )
            ),
        )),
    ),
    icon_class='mdi mdi-floor-plan'
)
