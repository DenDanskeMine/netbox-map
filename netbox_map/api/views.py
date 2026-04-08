from dcim.models import FrontPort, RearPort
from django.contrib.contenttypes.prefetch import GenericPrefetch
from netbox.api.viewsets import NetBoxModelViewSet
from rest_framework import mixins, viewsets

from .. import filtersets
from ..models import (
    Application,
    ApplicationDependency,
    ApplicationDeployment,
    ApplicationGroup,
    ApplicationTemplate,
    CablePath,
    CustomMarkerType,
    FloorPlan,
    FloorPlanTile,
    LocationCoordinates,
    MapMarker,
    MapSettings,
    TilePortAssignment,
    TopologySavedView,
)
from .serializers import (
    ApplicationDependencySerializer,
    ApplicationDeploymentSerializer,
    ApplicationGroupSerializer,
    ApplicationSerializer,
    ApplicationTemplateSerializer,
    CablePathSerializer,
    CustomMarkerTypeSerializer,
    FloorPlanSerializer,
    FloorPlanTileSerializer,
    LocationCoordinatesSerializer,
    MapMarkerSerializer,
    MapSettingsSerializer,
    TilePortAssignmentSerializer,
    TopologySavedViewSerializer,
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
    filterset_class = filtersets.LocationCoordinatesFilterSet


class TilePortAssignmentViewSet(NetBoxModelViewSet):
    queryset = TilePortAssignment.objects.select_related('tile', 'port_type').prefetch_related(
        GenericPrefetch('port', [FrontPort.objects.all(), RearPort.objects.all()])
    )
    serializer_class = TilePortAssignmentSerializer
    filterset_class = filtersets.TilePortAssignmentFilterSet


class CablePathViewSet(NetBoxModelViewSet):
    queryset = CablePath.objects.select_related('start_marker', 'end_marker')
    serializer_class = CablePathSerializer
    filterset_class = filtersets.CablePathFilterSet


class MapMarkerViewSet(NetBoxModelViewSet):
    queryset = MapMarker.objects.select_related('site', 'assigned_object_type')
    serializer_class = MapMarkerSerializer
    filterset_class = filtersets.MapMarkerFilterSet


class TopologySavedViewViewSet(NetBoxModelViewSet):
    queryset = TopologySavedView.objects.all()
    serializer_class = TopologySavedViewSerializer
    filterset_class = filtersets.TopologySavedViewFilterSet


class ApplicationGroupViewSet(NetBoxModelViewSet):
    queryset = ApplicationGroup.objects.all()
    serializer_class = ApplicationGroupSerializer
    filterset_class = filtersets.ApplicationGroupFilterSet


class ApplicationTemplateViewSet(NetBoxModelViewSet):
    queryset = ApplicationTemplate.objects.select_related('group')
    serializer_class = ApplicationTemplateSerializer
    filterset_class = filtersets.ApplicationTemplateFilterSet


class ApplicationViewSet(NetBoxModelViewSet):
    queryset = Application.objects.select_related('group', 'site', 'tenant')
    serializer_class = ApplicationSerializer
    filterset_class = filtersets.ApplicationFilterSet


class ApplicationDeploymentViewSet(NetBoxModelViewSet):
    queryset = ApplicationDeployment.objects.select_related('application', 'host_type')
    serializer_class = ApplicationDeploymentSerializer
    filterset_class = filtersets.ApplicationDeploymentFilterSet


class ApplicationDependencyViewSet(NetBoxModelViewSet):
    queryset = ApplicationDependency.objects.select_related('source_application', 'target_application')
    serializer_class = ApplicationDependencySerializer
    filterset_class = filtersets.ApplicationDependencyFilterSet


class MapSettingsViewSet(mixins.RetrieveModelMixin, mixins.UpdateModelMixin, viewsets.GenericViewSet):
    """
    Singleton settings endpoint. Supports GET and PATCH/PUT only.
    Always operates on the single MapSettings instance (pk=1).
    """
    serializer_class = MapSettingsSerializer
    queryset = MapSettings.objects.all()

    def get_object(self):
        return MapSettings.load()
