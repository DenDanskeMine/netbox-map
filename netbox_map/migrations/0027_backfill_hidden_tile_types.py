"""
Backfill `MapSettings.hidden_tile_types` with the FTTH/fiber defaults for
installs that haven't customised the list AND aren't already using any
fiber types on a floor plan. Installs that have existing fiber tiles are
left alone so we never break a working setup (#63).
"""

from django.db import migrations

FIBER_TYPES = [
    'splice_closure', 'olt', 'ont', 'splitter',
    'fdt', 'fat', 'manhole', 'pole', 'handhole',
]


def backfill_hidden_tile_types(apps, schema_editor):
    MapSettings = apps.get_model('netbox_map', 'MapSettings')
    FloorPlanTile = apps.get_model('netbox_map', 'FloorPlanTile')

    try:
        settings = MapSettings.objects.get(pk=1)
    except MapSettings.DoesNotExist:
        return  # nothing to backfill — load() will seed on first use

    # Only touch the list if the admin hasn't already customised it.
    if settings.hidden_tile_types:
        return

    # Don't hide types that are actually in use — that would make their
    # toolbar chip disappear for someone who's actively placing them.
    in_use = set(
        FloorPlanTile.objects.filter(tile_type__in=FIBER_TYPES)
        .values_list('tile_type', flat=True)
        .distinct()
    )
    settings.hidden_tile_types = [t for t in FIBER_TYPES if t not in in_use]
    settings.save(update_fields=['hidden_tile_types'])


def unbackfill(apps, schema_editor):
    # Reversible: clear the list if it still matches our default exactly
    MapSettings = apps.get_model('netbox_map', 'MapSettings')
    try:
        settings = MapSettings.objects.get(pk=1)
    except MapSettings.DoesNotExist:
        return
    if sorted(settings.hidden_tile_types or []) == sorted(FIBER_TYPES):
        settings.hidden_tile_types = []
        settings.save(update_fields=['hidden_tile_types'])


class Migration(migrations.Migration):

    dependencies = [
        ('netbox_map', '0026_mapsettings_hidden_tile_types'),
    ]

    operations = [
        migrations.RunPython(backfill_hidden_tile_types, reverse_code=unbackfill),
    ]
