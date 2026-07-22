from dcim.choices import CableTypeChoices
from dcim.models import Device, FrontPort, PowerFeed, PowerPanel, Rack, RearPort
from django.contrib.contenttypes.fields import GenericForeignKey
from django.contrib.contenttypes.models import ContentType
from django.contrib.contenttypes.prefetch import GenericPrefetch
from django.core.exceptions import ValidationError
from django.core.validators import MaxValueValidator, MinValueValidator, RegexValidator
from django.db import models
from django.urls import reverse
from django.utils.text import slugify
from django.utils.translation import gettext_lazy as _

try:
    from extras.managers import NetBoxTaggableManager as _NetBoxTaggableManager
    _TAGGABLE_MANAGER_KWARGS = {'manager': _NetBoxTaggableManager, 'ordering': ('weight', 'name')}
except ImportError:
    _TAGGABLE_MANAGER_KWARGS = {'ordering': ('weight', 'name')}
from netbox.models import NetBoxModel
from taggit.managers import TaggableManager

from .choices import (
    BUILTIN_TYPE_SLUGS,
    STRUCTURAL_TILE_TYPES,
    ApplicationCriticalityChoices,
    ApplicationEnvironmentChoices,
    ApplicationStatusChoices,
    CablePathStatusChoices,
    DependencyProtocolChoices,
    DependencyTypeChoices,
    DeploymentRoleChoices,
    FloorPlanTileStatusChoices,
    FloorPlanTileTypeChoices,
    get_tile_type_display,
)

# Largest a FloorPlanTile's width/height (in grid cells) is allowed to be.
# Single source of truth — also surfaced to the frontend as
# data-tile-max-size on the floorplan container (see FloorPlanVisualizationView
# and floorplan_core.js's parseConfig()) so the create/resize forms and
# mouse-driven resize all enforce the same limit as this validator.
TILE_MAX_SIZE = 1000

# Object types that can be linked to floor plan tiles
ASSIGNABLE_MODELS = (
    'dcim.device',
    'dcim.rack',
    'dcim.powerpanel',
    'dcim.powerfeed',
    'dcim.rearport',
    'dcim.frontport',
)


def tile_assigned_object_prefetch():
    """GenericPrefetch for FloorPlanTile.assigned_object, covering every
    model in ASSIGNABLE_MODELS. Without this, accessing .assigned_object
    on a GenericForeignKey issues one query per tile (N+1) since
    select_related() can't traverse a generic relation."""
    return GenericPrefetch('assigned_object', [
        Device.objects.select_related('primary_ip4', 'primary_ip6'),
        Rack.objects.all(),
        PowerPanel.objects.all(),
        PowerFeed.objects.all(),
        RearPort.objects.all(),
        FrontPort.objects.all(),
    ])


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
                message=_(
                    'Slug must start with "custom_" and contain only lowercase letters, numbers, and underscores.'
                ),
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
        validators=[
            RegexValidator(
                regex=r'^mdi-[a-z0-9-]+$',
                message=_('Enter a valid MDI icon class (e.g. mdi-server-network).'),
            ),
        ],
        help_text=_('MDI icon class (e.g. mdi-server-network)'),
    )
    # Light or dark icon foreground. `auto` picks based on background luma —
    # the right default for most users; the explicit options exist for cases
    # where the contrast heuristic looks off.
    ICON_FG_AUTO = 'auto'
    ICON_FG_LIGHT = 'light'
    ICON_FG_DARK = 'dark'
    ICON_FG_CHOICES = (
        (ICON_FG_AUTO, _('Auto (contrast with background)')),
        (ICON_FG_LIGHT, _('Light (white)')),
        (ICON_FG_DARK, _('Dark (black)')),
    )
    icon_foreground = models.CharField(
        verbose_name=_('icon color'),
        max_length=10,
        choices=ICON_FG_CHOICES,
        default=ICON_FG_AUTO,
        help_text=_(
            'Icon color on top of the background. "Auto" picks light or '
            'dark based on the background brightness.'
        ),
    )
    description = models.CharField(
        verbose_name=_('description'),
        max_length=200,
        blank=True,
    )

    clone_fields = ('color', 'icon', 'icon_foreground')

    def resolved_icon_foreground(self):
        """Resolve `auto` to an actual `light` or `dark` based on background luma."""
        if self.icon_foreground != self.ICON_FG_AUTO:
            return self.icon_foreground
        c = (self.color or '').lstrip('#')
        if len(c) != 6:
            return self.ICON_FG_LIGHT
        try:
            r = int(c[0:2], 16)
            g = int(c[2:4], 16)
            b = int(c[4:6], 16)
        except ValueError:
            return self.ICON_FG_LIGHT
        # Standard relative luminance — anything <128 is "dark" enough to
        # warrant white text.
        luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
        return self.ICON_FG_DARK if luma > 160 else self.ICON_FG_LIGHT

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
    # #67 — FileField (not ImageField) so PDFs can be uploaded too.
    # PDF uploads are rasterized to PNG at form-clean time (see
    # FloorPlanForm.clean_background_image) before they ever hit storage,
    # so anything stored on disk is always a raster image the renderer
    # already understands.
    background_image = models.FileField(
        upload_to='floorplan-backgrounds/',
        blank=True,
        null=True,
        verbose_name=_('background image'),
        help_text=_('PNG, JPEG, GIF, WEBP or PDF. PDFs are rasterized at upload (page 1).'),
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
    tags = TaggableManager(
        through='extras.TaggedItem',
        related_name='netbox_map_floorplan_set',
        **_TAGGABLE_MANAGER_KWARGS,
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
        validators=[MinValueValidator(1), MaxValueValidator(TILE_MAX_SIZE)],
        help_text=_('Width in grid cells')
    )
    height = models.PositiveIntegerField(
        verbose_name=_('height'),
        default=1,
        validators=[MinValueValidator(1), MaxValueValidator(TILE_MAX_SIZE)],
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
        if self.tile_type in STRUCTURAL_TILE_TYPES and self.assigned_object_type_id:
            raise ValidationError({
                'assigned_object_type': _(
                    '%(type)s tiles are architectural markers and cannot have an assigned object.'
                ) % {'type': self.get_tile_type_display()}
            })

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


class TilePortAssignment(NetBoxModel):
    """Maps a FloorPlanTile (drop tile) to a FrontPort or RearPort."""
    tile = models.ForeignKey(
        to='netbox_map.FloorPlanTile',
        on_delete=models.CASCADE,
        related_name='port_assignments',
    )
    port_type = models.ForeignKey(
        to=ContentType,
        on_delete=models.CASCADE,
        limit_choices_to={'app_label': 'dcim', 'model__in': ['frontport', 'rearport']},
    )
    port_id = models.PositiveBigIntegerField()
    port = GenericForeignKey(ct_field='port_type', fk_field='port_id')

    class Meta:
        ordering = ('tile', 'port_type', 'port_id')
        verbose_name = _('tile port assignment')
        verbose_name_plural = _('tile port assignments')
        constraints = (
            models.UniqueConstraint(
                fields=('tile', 'port_type', 'port_id'),
                name='%(app_label)s_%(class)s_unique_tile_port'
            ),
        )
        indexes = [
            models.Index(fields=['port_type', 'port_id']),
        ]

    def __str__(self):
        return f'{self.port} on {self.tile}'

    def get_absolute_url(self):
        return self.tile.get_absolute_url()

    def clean(self):
        super().clean()
        if self.tile_id and self.tile.tile_type != 'drop':
            raise ValidationError(
                _('Port assignments can only be added to drop tiles.')
            )


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
        return self.location.get_absolute_url()


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


class CablePath(NetBoxModel):
    """A fiber/cable path drawn on the global site map."""
    label = models.CharField(
        verbose_name=_('label'),
        max_length=200,
        blank=True,
    )
    path_coordinates = models.JSONField(
        default=list,
        verbose_name=_('path coordinates'),
        help_text=_('Array of [lat, lng] coordinate pairs'),
    )
    fiber_count = models.PositiveIntegerField(
        verbose_name=_('fiber count'),
        default=12,
    )
    cable_type = models.CharField(
        max_length=50,
        choices=CableTypeChoices,
        blank=True,
        default='',
        verbose_name=_('cable type'),
    )
    start_marker = models.ForeignKey(
        to='netbox_map.MapMarker',
        on_delete=models.SET_NULL,
        related_name='cables_from',
        blank=True,
        null=True,
        verbose_name=_('start marker'),
    )
    end_marker = models.ForeignKey(
        to='netbox_map.MapMarker',
        on_delete=models.SET_NULL,
        related_name='cables_to',
        blank=True,
        null=True,
        verbose_name=_('end marker'),
    )
    status = models.CharField(
        verbose_name=_('status'),
        max_length=50,
        choices=CablePathStatusChoices,
        default=CablePathStatusChoices.STATUS_PLANNED,
    )
    color = models.CharField(
        max_length=7,
        blank=True,
        verbose_name=_('color'),
        help_text=_('Hex color override (blank = use status color)'),
        validators=[
            RegexValidator(
                regex=r'^#[0-9a-fA-F]{6}$',
                message=_('Enter a valid hex color (e.g. #ff5733).'),
            ),
        ],
    )
    weight = models.PositiveSmallIntegerField(
        default=3,
        verbose_name=_('line weight'),
        validators=[MinValueValidator(1), MaxValueValidator(10)],
        help_text=_('Line thickness on the map (1-10)'),
    )

    clone_fields = ('fiber_count', 'cable_type', 'status', 'color', 'weight')

    class Meta:
        ordering = ('label',)
        verbose_name = _('cable path')
        verbose_name_plural = _('cable paths')

    def __str__(self):
        if self.label:
            return self.label
        parts = []
        if self.start_marker:
            parts.append(str(self.start_marker))
        if self.end_marker:
            parts.append(str(self.end_marker))
        if parts:
            return ' \u2192 '.join(parts)
        return f'Cable Path #{self.pk}'

    def get_absolute_url(self):
        return reverse('plugins:netbox_map:cablepath', args=[self.pk])

    def get_status_color(self):
        """Return the status-based color (without considering the color override)."""
        return {
            'planned': '#95a5a6',
            'in_progress': '#f39c12',
            'active': '#2ecc71',
            'inactive': '#e74c3c',
        }.get(self.status, '#95a5a6')

    def get_display_color(self):
        """Return the effective display color: custom override or status-based."""
        if self.color:
            return self.color
        return self.get_status_color()


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

    # #65 — Site Map: load empty by default. On instances with thousands of
    # sites, loading them all blows the browser; admins can flip this on so
    # the Site Map starts blank and only renders sites once a filter is set.
    site_map_load_empty = models.BooleanField(
        default=False,
        verbose_name=_('Site Map — Load Empty'),
        help_text=_(
            'Start the Site Map with no markers. Sites only appear once a '
            'region/group/tenant/tag filter is applied. Recommended for '
            'instances with thousands of sites.'
        ),
    )

    # #63 — Tile type slugs hidden from the floor-plan editor toolbar.
    # IMPORTANT: existing installs default to [] (nothing hidden) — fiber
    # types stay visible for anyone already using them. Fresh installs get
    # DEFAULT_HIDDEN_TILE_TYPES seeded on first MapSettings.load() so they
    # don't see 9 irrelevant FTTH chips by default.
    # Hidden only refers to the EDITOR TOOLBAR — existing tiles of hidden
    # types still render normally on the floor plan.
    hidden_tile_types = models.JSONField(
        default=list,
        blank=True,
        verbose_name=_('Hidden Tile Types (Floor Plan)'),
        help_text=_(
            'Tile-type slugs hidden from the floor-plan editor toolbar. '
            'Existing tiles of these types still render normally — '
            'only the editor chip is hidden.'
        ),
    )
    # #63 — separate visibility list for the Site Map create-chip tray, so
    # admins can show fiber/marker types on the Site Map but not on individual
    # Floor Plans (or vice versa). Defaults to the same defaults as the
    # floor-plan list on fresh installs.
    hidden_tile_types_sitemap = models.JSONField(
        default=list,
        blank=True,
        verbose_name=_('Hidden Tile Types (Site Map)'),
        help_text=_(
            'Tile-type slugs hidden from the Site Map create-chip tray. '
            'Existing markers of these types still render normally.'
        ),
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
            obj.tile_popover_config['drop'] = ['label', 'cable_trace']
            # #63 — hide FTTH/fiber types from the toolbar on fresh installs.
            # Existing installs are not migrated to this default — they keep
            # their empty list so fiber types stay visible if they're using them.
            # Site Map additionally hides floor-plan-only structural types
            # (column / wall / aisle / empty / reserved) since those aren't
            # useful as geographic markers.
            from .choices import DEFAULT_HIDDEN_TILE_TYPES, DEFAULT_HIDDEN_TILE_TYPES_SITEMAP
            obj.hidden_tile_types = list(DEFAULT_HIDDEN_TILE_TYPES)
            obj.hidden_tile_types_sitemap = list(DEFAULT_HIDDEN_TILE_TYPES_SITEMAP)
            obj.save()
        return obj


#
# Topology saved views
#

class TopologySavedView(NetBoxModel):
    """A saved topology view with device positions, hidden nodes, and port overrides."""
    name = models.CharField(max_length=200)
    description = models.CharField(max_length=500, blank=True)
    site = models.ForeignKey(
        'dcim.Site',
        on_delete=models.SET_NULL,
        blank=True,
        null=True,
        related_name='topology_views',
    )
    filters = models.JSONField(default=dict, blank=True)
    layout_data = models.JSONField(default=dict, blank=True)
    view_mode = models.CharField(max_length=20, default='stencil')

    clone_fields = ('site', 'filters', 'layout_data', 'view_mode')

    class Meta:
        ordering = ['name']
        verbose_name = _('Topology Saved View')
        verbose_name_plural = _('Topology Saved Views')
        constraints = [
            models.UniqueConstraint(fields=['name'], name='unique_topology_view_name'),
        ]

    def __str__(self):
        return self.name

    def get_absolute_url(self):
        return reverse('plugins:netbox_map:topologysavedview', args=[self.pk])


#
# Application models
#

class ApplicationGroup(NetBoxModel):
    """Logical grouping of applications."""
    name = models.CharField(max_length=100, unique=True)
    slug = models.SlugField(max_length=100, unique=True)
    color = models.CharField(
        max_length=7, default='#3498db',
        validators=[RegexValidator(regex=r'^#[0-9a-fA-F]{6}$', message=_('Enter a valid hex color.'))],
    )
    description = models.CharField(max_length=200, blank=True)
    # Override tags with explicit related_name to avoid Tag.applicationgroup_set
    # collision with other plugins that also define an ApplicationGroup model.
    tags = TaggableManager(
        through='extras.TaggedItem',
        **_TAGGABLE_MANAGER_KWARGS,
        related_name='netbox_map_applicationgroup_set',
    )

    clone_fields = ('color',)

    class Meta:
        ordering = ('name',)
        verbose_name = _('application group')
        verbose_name_plural = _('application groups')

    def __str__(self):
        return self.name

    def get_absolute_url(self):
        return reverse('plugins:netbox_map:applicationgroup', args=[self.pk])


class ApplicationTemplate(NetBoxModel):
    """Blueprint for creating Application instances when deployed to a host."""
    name = models.CharField(max_length=200)
    slug = models.SlugField(max_length=200, unique=True)
    description = models.TextField(blank=True)
    default_status = models.CharField(
        max_length=50, choices=ApplicationStatusChoices,
        default=ApplicationStatusChoices.STATUS_ACTIVE,
    )
    default_criticality = models.CharField(
        max_length=50, choices=ApplicationCriticalityChoices,
        default=ApplicationCriticalityChoices.CRITICALITY_MEDIUM,
    )
    default_environment = models.CharField(
        max_length=50, choices=ApplicationEnvironmentChoices,
        default=ApplicationEnvironmentChoices.ENV_PRODUCTION,
    )
    default_version = models.CharField(max_length=100, blank=True)
    default_port = models.IntegerField(null=True, blank=True)
    default_protocol = models.CharField(max_length=50, blank=True)
    default_role = models.CharField(
        max_length=50, choices=DeploymentRoleChoices,
        default=DeploymentRoleChoices.ROLE_PRIMARY,
    )
    group = models.ForeignKey(
        'ApplicationGroup', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='templates',
    )
    name_format = models.CharField(
        max_length=200, default='{app}',
        help_text=_('Use {app} for template name, {host} for hostname'),
    )
    # Override tags with explicit related_name to avoid collisions with other plugins.
    tags = TaggableManager(
        through='extras.TaggedItem',
        **_TAGGABLE_MANAGER_KWARGS,
        related_name='netbox_map_applicationtemplate_set',
    )

    class Meta:
        ordering = ['name']
        verbose_name = _('application template')
        verbose_name_plural = _('application templates')

    def __str__(self):
        return self.name

    def get_absolute_url(self):
        return reverse('plugins:netbox_map:applicationtemplate', args=[self.pk])


class Application(NetBoxModel):
    """An application or service deployed in the organization."""
    name = models.CharField(max_length=200)
    status = models.CharField(
        max_length=30, choices=ApplicationStatusChoices,
        default=ApplicationStatusChoices.STATUS_ACTIVE,
    )
    criticality = models.CharField(
        max_length=30, choices=ApplicationCriticalityChoices,
        default=ApplicationCriticalityChoices.CRITICALITY_MEDIUM,
    )
    environment = models.CharField(
        max_length=30, choices=ApplicationEnvironmentChoices,
        default=ApplicationEnvironmentChoices.ENV_PRODUCTION,
    )
    version = models.CharField(max_length=50, blank=True)
    description = models.CharField(max_length=500, blank=True)
    comments = models.TextField(blank=True)
    external_url = models.URLField(max_length=500, blank=True, help_text=_('URL to docs, dashboard, or entry point'))
    default_port = models.IntegerField(null=True, blank=True, help_text=_('Default port this application listens on'))
    default_protocol = models.CharField(
        max_length=50, blank=True, help_text=_('Default protocol (e.g., HTTP, TCP, gRPC)'),
    )
    group = models.ForeignKey(
        'netbox_map.ApplicationGroup', on_delete=models.SET_NULL,
        related_name='applications', blank=True, null=True,
    )
    tenant = models.ForeignKey(
        'tenancy.Tenant', on_delete=models.SET_NULL,
        related_name='+', blank=True, null=True,
    )
    site = models.ForeignKey(
        'dcim.Site', on_delete=models.SET_NULL,
        related_name='+', blank=True, null=True,
    )
    primary_ip = models.ForeignKey(
        'ipam.IPAddress', on_delete=models.SET_NULL,
        related_name='+', blank=True, null=True,
        verbose_name=_('Primary IP'),
        help_text=_('Primary IP address for this application'),
    )
    # Override tags with explicit related_name to avoid Tag.application_set
    # collision with other plugins that also define an Application model
    # (e.g. netbox-security). See issue #42.
    tags = TaggableManager(
        through='extras.TaggedItem',
        **_TAGGABLE_MANAGER_KWARGS,
        related_name='netbox_map_application_set',
    )

    clone_fields = (
        'status', 'criticality', 'environment', 'group', 'tenant', 'site',
        'default_port', 'default_protocol',
    )

    class Meta:
        ordering = ('name',)
        verbose_name = _('application')
        verbose_name_plural = _('applications')
        constraints = [
            models.UniqueConstraint(
                fields=('name', 'environment', 'tenant'),
                name='%(app_label)s_%(class)s_unique_name_env_tenant',
            ),
        ]

    def __str__(self):
        return self.name

    def get_absolute_url(self):
        return reverse('plugins:netbox_map:application', args=[self.pk])


ASSIGNABLE_HOST_MODELS = ('dcim.device', 'virtualization.virtualmachine')


class ApplicationDeployment(NetBoxModel):
    """Links an Application to a Device or VirtualMachine it runs on."""
    application = models.ForeignKey(
        'netbox_map.Application', on_delete=models.CASCADE, related_name='deployments',
    )
    host_type = models.ForeignKey(
        to='contenttypes.ContentType', on_delete=models.PROTECT, related_name='+',
        limit_choices_to={'app_label__in': ['dcim', 'virtualization'], 'model__in': ['device', 'virtualmachine']},
    )
    host_id = models.PositiveBigIntegerField()
    host = GenericForeignKey(ct_field='host_type', fk_field='host_id')
    role = models.CharField(
        max_length=30, choices=DeploymentRoleChoices,
        default=DeploymentRoleChoices.ROLE_PRIMARY,
    )
    port = models.PositiveIntegerField(
        blank=True, null=True, validators=[MinValueValidator(1), MaxValueValidator(65535)],
    )
    protocol = models.CharField(max_length=50, blank=True)
    ip_address = models.ForeignKey(
        'ipam.IPAddress', on_delete=models.SET_NULL,
        related_name='+', blank=True, null=True,
        verbose_name=_('IP Address'),
        help_text=_('IP address this deployment listens on'),
    )
    service = models.ForeignKey(
        'ipam.Service', on_delete=models.SET_NULL,
        related_name='+', blank=True, null=True,
        verbose_name=_('Service'),
        help_text=_('NetBox application service linked to this deployment'),
    )
    description = models.CharField(max_length=200, blank=True)
    # Override tags with explicit related_name to avoid collisions with other plugins.
    tags = TaggableManager(
        through='extras.TaggedItem',
        **_TAGGABLE_MANAGER_KWARGS,
        related_name='netbox_map_applicationdeployment_set',
    )

    clone_fields = ('application', 'role', 'port', 'protocol')

    class Meta:
        ordering = ('application', 'host_type', 'host_id')
        verbose_name = _('application deployment')
        verbose_name_plural = _('application deployments')
        constraints = [
            models.UniqueConstraint(
                fields=('application', 'host_type', 'host_id'),
                name='%(app_label)s_%(class)s_unique_app_host',
            ),
        ]
        indexes = [
            models.Index(fields=['host_type', 'host_id']),
        ]

    def __str__(self):
        return f'{self.application} on {self.host}'

    def get_absolute_url(self):
        return reverse('plugins:netbox_map:applicationdeployment', args=[self.pk])


class ApplicationDependency(NetBoxModel):
    """Directed dependency: source_application depends on target_application."""
    source_application = models.ForeignKey(
        'netbox_map.Application', on_delete=models.CASCADE, related_name='dependencies',
        help_text=_('The application that depends on the target'),
    )
    target_application = models.ForeignKey(
        'netbox_map.Application', on_delete=models.CASCADE, related_name='dependents',
        help_text=_('The application being depended upon'),
    )
    dependency_type = models.CharField(
        max_length=30, choices=DependencyTypeChoices,
        default=DependencyTypeChoices.TYPE_HARD,
    )
    protocol = models.CharField(
        max_length=30, choices=DependencyProtocolChoices, blank=True, default='',
    )
    port = models.PositiveIntegerField(
        blank=True, null=True, validators=[MinValueValidator(1), MaxValueValidator(65535)],
    )
    status = models.CharField(
        max_length=30, choices=ApplicationStatusChoices,
        default=ApplicationStatusChoices.STATUS_ACTIVE,
    )
    description = models.CharField(max_length=500, blank=True)
    # Override tags with explicit related_name to avoid collisions with other plugins.
    tags = TaggableManager(
        through='extras.TaggedItem',
        **_TAGGABLE_MANAGER_KWARGS,
        related_name='netbox_map_applicationdependency_set',
    )

    clone_fields = ('dependency_type', 'protocol', 'port', 'status')

    class Meta:
        ordering = ('source_application', 'target_application')
        verbose_name = _('application dependency')
        verbose_name_plural = _('application dependencies')
        constraints = [
            models.UniqueConstraint(
                fields=('source_application', 'target_application'),
                name='%(app_label)s_%(class)s_unique_dep',
            ),
        ]

    def __str__(self):
        return f'{self.source_application} \u2192 {self.target_application}'

    def get_absolute_url(self):
        return reverse('plugins:netbox_map:applicationdependency', args=[self.pk])

    def clean(self):
        super().clean()
        if self.source_application_id and self.target_application_id:
            if self.source_application_id == self.target_application_id:
                raise ValidationError(_('An application cannot depend on itself.'))
