import django.core.validators
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('netbox_map', '0013_cablepath'),
    ]

    operations = [
        migrations.AddField(
            model_name='cablepath',
            name='color',
            field=models.CharField(
                blank=True,
                help_text='Hex color override (blank = use status color)',
                max_length=7,
                validators=[
                    django.core.validators.RegexValidator(
                        message='Enter a valid hex color (e.g. #ff5733).',
                        regex='^#[0-9a-fA-F]{6}$',
                    ),
                ],
                verbose_name='color',
            ),
        ),
        migrations.AddField(
            model_name='cablepath',
            name='weight',
            field=models.PositiveSmallIntegerField(
                default=3,
                help_text='Line thickness on the map (1-10)',
                validators=[
                    django.core.validators.MinValueValidator(1),
                    django.core.validators.MaxValueValidator(10),
                ],
                verbose_name='line weight',
            ),
        ),
    ]
