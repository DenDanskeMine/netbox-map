from django.db import migrations, models

DEFAULT_POPOVER_FIELDS = ['label', 'object_info', 'primary_ip', 'utilization', 'position', 'size']


def populate_defaults(apps, schema_editor):
    MapSettings = apps.get_model('netbox_map', 'MapSettings')
    MapSettings.objects.filter(popover_fields=[]).update(popover_fields=DEFAULT_POPOVER_FIELDS)


class Migration(migrations.Migration):

    dependencies = [
        ('netbox_map', '0007_alter_mapsettings_id'),
    ]

    operations = [
        migrations.AddField(
            model_name='mapsettings',
            name='popover_fields',
            field=models.JSONField(
                default=list,
                help_text='Fields to display in the hover popover on the floor plan',
                verbose_name='Popover Fields',
            ),
        ),
        migrations.RunPython(populate_defaults, migrations.RunPython.noop),
    ]
