from netbox.plugins import PluginConfig


class SitemapConfig(PluginConfig):
    name = 'netbox_sitemap'
    verbose_name = 'Sitemap'
    author = 'Christian Rose'
    description = 'Interactive floor plan visualization for NetBox sites'
    version = '0.1.0'
    base_url = 'sitemap'
    min_version = '4.5.0'
    default_settings = {
        'default_grid_width': 20,
        'default_grid_height': 20,
        'default_tile_size': 60,
    }


config = SitemapConfig
