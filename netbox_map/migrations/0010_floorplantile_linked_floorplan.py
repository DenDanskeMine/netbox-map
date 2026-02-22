import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('netbox_map', '0009_mapsettings_tile_popover_config'),
    ]

    operations = [
        migrations.AddField(
            model_name='floorplantile',
            name='linked_floorplan',
            field=models.ForeignKey(
                blank=True,
                help_text='Floor plan to navigate to when this tile is clicked',
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='linked_tiles',
                to='netbox_map.floorplan',
                verbose_name='linked floor plan',
            ),
        ),
    ]
