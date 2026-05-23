from django.utils.translation import gettext_lazy as _
from netbox.choices import ButtonColorChoices
from netbox.plugins import PluginMenu, PluginMenuButton, PluginMenuItem


def _add_button(link_name, perm):
    """Small helper: standard green "+" Add button for list items."""
    return PluginMenuButton(
        link=f'plugins:netbox_map:{link_name}',
        title=_('Add'),
        icon_class='mdi mdi-plus-thick',
        color=ButtonColorChoices.GREEN,
        permissions=[f'netbox_map.add_{perm}'],
    )


menu = PluginMenu(
    label=_('Floor Plans'),
    icon_class='mdi mdi-floor-plan',
    groups=(
        # ── Maps: the visual views users actually open day-to-day ────────────
        (_('Maps'), (
            PluginMenuItem(
                link='plugins:netbox_map:sitemap',
                link_text=_('Site Map'),
                permissions=['netbox_map.view_mapmarker'],
            ),
            PluginMenuItem(
                link='plugins:netbox_map:floorplan_list',
                link_text=_('Floor Plans'),
                permissions=['netbox_map.view_floorplan'],
                buttons=(_add_button('floorplan_add', 'floorplan'),),
            ),
            PluginMenuItem(
                link='plugins:netbox_map:topology',
                link_text=_('Topology View'),
                permissions=['dcim.view_device'],
            ),
        )),

        # ── Catalogs: backing object lists (rarely browsed directly) ─────────
        (_('Catalogs'), (
            PluginMenuItem(
                link='plugins:netbox_map:mapmarker_list',
                link_text=_('Map Markers'),
                permissions=['netbox_map.view_mapmarker'],
                buttons=(_add_button('mapmarker_add', 'mapmarker'),),
            ),
            PluginMenuItem(
                link='plugins:netbox_map:cablepath_list',
                link_text=_('Cable Paths'),
                permissions=['netbox_map.view_cablepath'],
                buttons=(_add_button('cablepath_add', 'cablepath'),),
            ),
            PluginMenuItem(
                link='plugins:netbox_map:floorplantile_list',
                link_text=_('Floor Plan Tiles'),
                permissions=['netbox_map.view_floorplantile'],
                buttons=(_add_button('floorplantile_add', 'floorplantile'),),
            ),
            PluginMenuItem(
                link='plugins:netbox_map:topologysavedview_list',
                link_text=_('Saved Topology Views'),
                permissions=['netbox_map.view_topologysavedview'],
                buttons=(_add_button('topologysavedview_add', 'topologysavedview'),),
            ),
            PluginMenuItem(
                link='plugins:netbox_map:custommarkertype_list',
                link_text=_('Custom Marker Types'),
                permissions=['netbox_map.view_custommarkertype'],
                buttons=(_add_button('custommarkertype_add', 'custommarkertype'),),
            ),
        )),

        # ── Applications (Beta) ─────────────────────────────────────────────
        (_('Applications (Beta)'), (
            PluginMenuItem(
                link='plugins:netbox_map:application_list',
                link_text=_('Applications'),
                permissions=['netbox_map.view_application'],
                buttons=(_add_button('application_add', 'application'),),
            ),
            PluginMenuItem(
                link='plugins:netbox_map:applicationgroup_list',
                link_text=_('Groups'),
                permissions=['netbox_map.view_applicationgroup'],
                buttons=(_add_button('applicationgroup_add', 'applicationgroup'),),
            ),
            PluginMenuItem(
                link='plugins:netbox_map:applicationtemplate_list',
                link_text=_('Templates'),
                permissions=['netbox_map.view_applicationtemplate'],
                buttons=(_add_button('applicationtemplate_add', 'applicationtemplate'),),
            ),
            PluginMenuItem(
                link='plugins:netbox_map:applicationdeployment_list',
                link_text=_('Deployments'),
                permissions=['netbox_map.view_applicationdeployment'],
                buttons=(_add_button('applicationdeployment_add', 'applicationdeployment'),),
            ),
            PluginMenuItem(
                link='plugins:netbox_map:applicationdependency_list',
                link_text=_('Dependencies'),
                permissions=['netbox_map.view_applicationdependency'],
                buttons=(_add_button('applicationdependency_add', 'applicationdependency'),),
            ),
        )),

        # ── Settings ────────────────────────────────────────────────────────
        (_('Configuration'), (
            PluginMenuItem(
                link='plugins:netbox_map:settings',
                link_text=_('Settings'),
            ),
        )),
    ),
)
