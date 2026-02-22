import django.core.validators
import django.db.models.deletion
import netbox.models.deletion
import taggit.managers
import utilities.json
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('contenttypes', '0002_remove_content_type_name'),
        ('dcim', '0225_gfk_indexes'),
        ('extras', '0134_owner'),
        ('netbox_map', '0003_floorplantile_latitude_longitude_locationcoordinates'),
    ]

    operations = [
        migrations.CreateModel(
            name='MapMarker',
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
                ('label', models.CharField(
                    blank=True,
                    help_text='Display label for this marker',
                    max_length=100,
                    verbose_name='label',
                )),
                ('marker_type', models.CharField(
                    choices=[
                        ('rack', 'Rack'), ('aisle', 'Aisle'), ('wall', 'Wall'),
                        ('column', 'Column'), ('door', 'Door'), ('cooling', 'Cooling'),
                        ('power', 'Power'), ('empty', 'Empty'), ('reserved', 'Reserved'),
                        ('ap', 'Access Point'), ('camera', 'Camera'), ('printer', 'Printer'),
                    ],
                    default='camera',
                    max_length=50,
                    verbose_name='marker type',
                )),
                ('status', models.CharField(
                    choices=[
                        ('active', 'Active'), ('planned', 'Planned'),
                        ('decommissioned', 'Decommissioned'),
                    ],
                    default='active',
                    max_length=50,
                    verbose_name='status',
                )),
                ('fov_direction', models.PositiveSmallIntegerField(
                    default=0,
                    help_text='Camera viewing direction in degrees (0=north, 90=east)',
                    validators=[
                        django.core.validators.MinValueValidator(0),
                        django.core.validators.MaxValueValidator(360),
                    ],
                    verbose_name='FOV direction',
                )),
                ('fov_angle', models.PositiveSmallIntegerField(
                    default=90,
                    help_text='Camera field of view width in degrees',
                    validators=[
                        django.core.validators.MinValueValidator(10),
                        django.core.validators.MaxValueValidator(360),
                    ],
                    verbose_name='FOV angle',
                )),
                ('fov_distance', models.PositiveSmallIntegerField(
                    default=5,
                    help_text='Camera view distance (1 unit ≈ 50m)',
                    validators=[
                        django.core.validators.MinValueValidator(1),
                        django.core.validators.MaxValueValidator(50),
                    ],
                    verbose_name='FOV distance',
                )),
                ('assigned_object_id', models.PositiveBigIntegerField(
                    blank=True,
                    help_text='ID of assigned object',
                    null=True,
                )),
                ('description', models.CharField(blank=True, max_length=200, verbose_name='description')),
                ('assigned_object_type', models.ForeignKey(
                    blank=True,
                    help_text='Type of assigned object',
                    null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name='+',
                    to='contenttypes.contenttype',
                )),
                ('site', models.ForeignKey(
                    blank=True,
                    null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name='map_markers',
                    to='dcim.site',
                )),
                ('tags', taggit.managers.TaggableManager(through='extras.TaggedItem', to='extras.Tag')),
            ],
            options={
                'verbose_name': 'map marker',
                'verbose_name_plural': 'map markers',
                'ordering': ('label',),
            },
            bases=(netbox.models.deletion.DeleteMixin, models.Model),
        ),
        migrations.AddIndex(
            model_name='mapmarker',
            index=models.Index(fields=['assigned_object_type', 'assigned_object_id'], name='netbox_map__assigne_mapmarker_idx'),
        ),
    ]
