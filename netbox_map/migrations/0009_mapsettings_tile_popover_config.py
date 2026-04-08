from django.db import migrations, models

ALL_TILE_TYPES = [
    'rack', 'aisle', 'wall', 'column', 'door',
    'cooling', 'power', 'empty', 'reserved',
    'ap', 'camera', 'printer',
]


def copy_popover_to_config(apps, schema_editor):
    """Copy existing popover_fields into tile_popover_config for all tile types."""
    MapSettings = apps.get_model('netbox_map', 'MapSettings')
    for settings in MapSettings.objects.all():
        if settings.popover_fields:
            config = {t: list(settings.popover_fields) for t in ALL_TILE_TYPES}
            settings.tile_popover_config = config
            settings.save(update_fields=['tile_popover_config'])


class Migration(migrations.Migration):

    dependencies = [
        ('netbox_map', '0008_mapsettings_popover_fields'),
    ]

    operations = [
        migrations.AddField(
            model_name='mapsettings',
            name='tile_popover_config',
            field=models.JSONField(
                default=dict,
                help_text='Per-tile-type popover field configuration',
                verbose_name='Tile Popover Configuration',
            ),
        ),
        migrations.RunPython(copy_popover_to_config, migrations.RunPython.noop),
    ]
