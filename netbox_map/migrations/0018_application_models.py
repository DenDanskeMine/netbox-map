import django.core.validators
import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('contenttypes', '0002_remove_content_type_name'),
        ('dcim', '0001_initial'),
        ('extras', '0001_initial'),
        ('tenancy', '0001_initial'),
        ('netbox_map', '0017_topologysavedview'),
    ]

    operations = [
        migrations.CreateModel(
            name='ApplicationGroup',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False)),
                ('created', models.DateTimeField(auto_now_add=True, null=True)),
                ('last_updated', models.DateTimeField(auto_now=True, null=True)),
                ('custom_field_data', models.JSONField(blank=True, default=dict)),
                ('name', models.CharField(max_length=100, unique=True)),
                ('slug', models.SlugField(max_length=100, unique=True)),
                ('color', models.CharField(default='#3498db', max_length=7, validators=[
                    django.core.validators.RegexValidator(regex='^#[0-9a-fA-F]{6}$', message='Enter a valid hex color.'),
                ])),
                ('description', models.CharField(blank=True, max_length=200)),
                ('tags', models.ManyToManyField(blank=True, related_name='+', to='extras.tag')),
            ],
            options={
                'verbose_name': 'application group',
                'verbose_name_plural': 'application groups',
                'ordering': ('name',),
            },
        ),
        migrations.CreateModel(
            name='Application',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False)),
                ('created', models.DateTimeField(auto_now_add=True, null=True)),
                ('last_updated', models.DateTimeField(auto_now=True, null=True)),
                ('custom_field_data', models.JSONField(blank=True, default=dict)),
                ('name', models.CharField(max_length=200)),
                ('status', models.CharField(default='active', max_length=30)),
                ('criticality', models.CharField(default='medium', max_length=30)),
                ('environment', models.CharField(default='production', max_length=30)),
                ('version', models.CharField(blank=True, max_length=50)),
                ('description', models.CharField(blank=True, max_length=500)),
                ('comments', models.TextField(blank=True)),
                ('external_url', models.URLField(blank=True, max_length=500)),
                ('group', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='applications', to='netbox_map.applicationgroup')),
                ('tenant', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='+', to='tenancy.tenant')),
                ('site', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='+', to='dcim.site')),
                ('tags', models.ManyToManyField(blank=True, related_name='+', to='extras.tag')),
            ],
            options={
                'verbose_name': 'application',
                'verbose_name_plural': 'applications',
                'ordering': ('name',),
            },
        ),
        migrations.AddConstraint(
            model_name='application',
            constraint=models.UniqueConstraint(fields=('name', 'environment', 'tenant'), name='netbox_map_application_unique_name_env_tenant'),
        ),
        migrations.CreateModel(
            name='ApplicationDeployment',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False)),
                ('created', models.DateTimeField(auto_now_add=True, null=True)),
                ('last_updated', models.DateTimeField(auto_now=True, null=True)),
                ('custom_field_data', models.JSONField(blank=True, default=dict)),
                ('application', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='deployments', to='netbox_map.application')),
                ('host_type', models.ForeignKey(limit_choices_to={'app_label__in': ['dcim', 'virtualization'], 'model__in': ['device', 'virtualmachine']}, on_delete=django.db.models.deletion.PROTECT, related_name='+', to='contenttypes.contenttype')),
                ('host_id', models.PositiveBigIntegerField()),
                ('role', models.CharField(default='primary', max_length=30)),
                ('port', models.PositiveIntegerField(blank=True, null=True, validators=[django.core.validators.MinValueValidator(1), django.core.validators.MaxValueValidator(65535)])),
                ('protocol', models.CharField(blank=True, max_length=50)),
                ('description', models.CharField(blank=True, max_length=200)),
                ('tags', models.ManyToManyField(blank=True, related_name='+', to='extras.tag')),
            ],
            options={
                'verbose_name': 'application deployment',
                'verbose_name_plural': 'application deployments',
                'ordering': ('application', 'host_type', 'host_id'),
            },
        ),
        migrations.AddConstraint(
            model_name='applicationdeployment',
            constraint=models.UniqueConstraint(fields=('application', 'host_type', 'host_id'), name='netbox_map_applicationdeployment_unique_app_host'),
        ),
        migrations.AddIndex(
            model_name='applicationdeployment',
            index=models.Index(fields=['host_type', 'host_id'], name='netbox_map_appdeploy_host_idx'),
        ),
        migrations.CreateModel(
            name='ApplicationDependency',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False)),
                ('created', models.DateTimeField(auto_now_add=True, null=True)),
                ('last_updated', models.DateTimeField(auto_now=True, null=True)),
                ('custom_field_data', models.JSONField(blank=True, default=dict)),
                ('source_application', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='dependencies', to='netbox_map.application')),
                ('target_application', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='dependents', to='netbox_map.application')),
                ('dependency_type', models.CharField(default='hard', max_length=30)),
                ('protocol', models.CharField(blank=True, default='', max_length=30)),
                ('port', models.PositiveIntegerField(blank=True, null=True, validators=[django.core.validators.MinValueValidator(1), django.core.validators.MaxValueValidator(65535)])),
                ('status', models.CharField(default='active', max_length=30)),
                ('description', models.CharField(blank=True, max_length=500)),
                ('tags', models.ManyToManyField(blank=True, related_name='+', to='extras.tag')),
            ],
            options={
                'verbose_name': 'application dependency',
                'verbose_name_plural': 'application dependencies',
                'ordering': ('source_application', 'target_application'),
            },
        ),
        migrations.AddConstraint(
            model_name='applicationdependency',
            constraint=models.UniqueConstraint(fields=('source_application', 'target_application'), name='netbox_map_applicationdependency_unique_dep'),
        ),
    ]
