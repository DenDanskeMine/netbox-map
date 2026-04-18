from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('netbox_map', '0019_applicationtemplate_and_more'),
    ]

    operations = [
        migrations.AddField(
            model_name='application',
            name='default_port',
            field=models.IntegerField(blank=True, help_text='Default port this application listens on', null=True),
        ),
        migrations.AddField(
            model_name='application',
            name='default_protocol',
            field=models.CharField(blank=True, help_text='Default protocol (e.g., HTTP, TCP, gRPC)', max_length=50),
        ),
    ]
