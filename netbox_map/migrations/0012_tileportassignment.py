import django.db.models.deletion
import taggit.managers
import utilities.json
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('netbox_map', '0011_custommarkertype'),
        ('contenttypes', '0002_remove_content_type_name'),
        ('extras', '0001_initial'),
    ]

    operations = [
        migrations.CreateModel(
            name='TilePortAssignment',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False)),
                ('created', models.DateTimeField(auto_now_add=True, null=True)),
                ('last_updated', models.DateTimeField(auto_now=True, null=True)),
                ('custom_field_data', models.JSONField(blank=True, default=dict, encoder=utilities.json.CustomFieldJSONEncoder)),
                ('port_id', models.PositiveBigIntegerField()),
                ('tile', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='port_assignments',
                    to='netbox_map.floorplantile',
                )),
                ('port_type', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    to='contenttypes.contenttype',
                )),
                ('tags', taggit.managers.TaggableManager(through='extras.TaggedItem', to='extras.Tag')),
            ],
            options={
                'verbose_name': 'tile port assignment',
                'verbose_name_plural': 'tile port assignments',
                'ordering': ('tile', 'port_type', 'port_id'),
            },
        ),
        migrations.AddConstraint(
            model_name='tileportassignment',
            constraint=models.UniqueConstraint(
                fields=('tile', 'port_type', 'port_id'),
                name='netbox_map_tileportassignment_unique_tile_port',
            ),
        ),
        migrations.AddIndex(
            model_name='tileportassignment',
            index=models.Index(
                fields=['port_type', 'port_id'],
                name='netbox_map_tileportass_port_ty_idx',
            ),
        ),
    ]
