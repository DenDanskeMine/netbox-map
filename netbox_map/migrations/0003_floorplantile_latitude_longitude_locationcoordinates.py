import django.db.models.deletion
import netbox.models.deletion
import taggit.managers
import utilities.json
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('dcim', '0225_gfk_indexes'),
        ('extras', '0134_owner'),
        ('netbox_map', '0002_rename_netbox_map_assigne_idx_netbox_map__assigne_eb5b30_idx'),
    ]

    operations = [
        # Add optional lat/lng to FloorPlanTile for global map placement
        migrations.AddField(
            model_name='floorplantile',
            name='latitude',
            field=models.DecimalField(
                blank=True,
                decimal_places=6,
                help_text='Latitude for global map placement (-90 to 90)',
                max_digits=8,
                null=True,
                verbose_name='latitude',
            ),
        ),
        migrations.AddField(
            model_name='floorplantile',
            name='longitude',
            field=models.DecimalField(
                blank=True,
                decimal_places=6,
                help_text='Longitude for global map placement (-180 to 180)',
                max_digits=9,
                null=True,
                verbose_name='longitude',
            ),
        ),
        # New LocationCoordinates model
        migrations.CreateModel(
            name='LocationCoordinates',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False)),
                ('created', models.DateTimeField(auto_now_add=True, null=True)),
                ('last_updated', models.DateTimeField(auto_now=True, null=True)),
                ('custom_field_data', models.JSONField(blank=True, default=dict, encoder=utilities.json.CustomFieldJSONEncoder)),
                ('latitude', models.DecimalField(
                    decimal_places=6,
                    help_text='Latitude (-90 to 90)',
                    max_digits=8,
                    verbose_name='latitude',
                )),
                ('longitude', models.DecimalField(
                    decimal_places=6,
                    help_text='Longitude (-180 to 180)',
                    max_digits=9,
                    verbose_name='longitude',
                )),
                ('location', models.OneToOneField(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='coordinates',
                    to='dcim.location',
                )),
                ('tags', taggit.managers.TaggableManager(through='extras.TaggedItem', to='extras.Tag')),
            ],
            options={
                'verbose_name': 'location coordinates',
                'verbose_name_plural': 'location coordinates',
                'ordering': ('location',),
            },
            bases=(netbox.models.deletion.DeleteMixin, models.Model),
        ),
    ]
