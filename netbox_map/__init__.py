from netbox.plugins import PluginConfig


class MapConfig(PluginConfig):
    name = 'netbox_map'
    verbose_name = 'NetBox Map'
    author = 'Christian Rose'
    description = 'Interactive floor plan visualization for NetBox sites'
    version = '0.9.2'
    base_url = 'map'
    min_version = '4.5.0'
    default_settings = {
        'default_grid_width': 20,
        'default_grid_height': 20,
        'default_tile_size': 60,
    }

    def ready(self):
        super().ready()
        from . import (
            dashboard,  # noqa: F401 — registers dashboard widgets
            signals,  # noqa: F401
        )


config = MapConfig
