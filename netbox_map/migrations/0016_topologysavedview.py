import django.db.models.deletion
from django.db import migrations, models
import utilities.json


class Migration(migrations.Migration):

    dependencies = [
        ('dcim', '0001_initial'),
        ('netbox_map', '0015_cablepath_cable_type'),
    ]

    operations = [
        migrations.CreateModel(
            name='TopologySavedView',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False)),
                ('created', models.DateTimeField(auto_now_add=True, null=True)),
                ('last_updated', models.DateTimeField(auto_now=True, null=True)),
                ('custom_field_data', models.JSONField(blank=True, default=dict, encoder=utilities.json.CustomFieldJSONEncoder)),
                ('name', models.CharField(max_length=200)),
                ('description', models.CharField(blank=True, max_length=500)),
                ('filters', models.JSONField(blank=True, default=dict)),
                ('layout_data', models.JSONField(blank=True, default=dict)),
                ('view_mode', models.CharField(default='stencil', max_length=20)),
                ('site', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='topology_views', to='dcim.site')),
                ('tags', models.ManyToManyField(blank=True, related_name='+', to='extras.tag')),
            ],
            options={
                'verbose_name': 'Topology Saved View',
                'verbose_name_plural': 'Topology Saved Views',
                'ordering': ['name'],
            },
        ),
        migrations.AddConstraint(
            model_name='topologysavedview',
            constraint=models.UniqueConstraint(fields=('name',), name='unique_topology_view_name'),
        ),
    ]
