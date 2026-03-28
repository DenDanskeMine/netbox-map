from netbox.api.routers import NetBoxRouter
from . import views

router = NetBoxRouter()
router.register('custom-marker-types', views.CustomMarkerTypeViewSet)
router.register('floorplans', views.FloorPlanViewSet)
router.register('floorplan-tiles', views.FloorPlanTileViewSet)
router.register('location-coordinates', views.LocationCoordinatesViewSet)
router.register('tile-port-assignments', views.TilePortAssignmentViewSet)
router.register('cable-paths', views.CablePathViewSet)
router.register('map-markers', views.MapMarkerViewSet)
router.register('topology-saved-views', views.TopologySavedViewViewSet)

urlpatterns = router.urls
