from django.contrib.contenttypes.fields import GenericForeignKey
from django.contrib.contenttypes.models import ContentType
from django.db import models
from django.urls import reverse
from django.core.validators import MinValueValidator, MaxValueValidator
from django.utils.translation import gettext_lazy as _

from netbox.models import NetBoxModel
from .choices import FloorPlanTileStatusChoices, FloorPlanTileTypeChoices

# Object types that can be linked to floor plan tiles
ASSIGNABLE_MODELS = (
    'dcim.device',
    'dcim.rack',
    'dcim.powerpanel',
    'dcim.powerfeed',
)


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
        choices=FloorPlanTileTypeChoices,
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

    @property
    def assigned_object_type_name(self):
        """Human-readable name of the assigned object type."""
        if self.assigned_object_type:
            return self.assigned_object_type.model_class()._meta.verbose_name.title()
        return None
