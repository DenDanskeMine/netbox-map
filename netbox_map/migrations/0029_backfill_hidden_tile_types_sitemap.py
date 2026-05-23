"""
Backfill `MapSettings.hidden_tile_types_sitemap` from the existing
`hidden_tile_types` value so admins who already configured one list don't
lose their preference when the Site Map gains its own toggle (#63).
"""

from django.db import migrations


def backfill_sitemap(apps, schema_editor):
    MapSettings = apps.get_model('netbox_map', 'MapSettings')
    try:
        settings = MapSettings.objects.get(pk=1)
    except MapSettings.DoesNotExist:
        return  # nothing to backfill — load() will seed on first use

    # Only touch the list if the admin hasn't already set it.
    if settings.hidden_tile_types_sitemap:
        return

    settings.hidden_tile_types_sitemap = list(settings.hidden_tile_types or [])
    settings.save(update_fields=['hidden_tile_types_sitemap'])


def unbackfill(apps, schema_editor):
    # Reversible: clear the sitemap list (the field is dropped anyway)
    MapSettings = apps.get_model('netbox_map', 'MapSettings')
    try:
        settings = MapSettings.objects.get(pk=1)
    except MapSettings.DoesNotExist:
        return
    settings.hidden_tile_types_sitemap = []
    settings.save(update_fields=['hidden_tile_types_sitemap'])


class Migration(migrations.Migration):

    dependencies = [
        ('netbox_map', '0028_mapsettings_hidden_tile_types_sitemap'),
    ]

    operations = [
        migrations.RunPython(backfill_sitemap, reverse_code=unbackfill),
    ]
