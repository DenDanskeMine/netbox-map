import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('ipam', '0001_initial'),
        ('netbox_map', '0020_application_default_port_protocol'),
    ]

    operations = [
        migrations.AddField(
            model_name='application',
            name='primary_ip',
            field=models.ForeignKey(
                blank=True,
                null=True,
                help_text='Primary IP address for this application',
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='+',
                to='ipam.ipaddress',
                verbose_name='Primary IP',
            ),
        ),
        migrations.AddField(
            model_name='applicationdeployment',
            name='ip_address',
            field=models.ForeignKey(
                blank=True,
                null=True,
                help_text='IP address this deployment listens on',
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='+',
                to='ipam.ipaddress',
                verbose_name='IP Address',
            ),
        ),
    ]
