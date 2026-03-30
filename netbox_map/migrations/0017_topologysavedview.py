import django.db.models.deletion
from django.db import migrations, models
import utilities.json


class Migration(migrations.Migration):

    dependencies = [
        ('dcim', '0001_initial'),
        ('extras', '0001_initial'),
        ('netbox_map', '0016_topologysavedview'),
    ]

    operations = [
        # Use RunSQL so we can use IF NOT EXISTS for safe upgrades
        # This handles both fresh installs AND v0.9.0 upgraders who already have the table
        migrations.RunSQL(
            sql="""
                CREATE TABLE IF NOT EXISTS "netbox_map_topologysavedview" (
                    "id" bigserial NOT NULL PRIMARY KEY,
                    "created" timestamp with time zone NULL,
                    "last_updated" timestamp with time zone NULL,
                    "custom_field_data" jsonb NOT NULL DEFAULT '{}'::jsonb,
                    "name" varchar(200) NOT NULL,
                    "description" varchar(500) NOT NULL DEFAULT '',
                    "filters" jsonb NOT NULL DEFAULT '{}'::jsonb,
                    "layout_data" jsonb NOT NULL DEFAULT '{}'::jsonb,
                    "view_mode" varchar(20) NOT NULL DEFAULT 'stencil',
                    "site_id" bigint NULL REFERENCES "dcim_site" ("id") ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED
                );
                CREATE INDEX IF NOT EXISTS "netbox_map_topologysavedview_site_id"
                    ON "netbox_map_topologysavedview" ("site_id");
            """,
            reverse_sql='DROP TABLE IF EXISTS "netbox_map_topologysavedview";',
            state_operations=[
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
            ],
        ),
        # Tags M2M table
        migrations.RunSQL(
            sql="""
                CREATE TABLE IF NOT EXISTS "netbox_map_topologysavedview_tags" (
                    "id" bigserial NOT NULL PRIMARY KEY,
                    "topologysavedview_id" bigint NOT NULL REFERENCES "netbox_map_topologysavedview" ("id") ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
                    "tag_id" bigint NOT NULL REFERENCES "extras_tag" ("id") ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED
                );
                CREATE UNIQUE INDEX IF NOT EXISTS "netbox_map_topologysavedview_tags_uniq"
                    ON "netbox_map_topologysavedview_tags" ("topologysavedview_id", "tag_id");
            """,
            reverse_sql='DROP TABLE IF EXISTS "netbox_map_topologysavedview_tags";',
        ),
        # Unique constraint on name
        migrations.RunSQL(
            sql="""
                DO $$
                BEGIN
                    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'unique_topology_view_name') THEN
                        ALTER TABLE "netbox_map_topologysavedview"
                            ADD CONSTRAINT "unique_topology_view_name" UNIQUE ("name");
                    END IF;
                END $$;
            """,
            reverse_sql='ALTER TABLE "netbox_map_topologysavedview" DROP CONSTRAINT IF EXISTS "unique_topology_view_name";',
            state_operations=[
                migrations.AddConstraint(
                    model_name='topologysavedview',
                    constraint=models.UniqueConstraint(fields=('name',), name='unique_topology_view_name'),
                ),
            ],
        ),
    ]
