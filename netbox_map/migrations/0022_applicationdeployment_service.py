import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ('ipam', '0001_initial'),
        ('netbox_map', '0021_application_ip_fields'),
    ]
    operations = [
        migrations.AddField(
            model_name='applicationdeployment',
            name='service',
            field=models.ForeignKey(
                blank=True, null=True,
                help_text='NetBox application service linked to this deployment',
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='+',
                to='ipam.service',
                verbose_name='Service',
            ),
        ),
    ]
