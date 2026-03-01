from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('netbox_map', '0014_cablepath_color_weight'),
    ]

    operations = [
        migrations.AddField(
            model_name='cablepath',
            name='cable_type',
            field=models.CharField(blank=True, default='', max_length=50, verbose_name='cable type'),
        ),
    ]
