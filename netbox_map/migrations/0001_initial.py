import django.core.validators
import django.db.models.deletion
import netbox.models.deletion
import taggit.managers
import utilities.json
from django.db import migrations, models


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        ('contenttypes', '0002_remove_content_type_name'),
        ('dcim', '0225_gfk_indexes'),
        ('extras', '0134_owner'),
    ]

    operations = [
        migrations.CreateModel(
            name='FloorPlan',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False)),
                ('created', models.DateTimeField(auto_now_add=True, null=True)),
                ('last_updated', models.DateTimeField(auto_now=True, null=True)),
                ('custom_field_data', models.JSONField(blank=True, default=dict, encoder=utilities.json.CustomFieldJSONEncoder)),
                ('name', models.CharField(max_length=200, verbose_name='name')),
                ('grid_width', models.PositiveIntegerField(
                    default=20,
                    help_text='Width of the grid in tiles',
                    validators=[django.core.validators.MinValueValidator(1), django.core.validators.MaxValueValidator(1000)],
                    verbose_name='grid width',
                )),
                ('grid_height', models.PositiveIntegerField(
                    default=20,
                    help_text='Height of the grid in tiles',
                    validators=[django.core.validators.MinValueValidator(1), django.core.validators.MaxValueValidator(1000)],
                    verbose_name='grid height',
                )),
                ('tile_size', models.PositiveIntegerField(
                    default=60,
                    help_text='Size of each tile in pixels for rendering',
                    validators=[django.core.validators.MinValueValidator(5), django.core.validators.MaxValueValidator(200)],
                    verbose_name='tile size',
                )),
                ('background_image', models.ImageField(blank=True, null=True, upload_to='floorplan-backgrounds/', verbose_name='background image')),
                ('description', models.CharField(blank=True, max_length=200, verbose_name='description')),
                ('comments', models.TextField(blank=True, verbose_name='comments')),
                ('location', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='floorplans', to='dcim.location')),
                ('site', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='floorplans', to='dcim.site')),
                ('tags', taggit.managers.TaggableManager(through='extras.TaggedItem', to='extras.Tag')),
            ],
            options={
                'verbose_name': 'floor plan',
                'verbose_name_plural': 'floor plans',
                'ordering': ('site', 'name'),
            },
            bases=(netbox.models.deletion.DeleteMixin, models.Model),
        ),
        migrations.CreateModel(
            name='FloorPlanTile',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False)),
                ('created', models.DateTimeField(auto_now_add=True, null=True)),
                ('last_updated', models.DateTimeField(auto_now=True, null=True)),
                ('custom_field_data', models.JSONField(blank=True, default=dict, encoder=utilities.json.CustomFieldJSONEncoder)),
                ('x_position', models.PositiveIntegerField(help_text='X coordinate on the grid (0-indexed)', verbose_name='X position')),
                ('y_position', models.PositiveIntegerField(help_text='Y coordinate on the grid (0-indexed)', verbose_name='Y position')),
                ('width', models.PositiveIntegerField(
                    default=1,
                    help_text='Width in grid cells',
                    validators=[django.core.validators.MinValueValidator(1), django.core.validators.MaxValueValidator(10)],
                    verbose_name='width',
                )),
                ('height', models.PositiveIntegerField(
                    default=1,
                    help_text='Height in grid cells',
                    validators=[django.core.validators.MinValueValidator(1), django.core.validators.MaxValueValidator(10)],
                    verbose_name='height',
                )),
                ('assigned_object_type', models.ForeignKey(
                    blank=True, null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name='+',
                    to='contenttypes.contenttype',
                    help_text='Type of assigned object',
                )),
                ('assigned_object_id', models.PositiveBigIntegerField(blank=True, null=True, help_text='ID of assigned object')),
                ('label', models.CharField(blank=True, max_length=100, help_text='Custom label (overrides assigned object name)', verbose_name='label')),
                ('tile_type', models.CharField(default='rack', max_length=50, verbose_name='tile type')),
                ('status', models.CharField(default='active', max_length=50, verbose_name='status')),
                ('orientation', models.PositiveSmallIntegerField(default=0, help_text='Rotation in degrees (0, 90, 180, 270)', verbose_name='orientation')),
                ('fov_direction', models.PositiveSmallIntegerField(
                    default=0,
                    help_text='Camera viewing direction in degrees (0=north, 90=east, 180=south, 270=west)',
                    validators=[django.core.validators.MinValueValidator(0), django.core.validators.MaxValueValidator(360)],
                    verbose_name='FOV direction',
                )),
                ('fov_angle', models.PositiveSmallIntegerField(
                    default=90,
                    help_text='Camera field of view width in degrees',
                    validators=[django.core.validators.MinValueValidator(10), django.core.validators.MaxValueValidator(360)],
                    verbose_name='FOV angle',
                )),
                ('fov_distance', models.PositiveSmallIntegerField(
                    default=5,
                    help_text='Camera view distance in grid cells',
                    validators=[django.core.validators.MinValueValidator(1), django.core.validators.MaxValueValidator(50)],
                    verbose_name='FOV distance',
                )),
                ('floorplan', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='tiles', to='netbox_map.floorplan')),
                ('tags', taggit.managers.TaggableManager(through='extras.TaggedItem', to='extras.Tag')),
            ],
            options={
                'verbose_name': 'floor plan tile',
                'verbose_name_plural': 'floor plan tiles',
                'ordering': ('floorplan', 'y_position', 'x_position'),
            },
            bases=(netbox.models.deletion.DeleteMixin, models.Model),
        ),
        migrations.AddConstraint(
            model_name='floorplan',
            constraint=models.UniqueConstraint(fields=('site', 'name'), name='netbox_map_floorplan_unique_site_name'),
        ),
        migrations.AddConstraint(
            model_name='floorplantile',
            constraint=models.UniqueConstraint(fields=('floorplan', 'x_position', 'y_position'), name='netbox_map_floorplantile_unique_position'),
        ),
        migrations.AddIndex(
            model_name='floorplantile',
            index=models.Index(fields=['assigned_object_type', 'assigned_object_id'], name='netbox_map_assigne_idx'),
        ),
    ]
