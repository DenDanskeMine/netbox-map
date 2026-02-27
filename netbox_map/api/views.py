from django.contrib.contenttypes.prefetch import GenericPrefetch
from dcim.models import FrontPort, RearPort
from netbox.api.viewsets import NetBoxModelViewSet
from .. import filtersets
from ..models import FloorPlan, FloorPlanTile, CustomMarkerType, LocationCoordinates, MapMarker, TilePortAssignment
from .serializers import (
    FloorPlanSerializer, FloorPlanTileSerializer, CustomMarkerTypeSerializer,
    LocationCoordinatesSerializer, MapMarkerSerializer, TilePortAssignmentSerializer,
)


class CustomMarkerTypeViewSet(NetBoxModelViewSet):
    queryset = CustomMarkerType.objects.all()
    serializer_class = CustomMarkerTypeSerializer
    filterset_class = filtersets.CustomMarkerTypeFilterSet


class FloorPlanViewSet(NetBoxModelViewSet):
    queryset = FloorPlan.objects.all()
    serializer_class = FloorPlanSerializer
    filterset_class = filtersets.FloorPlanFilterSet


class FloorPlanTileViewSet(NetBoxModelViewSet):
    queryset = FloorPlanTile.objects.select_related('floorplan', 'assigned_object_type')
    serializer_class = FloorPlanTileSerializer
    filterset_class = filtersets.FloorPlanTileFilterSet


class LocationCoordinatesViewSet(NetBoxModelViewSet):
    queryset = LocationCoordinates.objects.select_related('location__site')
    serializer_class = LocationCoordinatesSerializer


class TilePortAssignmentViewSet(NetBoxModelViewSet):
    queryset = TilePortAssignment.objects.select_related('tile', 'port_type').prefetch_related(
        GenericPrefetch('port', [FrontPort.objects.all(), RearPort.objects.all()])
    )
    serializer_class = TilePortAssignmentSerializer
    filterset_class = filtersets.TilePortAssignmentFilterSet


class MapMarkerViewSet(NetBoxModelViewSet):
    queryset = MapMarker.objects.select_related('site', 'assigned_object_type')
    serializer_class = MapMarkerSerializer
    filterset_class = filtersets.MapMarkerFilterSet
