import django.db.models.deletion
from django.db import migrations, models
import taggit.managers
import utilities.json


class Migration(migrations.Migration):

    dependencies = [
        ('netbox_map', '0012_tileportassignment'),
        ('extras', '0001_initial'),
    ]

    operations = [
        migrations.CreateModel(
            name='CablePath',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False)),
                ('created', models.DateTimeField(auto_now_add=True, null=True)),
                ('last_updated', models.DateTimeField(auto_now=True, null=True)),
                ('custom_field_data', models.JSONField(blank=True, default=dict, encoder=utilities.json.CustomFieldJSONEncoder)),
                ('label', models.CharField(blank=True, max_length=200, verbose_name='label')),
                ('path_coordinates', models.JSONField(default=list, help_text='Array of [lat, lng] coordinate pairs', verbose_name='path coordinates')),
                ('fiber_count', models.PositiveIntegerField(default=12, verbose_name='fiber count')),
                ('status', models.CharField(default='planned', max_length=50, verbose_name='status')),
                ('start_marker', models.ForeignKey(
                    blank=True,
                    null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name='cables_from',
                    to='netbox_map.mapmarker',
                    verbose_name='start marker',
                )),
                ('end_marker', models.ForeignKey(
                    blank=True,
                    null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name='cables_to',
                    to='netbox_map.mapmarker',
                    verbose_name='end marker',
                )),
                ('tags', taggit.managers.TaggableManager(through='extras.TaggedItem', to='extras.Tag')),
            ],
            options={
                'verbose_name': 'cable path',
                'verbose_name_plural': 'cable paths',
                'ordering': ('label',),
            },
        ),
    ]
