from django.contrib.contenttypes.prefetch import GenericPrefetch
from dcim.models import FrontPort, RearPort
from netbox.api.viewsets import NetBoxModelViewSet
from .. import filtersets
from ..models import FloorPlan, FloorPlanTile, CustomMarkerType, LocationCoordinates, MapMarker, TilePortAssignment, CablePath, CablePathAssignment, FiberSplice, FiberSplit, TrayLabel, FiberLabel
from .serializers import (
    FloorPlanSerializer, FloorPlanTileSerializer, CustomMarkerTypeSerializer,
    LocationCoordinatesSerializer, MapMarkerSerializer, TilePortAssignmentSerializer,
    CablePathSerializer, CablePathAssignmentSerializer, FiberSpliceSerializer,
    FiberSplitSerializer, TrayLabelSerializer, FiberLabelSerializer,
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


class CablePathViewSet(NetBoxModelViewSet):
    queryset = CablePath.objects.select_related('start_marker', 'end_marker').prefetch_related(
        'cable_assignments__cable',
    )
    serializer_class = CablePathSerializer
    filterset_class = filtersets.CablePathFilterSet


class CablePathAssignmentViewSet(NetBoxModelViewSet):
    queryset = CablePathAssignment.objects.select_related('cable_path', 'cable')
    serializer_class = CablePathAssignmentSerializer


class MapMarkerViewSet(NetBoxModelViewSet):
    queryset = MapMarker.objects.select_related('site', 'assigned_object_type')
    serializer_class = MapMarkerSerializer
    filterset_class = filtersets.MapMarkerFilterSet


class FiberSpliceViewSet(NetBoxModelViewSet):
    """CRUD for FiberSplice — used by the fiber splicer GUI."""
    queryset = FiberSplice.objects.select_related('device', 'port_a', 'port_b')
    serializer_class = FiberSpliceSerializer
    filterset_fields = ['device', 'port_a', 'port_b']


class FiberSplitViewSet(NetBoxModelViewSet):
    """CRUD for FiberSplit — 1:N passive optical splitter connections."""
    queryset = FiberSplit.objects.select_related('device', 'input_port', 'output_port')
    serializer_class = FiberSplitSerializer
    filterset_fields = ['device', 'input_port', 'output_port']


class TrayLabelViewSet(NetBoxModelViewSet):
    queryset = TrayLabel.objects.select_related('rear_port', 'cable')
    serializer_class = TrayLabelSerializer
    filterset_fields = ['rear_port']


class FiberLabelViewSet(NetBoxModelViewSet):
    queryset = FiberLabel.objects.select_related('rear_port')
    serializer_class = FiberLabelSerializer
    filterset_fields = ['rear_port', 'position']
