"""
Placeholder migration — the actual table creation is in 0017.

This file exists so that users who created merge migrations referencing
'0016_topologysavedview' (from v0.9.0) don't get NodeNotFoundError.
It does nothing — the real work is in 0017 with IF NOT EXISTS safety.
"""
from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('netbox_map', '0015_cablepath_cable_type'),
    ]

    operations = [
        # No-op — 0017 handles the actual table creation
    ]
