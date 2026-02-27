import logging

from django.contrib.contenttypes.models import ContentType
from django.db.models import ProtectedError
from django.db.models.signals import post_save, pre_delete, pre_save
from django.dispatch import receiver

from .models import CustomMarkerType, FloorPlanTile, MapMarker

logger = logging.getLogger('netbox.plugins.netbox_map')


def _is_gps_sync_enabled():
    from .models import MapSettings
    try:
        return MapSettings.load().sync_device_gps
    except Exception:
        return True


def _get_device_ct():
    return ContentType.objects.get(app_label='dcim', model='device')


def _sync_device_gps(device_id, latitude, longitude):
    """Write lat/lng to a device using queryset.update() to avoid triggering signals."""
    from dcim.models import Device
    Device.objects.filter(pk=device_id).update(
        latitude=latitude,
        longitude=longitude,
    )


def _clear_device_gps_if_orphaned(device_id, exclude_tile_pk=None, exclude_marker_pk=None):
    """Clear device GPS if no other tiles/markers with coordinates reference it."""
    device_ct = _get_device_ct()

    tiles_qs = FloorPlanTile.objects.filter(
        assigned_object_type=device_ct,
        assigned_object_id=device_id,
        latitude__isnull=False,
        longitude__isnull=False,
    )
    if exclude_tile_pk:
        tiles_qs = tiles_qs.exclude(pk=exclude_tile_pk)

    markers_qs = MapMarker.objects.filter(
        assigned_object_type=device_ct,
        assigned_object_id=device_id,
    )
    if exclude_marker_pk:
        markers_qs = markers_qs.exclude(pk=exclude_marker_pk)

    if not tiles_qs.exists() and not markers_qs.exists():
        _sync_device_gps(device_id, None, None)


# ── Pre-save: capture old assignment for change detection ────────────────────


@receiver(pre_save, sender=FloorPlanTile)
@receiver(pre_save, sender=MapMarker)
def capture_old_assignment(sender, instance, **kwargs):
    if not _is_gps_sync_enabled():
        return
    if instance.pk:
        try:
            old = sender.objects.only(
                'assigned_object_type', 'assigned_object_id', 'latitude', 'longitude'
            ).get(pk=instance.pk)
            instance._old_assigned_object_type_id = old.assigned_object_type_id
            instance._old_assigned_object_id = old.assigned_object_id
        except sender.DoesNotExist:
            instance._old_assigned_object_type_id = None
            instance._old_assigned_object_id = None
    else:
        instance._old_assigned_object_type_id = None
        instance._old_assigned_object_id = None


# ── Post-save: sync GPS to device ───────────────────────────────────────────


@receiver(post_save, sender=FloorPlanTile)
@receiver(post_save, sender=MapMarker)
def sync_gps_on_save(sender, instance, **kwargs):
    if not _is_gps_sync_enabled():
        return

    try:
        device_ct = _get_device_ct()
    except ContentType.DoesNotExist:
        return

    lat = getattr(instance, 'latitude', None)
    lng = getattr(instance, 'longitude', None)

    old_type_id = getattr(instance, '_old_assigned_object_type_id', None)
    old_obj_id = getattr(instance, '_old_assigned_object_id', None)

    new_type_id = instance.assigned_object_type_id
    new_obj_id = instance.assigned_object_id

    # If old device was different from new, clear old device's GPS (if orphaned)
    if old_obj_id and old_type_id == device_ct.pk and old_obj_id != new_obj_id:
        _clear_device_gps_if_orphaned(old_obj_id)

    # Set GPS on new device (if we have coordinates)
    if new_obj_id and new_type_id == device_ct.pk and lat is not None and lng is not None:
        _sync_device_gps(new_obj_id, lat, lng)


# ── Pre-delete: clear GPS if device becomes orphaned ────────────────────────


@receiver(pre_delete, sender=FloorPlanTile)
def clear_gps_on_tile_delete(sender, instance, **kwargs):
    if not _is_gps_sync_enabled():
        return

    try:
        device_ct = _get_device_ct()
    except ContentType.DoesNotExist:
        return

    if instance.assigned_object_type_id != device_ct.pk or not instance.assigned_object_id:
        return

    _clear_device_gps_if_orphaned(
        instance.assigned_object_id,
        exclude_tile_pk=instance.pk,
    )


@receiver(pre_delete, sender=MapMarker)
def clear_gps_on_marker_delete(sender, instance, **kwargs):
    if not _is_gps_sync_enabled():
        return

    try:
        device_ct = _get_device_ct()
    except ContentType.DoesNotExist:
        return

    if instance.assigned_object_type_id != device_ct.pk or not instance.assigned_object_id:
        return

    _clear_device_gps_if_orphaned(
        instance.assigned_object_id,
        exclude_marker_pk=instance.pk,
    )


# ── Prevent deletion of CustomMarkerType if in use ─────────────────────────


@receiver(pre_delete, sender=CustomMarkerType)
def protect_custom_marker_type_in_use(sender, instance, **kwargs):
    referencing = set()
    for tile in FloorPlanTile.objects.filter(tile_type=instance.slug):
        referencing.add(tile)
    for marker in MapMarker.objects.filter(marker_type=instance.slug):
        referencing.add(marker)
    if referencing:
        raise ProtectedError(
            f'Cannot delete custom marker type "{instance.name}": '
            f'it is still referenced by {len(referencing)} object(s).',
            referencing,
        )
