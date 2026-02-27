from django.contrib.contenttypes.fields import GenericForeignKey
from django.contrib.contenttypes.models import ContentType
from django.core.exceptions import ValidationError
from django.db import models
from django.urls import reverse
from django.core.validators import MinValueValidator, MaxValueValidator, RegexValidator
from django.utils.text import slugify
from django.utils.translation import gettext_lazy as _

from netbox.models import NetBoxModel
from .choices import (
    FloorPlanTileStatusChoices, FloorPlanTileTypeChoices,
    BUILTIN_TYPE_SLUGS, get_tile_type_display,
)

# Object types that can be linked to floor plan tiles
ASSIGNABLE_MODELS = (
    'dcim.device',
    'dcim.rack',
    'dcim.powerpanel',
    'dcim.powerfeed',
    'dcim.rearport',
    'dcim.frontport',
)


class CustomMarkerType(NetBoxModel):
    """User-defined marker/tile type with custom color and icon."""
    name = models.CharField(
        verbose_name=_('name'),
        max_length=100,
        unique=True,
    )
    slug = models.CharField(
        verbose_name=_('slug'),
        max_length=50,
        unique=True,
        validators=[
            RegexValidator(
                regex=r'^custom_[a-z0-9_]+$',
                message=_('Slug must start with "custom_" and contain only lowercase letters, numbers, and underscores.'),
            ),
        ],
        help_text=_('Auto-prefixed with "custom_". Used as tile_type/marker_type value.'),
    )
    color = models.CharField(
        verbose_name=_('color'),
        max_length=7,
        default='#ff5733',
        validators=[
            RegexValidator(
                regex=r'^#[0-9a-fA-F]{6}$',
                message=_('Enter a valid hex color (e.g. #ff5733).'),
            ),
        ],
        help_text=_('Hex color code (e.g. #ff5733)'),
    )
    icon = models.CharField(
        verbose_name=_('icon'),
        max_length=100,
        default='mdi-shape',
        help_text=_('MDI icon class (e.g. mdi-server-network)'),
    )
    description = models.CharField(
        verbose_name=_('description'),
        max_length=200,
        blank=True,
    )

    clone_fields = ('color', 'icon')

    class Meta:
        ordering = ('name',)
        verbose_name = _('custom marker type')
        verbose_name_plural = _('custom marker types')

    def __str__(self):
        return self.name

    def get_absolute_url(self):
        return reverse('plugins:netbox_map:custommarkertype', args=[self.pk])

    def clean(self):
        super().clean()
        if self.slug and not self.slug.startswith('custom_'):
            self.slug = f'custom_{self.slug}'
        if self.slug in BUILTIN_TYPE_SLUGS:
            raise ValidationError({'slug': _('This slug conflicts with a built-in type.')})

    def save(self, *args, **kwargs):
        if not self.slug:
            self.slug = f'custom_{slugify(self.name).replace("-", "_")}'
        if not self.slug.startswith('custom_'):
            self.slug = f'custom_{self.slug}'
        super().save(*args, **kwargs)


class FloorPlan(NetBoxModel):
    site = models.ForeignKey(
        to='dcim.Site',
        on_delete=models.CASCADE,
        related_name='floorplans'
    )
    location = models.ForeignKey(
        to='dcim.Location',
        on_delete=models.SET_NULL,
        related_name='floorplans',
        blank=True,
        null=True
    )
    name = models.CharField(
        verbose_name=_('name'),
        max_length=200
    )
    grid_width = models.PositiveIntegerField(
        verbose_name=_('grid width'),
        default=20,
        validators=[MinValueValidator(1), MaxValueValidator(1000)],
        help_text=_('Width of the grid in tiles')
    )
    grid_height = models.PositiveIntegerField(
        verbose_name=_('grid height'),
        default=20,
        validators=[MinValueValidator(1), MaxValueValidator(1000)],
        help_text=_('Height of the grid in tiles')
    )
    tile_size = models.PositiveIntegerField(
        verbose_name=_('tile size'),
        default=60,
        validators=[MinValueValidator(5), MaxValueValidator(200)],
        help_text=_('Size of each tile in pixels for rendering')
    )
    background_image = models.ImageField(
        upload_to='floorplan-backgrounds/',
        blank=True,
        null=True,
        verbose_name=_('background image')
    )
    description = models.CharField(
        verbose_name=_('description'),
        max_length=200,
        blank=True
    )
    comments = models.TextField(
        verbose_name=_('comments'),
        blank=True
    )

    clone_fields = (
        'site', 'location', 'grid_width', 'grid_height', 'tile_size',
    )

    class Meta:
        ordering = ('site', 'name')
        verbose_name = _('floor plan')
        verbose_name_plural = _('floor plans')
        constraints = (
            models.UniqueConstraint(
                fields=('site', 'name'),
                name='%(app_label)s_%(class)s_unique_site_name'
            ),
        )

    def __str__(self):
        return f'{self.name} ({self.site})'

    def get_absolute_url(self):
        return reverse('plugins:netbox_map:floorplan', args=[self.pk])


class FloorPlanTile(NetBoxModel):
    floorplan = models.ForeignKey(
        to='netbox_map.FloorPlan',
        on_delete=models.CASCADE,
        related_name='tiles'
    )
    x_position = models.PositiveIntegerField(
        verbose_name=_('X position'),
        help_text=_('X coordinate on the grid (0-indexed)')
    )
    y_position = models.PositiveIntegerField(
        verbose_name=_('Y position'),
        help_text=_('Y coordinate on the grid (0-indexed)')
    )
    width = models.PositiveIntegerField(
        verbose_name=_('width'),
        default=1,
        validators=[MinValueValidator(1), MaxValueValidator(10)],
        help_text=_('Width in grid cells')
    )
    height = models.PositiveIntegerField(
        verbose_name=_('height'),
        default=1,
        validators=[MinValueValidator(1), MaxValueValidator(10)],
        help_text=_('Height in grid cells')
    )

    # Generic object assignment (Rack, Device, PowerPanel, PowerFeed, etc.)
    assigned_object_type = models.ForeignKey(
        to=ContentType,
        on_delete=models.SET_NULL,
        related_name='+',
        blank=True,
        null=True,
        help_text=_('Type of assigned object')
    )
    assigned_object_id = models.PositiveBigIntegerField(
        blank=True,
        null=True,
        help_text=_('ID of assigned object')
    )
    assigned_object = GenericForeignKey(
        ct_field='assigned_object_type',
        fk_field='assigned_object_id'
    )

    label = models.CharField(
        verbose_name=_('label'),
        max_length=100,
        blank=True,
        help_text=_('Custom label (overrides assigned object name)')
    )
    tile_type = models.CharField(
        verbose_name=_('tile type'),
        max_length=50,
        default=FloorPlanTileTypeChoices.TYPE_RACK
    )
    status = models.CharField(
        verbose_name=_('status'),
        max_length=50,
        choices=FloorPlanTileStatusChoices,
        default=FloorPlanTileStatusChoices.STATUS_ACTIVE
    )
    orientation = models.PositiveSmallIntegerField(
        verbose_name=_('orientation'),
        default=0,
        help_text=_('Rotation in degrees (0, 90, 180, 270)')
    )

    # Floor plan link (for floorplan_link tile type)
    linked_floorplan = models.ForeignKey(
        to='netbox_map.FloorPlan',
        on_delete=models.SET_NULL,
        related_name='linked_tiles',
        blank=True,
        null=True,
        verbose_name=_('linked floor plan'),
        help_text=_('Floor plan to navigate to when this tile is clicked')
    )

    # Camera FOV fields
    fov_direction = models.PositiveSmallIntegerField(
        verbose_name=_('FOV direction'),
        default=0,
        validators=[MinValueValidator(0), MaxValueValidator(360)],
        help_text=_('Camera viewing direction in degrees (0=north, 90=east, 180=south, 270=west)')
    )
    fov_angle = models.PositiveSmallIntegerField(
        verbose_name=_('FOV angle'),
        default=90,
        validators=[MinValueValidator(10), MaxValueValidator(360)],
        help_text=_('Camera field of view width in degrees')
    )
    fov_distance = models.PositiveSmallIntegerField(
        verbose_name=_('FOV distance'),
        default=5,
        validators=[MinValueValidator(1), MaxValueValidator(50)],
        help_text=_('Camera view distance in grid cells')
    )

    clone_fields = (
        'floorplan', 'width', 'height', 'tile_type', 'status', 'orientation',
        'fov_direction', 'fov_angle', 'fov_distance',
    )

    class Meta:
        ordering = ('floorplan', 'y_position', 'x_position')
        verbose_name = _('floor plan tile')
        verbose_name_plural = _('floor plan tiles')
        constraints = (
            models.UniqueConstraint(
                fields=('floorplan', 'x_position', 'y_position'),
                name='%(app_label)s_%(class)s_unique_position'
            ),
        )
        indexes = [
            models.Index(fields=['assigned_object_type', 'assigned_object_id']),
        ]

    def __str__(self):
        if self.assigned_object:
            return f'{self.assigned_object} @ ({self.x_position}, {self.y_position})'
        return f'{self.label or self.tile_type} @ ({self.x_position}, {self.y_position})'

    def get_absolute_url(self):
        return reverse('plugins:netbox_map:floorplantile', args=[self.pk])

    def get_tile_type_display(self):
        return get_tile_type_display(self.tile_type)

    def clean(self):
        super().clean()
        if self.tile_type and self.tile_type not in BUILTIN_TYPE_SLUGS:
            if not CustomMarkerType.objects.filter(slug=self.tile_type).exists():
                raise ValidationError({'tile_type': _(f'Unknown tile type: {self.tile_type}')})

    @property
    def display_label(self):
        if self.label:
            return self.label
        if self.assigned_object:
            return str(self.assigned_object)
        return self.get_tile_type_display()

    @property
    def assigned_object_url(self):
        if self.assigned_object and hasattr(self.assigned_object, 'get_absolute_url'):
            return self.assigned_object.get_absolute_url()
        return None

    @property
    def utilization(self):
        """Return rack utilization if a Rack is assigned."""
        if self.assigned_object_type and self.assigned_object_type.model == 'rack' and self.assigned_object:
            return self.assigned_object.get_utilization()
        return None

    # Optional geographic coordinates for placement on the global site map.
    # These coexist with x_position/y_position which remain for the floor plan canvas.
    latitude = models.DecimalField(
        max_digits=8,
        decimal_places=6,
        blank=True,
        null=True,
        verbose_name=_('latitude'),
        help_text=_('Latitude for global map placement (-90 to 90)')
    )
    longitude = models.DecimalField(
        max_digits=9,
        decimal_places=6,
        blank=True,
        null=True,
        verbose_name=_('longitude'),
        help_text=_('Longitude for global map placement (-180 to 180)')
    )

    @property
    def assigned_object_type_name(self):
        """Human-readable name of the assigned object type."""
        if self.assigned_object_type:
            return self.assigned_object_type.model_class()._meta.verbose_name.title()
        return None


class LocationCoordinates(NetBoxModel):
    """Stores geographic coordinates for a dcim.Location (which lacks lat/lng in core)."""
    location = models.OneToOneField(
        to='dcim.Location',
        on_delete=models.CASCADE,
        related_name='coordinates'
    )
    latitude = models.DecimalField(
        max_digits=8,
        decimal_places=6,
        verbose_name=_('latitude'),
        help_text=_('Latitude (-90 to 90)')
    )
    longitude = models.DecimalField(
        max_digits=9,
        decimal_places=6,
        verbose_name=_('longitude'),
        help_text=_('Longitude (-180 to 180)')
    )

    class Meta:
        ordering = ('location',)
        verbose_name = _('location coordinates')
        verbose_name_plural = _('location coordinates')

    def __str__(self):
        return f'{self.location} ({self.latitude}, {self.longitude})'

    def get_absolute_url(self):
        return reverse('plugins:netbox_map:locationcoordinates', args=[self.pk])


class MapMarker(NetBoxModel):
    """Standalone marker on the global site map (not linked to a floor plan)."""
    latitude = models.DecimalField(
        max_digits=8,
        decimal_places=6,
        verbose_name=_('latitude'),
        help_text=_('Latitude (-90 to 90)')
    )
    longitude = models.DecimalField(
        max_digits=9,
        decimal_places=6,
        verbose_name=_('longitude'),
        help_text=_('Longitude (-180 to 180)')
    )
    label = models.CharField(
        verbose_name=_('label'),
        max_length=100,
        blank=True,
        help_text=_('Display label for this marker')
    )
    marker_type = models.CharField(
        verbose_name=_('marker type'),
        max_length=50,
        default=FloorPlanTileTypeChoices.TYPE_CAMERA
    )
    status = models.CharField(
        verbose_name=_('status'),
        max_length=50,
        choices=FloorPlanTileStatusChoices,
        default=FloorPlanTileStatusChoices.STATUS_ACTIVE
    )
    site = models.ForeignKey(
        to='dcim.Site',
        on_delete=models.SET_NULL,
        related_name='map_markers',
        blank=True,
        null=True,
    )

    # Camera FOV fields
    fov_direction = models.PositiveSmallIntegerField(
        verbose_name=_('FOV direction'),
        default=0,
        validators=[MinValueValidator(0), MaxValueValidator(360)],
        help_text=_('Camera viewing direction in degrees (0=north, 90=east)')
    )
    fov_angle = models.PositiveSmallIntegerField(
        verbose_name=_('FOV angle'),
        default=90,
        validators=[MinValueValidator(10), MaxValueValidator(360)],
        help_text=_('Camera field of view width in degrees')
    )
    fov_distance = models.PositiveSmallIntegerField(
        verbose_name=_('FOV distance'),
        default=5,
        validators=[MinValueValidator(1), MaxValueValidator(50)],
        help_text=_('Camera view distance (1 unit ≈ 50m)')
    )

    # Generic object assignment
    assigned_object_type = models.ForeignKey(
        to=ContentType,
        on_delete=models.SET_NULL,
        related_name='+',
        blank=True,
        null=True,
        help_text=_('Type of assigned object')
    )
    assigned_object_id = models.PositiveBigIntegerField(
        blank=True,
        null=True,
        help_text=_('ID of assigned object')
    )
    assigned_object = GenericForeignKey(
        ct_field='assigned_object_type',
        fk_field='assigned_object_id'
    )

    description = models.CharField(
        verbose_name=_('description'),
        max_length=200,
        blank=True
    )

    clone_fields = (
        'marker_type', 'status', 'site', 'fov_direction', 'fov_angle', 'fov_distance',
    )

    class Meta:
        ordering = ('label',)
        verbose_name = _('map marker')
        verbose_name_plural = _('map markers')
        indexes = [
            models.Index(fields=['assigned_object_type', 'assigned_object_id']),
        ]

    def get_marker_type_display(self):
        return get_tile_type_display(self.marker_type)

    def clean(self):
        super().clean()
        if self.marker_type and self.marker_type not in BUILTIN_TYPE_SLUGS:
            if not CustomMarkerType.objects.filter(slug=self.marker_type).exists():
                raise ValidationError({'marker_type': _(f'Unknown marker type: {self.marker_type}')})

    def __str__(self):
        return self.label or f'{self.get_marker_type_display()} ({self.latitude}, {self.longitude})'

    def get_absolute_url(self):
        return reverse('plugins:netbox_map:mapmarker', args=[self.pk])

    @property
    def display_label(self):
        if self.label:
            return self.label
        if self.assigned_object:
            return str(self.assigned_object)
        return self.get_marker_type_display()


class MapSettings(models.Model):
    """Singleton model for map detail panel & GPS sync configuration."""

    # ── Toggles ──
    show_mac = models.BooleanField(
        default=True,
        verbose_name=_('Show MAC Address'),
        help_text=_('Display MAC address for devices in the detail panel'),
    )
    show_custom_fields = models.BooleanField(
        default=True,
        verbose_name=_('Show Custom Fields'),
        help_text=_('Display custom fields in the detail panel'),
    )
    sync_device_gps = models.BooleanField(
        default=True,
        verbose_name=_('Sync Device GPS'),
        help_text=_('Automatically update device latitude/longitude when placed on a map'),
    )

    # ── Per-object-type field lists ──
    device_fields = models.JSONField(
        default=list,
        verbose_name=_('Device Fields'),
        help_text=_('Standard fields to show for devices'),
    )
    rack_fields = models.JSONField(
        default=list,
        verbose_name=_('Rack Fields'),
        help_text=_('Standard fields to show for racks'),
    )
    powerpanel_fields = models.JSONField(
        default=list,
        verbose_name=_('Power Panel Fields'),
        help_text=_('Standard fields to show for power panels'),
    )
    powerfeed_fields = models.JSONField(
        default=list,
        verbose_name=_('Power Feed Fields'),
        help_text=_('Standard fields to show for power feeds'),
    )
    popover_fields = models.JSONField(
        default=list,
        verbose_name=_('Popover Fields'),
        help_text=_('Fields to display in the hover popover on the floor plan'),
    )
    tile_popover_config = models.JSONField(
        default=dict,
        verbose_name=_('Tile Popover Configuration'),
        help_text=_('Per-tile-type popover field configuration'),
    )

    class Meta:
        verbose_name = _('Map Settings')
        verbose_name_plural = _('Map Settings')

    def __str__(self):
        return 'Map Settings'

    @classmethod
    def load(cls):
        obj, created = cls.objects.get_or_create(pk=1)
        if created:
            obj.device_fields = [
                'status', 'role', 'device_type', 'platform', 'serial', 'asset_tag', 'tenant',
            ]
            obj.rack_fields = [
                'status', 'role', 'facility_id', 'serial', 'asset_tag', 'u_height',
            ]
            obj.powerpanel_fields = ['site', 'location']
            obj.powerfeed_fields = ['status', 'type', 'supply', 'voltage', 'amperage']
            obj.popover_fields = ['label', 'object_info', 'primary_ip', 'utilization', 'position', 'size']
            default_popover = list(obj.popover_fields)
            obj.tile_popover_config = {
                t: list(default_popover) for t in [
                    'rack', 'aisle', 'wall', 'column', 'door',
                    'cooling', 'power', 'empty', 'reserved',
                    'ap', 'camera', 'printer', 'floorplan_link',
                ]
            }
            obj.save()
        return obj
