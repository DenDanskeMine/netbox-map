from django.utils.translation import gettext_lazy as _
from netbox.choices import ButtonColorChoices
from netbox.plugins import PluginMenu, PluginMenuButton, PluginMenuItem

menu = PluginMenu(
    label=_('Floor Plans'),
    groups=(
        (_('Maps'), (
            PluginMenuItem(
                link='plugins:netbox_map:sitemap',
                link_text=_('Site Map'),
                permissions=['netbox_map.view_mapmarker'],
            ),
            PluginMenuItem(
                link='plugins:netbox_map:mapmarker_list',
                link_text=_('Map Markers'),
                permissions=['netbox_map.view_mapmarker'],
                buttons=(
                    PluginMenuButton(
                        link='plugins:netbox_map:mapmarker_add',
                        title=_('Add'),
                        icon_class='mdi mdi-plus-thick',
                        color=ButtonColorChoices.GREEN,
                        permissions=['netbox_map.add_mapmarker'],
                    ),
                )
            ),
            PluginMenuItem(
                link='plugins:netbox_map:cablepath_list',
                link_text=_('Cable Paths'),
                permissions=['netbox_map.view_cablepath'],
                buttons=(
                    PluginMenuButton(
                        link='plugins:netbox_map:cablepath_add',
                        title=_('Add'),
                        icon_class='mdi mdi-plus-thick',
                        color=ButtonColorChoices.GREEN,
                        permissions=['netbox_map.add_cablepath'],
                    ),
                )
            ),
        )),
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
        (_('Configuration'), (
            PluginMenuItem(
                link='plugins:netbox_map:custommarkertype_list',
                link_text=_('Custom Marker Types'),
                permissions=['netbox_map.view_custommarkertype'],
                buttons=(
                    PluginMenuButton(
                        link='plugins:netbox_map:custommarkertype_add',
                        title=_('Add'),
                        icon_class='mdi mdi-plus-thick',
                        color=ButtonColorChoices.GREEN,
                        permissions=['netbox_map.add_custommarkertype'],
                    ),
                )
            ),
            PluginMenuItem(
                link='plugins:netbox_map:settings',
                link_text=_('Settings'),
            ),
        )),
    ),
    icon_class='mdi mdi-floor-plan'
)
