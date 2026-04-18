import django.core.validators
import taggit.managers
import utilities.json
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('netbox_map', '0010_floorplantile_linked_floorplan'),
        ('extras', '0001_initial'),
    ]

    operations = [
        # Create the CustomMarkerType table
        migrations.CreateModel(
            name='CustomMarkerType',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False)),
                ('created', models.DateTimeField(auto_now_add=True, null=True)),
                ('last_updated', models.DateTimeField(auto_now=True, null=True)),
                ('custom_field_data', models.JSONField(blank=True, default=dict, encoder=utilities.json.CustomFieldJSONEncoder)),
                ('name', models.CharField(max_length=100, unique=True, verbose_name='name')),
                ('slug', models.CharField(
                    help_text='Auto-prefixed with "custom_". Used as tile_type/marker_type value.',
                    max_length=50,
                    unique=True,
                    validators=[
                        django.core.validators.RegexValidator(
                            message='Slug must start with "custom_" and contain only lowercase letters, numbers, and underscores.',
                            regex='^custom_[a-z0-9_]+$',
                        ),
                    ],
                    verbose_name='slug',
                )),
                ('color', models.CharField(
                    default='#ff5733',
                    help_text='Hex color code (e.g. #ff5733)',
                    max_length=7,
                    validators=[
                        django.core.validators.RegexValidator(
                            message='Enter a valid hex color (e.g. #ff5733).',
                            regex='^#[0-9a-fA-F]{6}$',
                        ),
                    ],
                    verbose_name='color',
                )),
                ('icon', models.CharField(
                    default='mdi-shape',
                    help_text='MDI icon class (e.g. mdi-server-network)',
                    max_length=100,
                    verbose_name='icon',
                )),
                ('description', models.CharField(blank=True, max_length=200, verbose_name='description')),
                ('tags', taggit.managers.TaggableManager(through='extras.TaggedItem', to='extras.Tag')),
            ],
            options={
                'verbose_name': 'custom marker type',
                'verbose_name_plural': 'custom marker types',
                'ordering': ('name',),
            },
        ),
        # Remove choices= from FloorPlanTile.tile_type
        migrations.AlterField(
            model_name='floorplantile',
            name='tile_type',
            field=models.CharField(
                default='rack',
                max_length=50,
                verbose_name='tile type',
            ),
        ),
        # Remove choices= from MapMarker.marker_type
        migrations.AlterField(
            model_name='mapmarker',
            name='marker_type',
            field=models.CharField(
                default='camera',
                max_length=50,
                verbose_name='marker type',
            ),
        ),
    ]
