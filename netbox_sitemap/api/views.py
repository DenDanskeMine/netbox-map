from netbox.api.viewsets import NetBoxModelViewSet
from .. import filtersets
from ..models import FloorPlan, FloorPlanTile
from .serializers import FloorPlanSerializer, FloorPlanTileSerializer


class FloorPlanViewSet(NetBoxModelViewSet):
    queryset = FloorPlan.objects.all()
    serializer_class = FloorPlanSerializer
    filterset_class = filtersets.FloorPlanFilterSet


class FloorPlanTileViewSet(NetBoxModelViewSet):
    queryset = FloorPlanTile.objects.select_related('floorplan', 'assigned_object_type')
    serializer_class = FloorPlanTileSerializer
    filterset_class = filtersets.FloorPlanTileFilterSet
