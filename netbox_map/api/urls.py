from netbox.api.routers import NetBoxRouter
from . import views

router = NetBoxRouter()
router.register('floorplans', views.FloorPlanViewSet)
router.register('floorplan-tiles', views.FloorPlanTileViewSet)

urlpatterns = router.urls
