from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('netbox_map', '0005_rename_netbox_map__assigne_mapmarker_idx_netbox_map__assigne_6fd3ec_idx'),
    ]

    operations = [
        migrations.CreateModel(
            name='MapSettings',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('show_mac', models.BooleanField(default=True, help_text='Display MAC address for devices in the detail panel', verbose_name='Show MAC Address')),
                ('show_custom_fields', models.BooleanField(default=True, help_text='Display custom fields in the detail panel', verbose_name='Show Custom Fields')),
                ('sync_device_gps', models.BooleanField(default=True, help_text='Automatically update device latitude/longitude when placed on a map', verbose_name='Sync Device GPS')),
                ('device_fields', models.JSONField(default=list, help_text='Standard fields to show for devices', verbose_name='Device Fields')),
                ('rack_fields', models.JSONField(default=list, help_text='Standard fields to show for racks', verbose_name='Rack Fields')),
                ('powerpanel_fields', models.JSONField(default=list, help_text='Standard fields to show for power panels', verbose_name='Power Panel Fields')),
                ('powerfeed_fields', models.JSONField(default=list, help_text='Standard fields to show for power feeds', verbose_name='Power Feed Fields')),
            ],
            options={
                'verbose_name': 'Map Settings',
                'verbose_name_plural': 'Map Settings',
            },
        ),
    ]
