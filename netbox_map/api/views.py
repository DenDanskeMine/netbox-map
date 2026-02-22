from netbox.api.viewsets import NetBoxModelViewSet
from .. import filtersets
from ..models import FloorPlan, FloorPlanTile, LocationCoordinates, MapMarker
from .serializers import (
    FloorPlanSerializer, FloorPlanTileSerializer, LocationCoordinatesSerializer,
    MapMarkerSerializer,
)


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


class MapMarkerViewSet(NetBoxModelViewSet):
    queryset = MapMarker.objects.select_related('site', 'assigned_object_type')
    serializer_class = MapMarkerSerializer
    filterset_class = filtersets.MapMarkerFilterSet
