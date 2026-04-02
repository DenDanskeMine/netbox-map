from django.urls import path
from netbox.views.generic import ObjectChangeLogView
from . import models, views

urlpatterns = (
    # Settings
    path('settings/', views.MapSettingsView.as_view(), name='settings'),

    # CustomMarkerType
    path('custom-marker-types/', views.CustomMarkerTypeListView.as_view(), name='custommarkertype_list'),
    path('custom-marker-types/add/', views.CustomMarkerTypeEditView.as_view(), name='custommarkertype_add'),
    path('custom-marker-types/import/', views.CustomMarkerTypeBulkImportView.as_view(), name='custommarkertype_bulk_import'),
    path('custom-marker-types/edit/', views.CustomMarkerTypeBulkEditView.as_view(), name='custommarkertype_bulk_edit'),
    path('custom-marker-types/delete/', views.CustomMarkerTypeBulkDeleteView.as_view(), name='custommarkertype_bulk_delete'),
    path('custom-marker-types/<int:pk>/', views.CustomMarkerTypeView.as_view(), name='custommarkertype'),
    path('custom-marker-types/<int:pk>/edit/', views.CustomMarkerTypeEditView.as_view(), name='custommarkertype_edit'),
    path('custom-marker-types/<int:pk>/delete/', views.CustomMarkerTypeDeleteView.as_view(), name='custommarkertype_delete'),
    path('custom-marker-types/<int:pk>/changelog/', ObjectChangeLogView.as_view(), name='custommarkertype_changelog', kwargs={'model': models.CustomMarkerType}),

    # Site Map
    path('sitemap/', views.SiteMapView.as_view(), name='sitemap'),

    # Topology View
    path('topology/', views.TopologyView.as_view(), name='topology'),
    path('topology/data/', views.TopologyDataView.as_view(), name='topology_data'),
    path('topology/device/<int:device_id>/', views.TopologyDeviceDetailView.as_view(), name='topology_device_detail'),
    path('topology/save-layout/', views.TopologySaveLayoutView.as_view(), name='topology_save_layout'),

    # Topology Saved Views
    path('topology/views/', views.TopologySavedViewListView.as_view(), name='topologysavedview_list'),
    path('topology/views/add/', views.TopologySavedViewEditView.as_view(), name='topologysavedview_add'),
    path('topology/views/<int:pk>/', views.TopologySavedViewView.as_view(), name='topologysavedview'),
    path('topology/views/<int:pk>/edit/', views.TopologySavedViewEditView.as_view(), name='topologysavedview_edit'),
    path('topology/views/<int:pk>/delete/', views.TopologySavedViewDeleteView.as_view(), name='topologysavedview_delete'),
    path('topology/views/<int:pk>/changelog/', ObjectChangeLogView.as_view(), name='topologysavedview_changelog', kwargs={'model': models.TopologySavedView}),

    # App Topology
    path('topology/app-data/', views.AppTopologyDataView.as_view(), name='topology_app_data'),
    path('topology/app/<int:app_id>/', views.AppTopologyDetailView.as_view(), name='topology_app_detail'),

    # AJAX marker detail
    path('marker-detail/drop/<int:tile_id>/', views.DropDetailView.as_view(), name='drop_detail'),
    path('marker-detail/<str:object_type>/<int:object_id>/', views.MarkerDetailView.as_view(), name='marker_detail'),

    # FloorPlan
    path('floorplans/', views.FloorPlanListView.as_view(), name='floorplan_list'),
    path('floorplans/add/', views.FloorPlanEditView.as_view(), name='floorplan_add'),
    path('floorplans/import/', views.FloorPlanBulkImportView.as_view(), name='floorplan_bulk_import'),
    path('floorplans/edit/', views.FloorPlanBulkEditView.as_view(), name='floorplan_bulk_edit'),
    path('floorplans/delete/', views.FloorPlanBulkDeleteView.as_view(), name='floorplan_bulk_delete'),
    path('floorplans/<int:pk>/', views.FloorPlanView.as_view(), name='floorplan'),
    path('floorplans/<int:pk>/edit/', views.FloorPlanEditView.as_view(), name='floorplan_edit'),
    path('floorplans/<int:pk>/delete/', views.FloorPlanDeleteView.as_view(), name='floorplan_delete'),
    path('floorplans/<int:pk>/visualization/', views.FloorPlanVisualizationView.as_view(), name='floorplan_visualization'),
    path('floorplans/<int:pk>/changelog/', ObjectChangeLogView.as_view(), name='floorplan_changelog', kwargs={'model': models.FloorPlan}),

    # FloorPlanTile
    path('tiles/', views.FloorPlanTileListView.as_view(), name='floorplantile_list'),
    path('tiles/add/', views.FloorPlanTileEditView.as_view(), name='floorplantile_add'),
    path('tiles/import/', views.FloorPlanTileBulkImportView.as_view(), name='floorplantile_bulk_import'),
    path('tiles/edit/', views.FloorPlanTileBulkEditView.as_view(), name='floorplantile_bulk_edit'),
    path('tiles/delete/', views.FloorPlanTileBulkDeleteView.as_view(), name='floorplantile_bulk_delete'),
    path('tiles/<int:pk>/', views.FloorPlanTileView.as_view(), name='floorplantile'),
    path('tiles/<int:pk>/edit/', views.FloorPlanTileEditView.as_view(), name='floorplantile_edit'),
    path('tiles/<int:pk>/delete/', views.FloorPlanTileDeleteView.as_view(), name='floorplantile_delete'),
    path('tiles/<int:pk>/changelog/', ObjectChangeLogView.as_view(), name='floorplantile_changelog', kwargs={'model': models.FloorPlanTile}),

    # CablePath
    path('cable-paths/', views.CablePathListView.as_view(), name='cablepath_list'),
    path('cable-paths/add/', views.CablePathEditView.as_view(), name='cablepath_add'),
    path('cable-paths/import/', views.CablePathBulkImportView.as_view(), name='cablepath_bulk_import'),
    path('cable-paths/edit/', views.CablePathBulkEditView.as_view(), name='cablepath_bulk_edit'),
    path('cable-paths/delete/', views.CablePathBulkDeleteView.as_view(), name='cablepath_bulk_delete'),
    path('cable-paths/<int:pk>/', views.CablePathView.as_view(), name='cablepath'),
    path('cable-paths/<int:pk>/edit/', views.CablePathEditView.as_view(), name='cablepath_edit'),
    path('cable-paths/<int:pk>/delete/', views.CablePathDeleteView.as_view(), name='cablepath_delete'),
    path('cable-paths/<int:pk>/split/', views.SplitCableView.as_view(), name='cablepath_split'),
    path('cable-paths/<int:pk>/changelog/', ObjectChangeLogView.as_view(), name='cablepath_changelog', kwargs={'model': models.CablePath}),

    # LocationCoordinates (redirect to parent Location)
    path('location-coordinates/<int:pk>/', views.LocationCoordinatesRedirectView.as_view(), name='locationcoordinates'),

    # MapMarker
    path('map-markers/', views.MapMarkerListView.as_view(), name='mapmarker_list'),
    path('map-markers/add/', views.MapMarkerEditView.as_view(), name='mapmarker_add'),
    path('map-markers/import/', views.MapMarkerBulkImportView.as_view(), name='mapmarker_bulk_import'),
    path('map-markers/edit/', views.MapMarkerBulkEditView.as_view(), name='mapmarker_bulk_edit'),
    path('map-markers/delete/', views.MapMarkerBulkDeleteView.as_view(), name='mapmarker_bulk_delete'),
    path('map-markers/<int:pk>/', views.MapMarkerView.as_view(), name='mapmarker'),
    path('map-markers/<int:pk>/edit/', views.MapMarkerEditView.as_view(), name='mapmarker_edit'),
    path('map-markers/<int:pk>/delete/', views.MapMarkerDeleteView.as_view(), name='mapmarker_delete'),
    path('map-markers/<int:pk>/changelog/', ObjectChangeLogView.as_view(), name='mapmarker_changelog', kwargs={'model': models.MapMarker}),

    # ApplicationGroup
    path('application-groups/', views.ApplicationGroupListView.as_view(), name='applicationgroup_list'),
    path('application-groups/add/', views.ApplicationGroupEditView.as_view(), name='applicationgroup_add'),
    path('application-groups/edit/', views.ApplicationGroupBulkEditView.as_view(), name='applicationgroup_bulk_edit'),
    path('application-groups/delete/', views.ApplicationGroupBulkDeleteView.as_view(), name='applicationgroup_bulk_delete'),
    path('application-groups/<int:pk>/', views.ApplicationGroupView.as_view(), name='applicationgroup'),
    path('application-groups/<int:pk>/edit/', views.ApplicationGroupEditView.as_view(), name='applicationgroup_edit'),
    path('application-groups/<int:pk>/delete/', views.ApplicationGroupDeleteView.as_view(), name='applicationgroup_delete'),
    path('application-groups/<int:pk>/changelog/', ObjectChangeLogView.as_view(), name='applicationgroup_changelog', kwargs={'model': models.ApplicationGroup}),

    # Application
    path('applications/', views.ApplicationListView.as_view(), name='application_list'),
    path('applications/add/', views.ApplicationEditView.as_view(), name='application_add'),
    path('applications/import/', views.ApplicationBulkImportView.as_view(), name='application_bulk_import'),
    path('applications/edit/', views.ApplicationBulkEditView.as_view(), name='application_bulk_edit'),
    path('applications/delete/', views.ApplicationBulkDeleteView.as_view(), name='application_bulk_delete'),
    path('applications/<int:pk>/', views.ApplicationView.as_view(), name='application'),
    path('applications/<int:pk>/edit/', views.ApplicationEditView.as_view(), name='application_edit'),
    path('applications/<int:pk>/delete/', views.ApplicationDeleteView.as_view(), name='application_delete'),
    path('applications/<int:pk>/bulk-deploy/', views.ApplicationBulkDeployView.as_view(), name='application_bulk_deploy'),
    path('applications/<int:pk>/changelog/', ObjectChangeLogView.as_view(), name='application_changelog', kwargs={'model': models.Application}),

    # ApplicationDeployment
    path('application-deployments/', views.ApplicationDeploymentListView.as_view(), name='applicationdeployment_list'),
    path('application-deployments/add/', views.ApplicationDeploymentEditView.as_view(), name='applicationdeployment_add'),
    path('application-deployments/delete/', views.ApplicationDeploymentBulkDeleteView.as_view(), name='applicationdeployment_bulk_delete'),
    path('application-deployments/<int:pk>/', views.ApplicationDeploymentView.as_view(), name='applicationdeployment'),
    path('application-deployments/<int:pk>/edit/', views.ApplicationDeploymentEditView.as_view(), name='applicationdeployment_edit'),
    path('application-deployments/<int:pk>/delete/', views.ApplicationDeploymentDeleteView.as_view(), name='applicationdeployment_delete'),
    path('application-deployments/<int:pk>/changelog/', ObjectChangeLogView.as_view(), name='applicationdeployment_changelog', kwargs={'model': models.ApplicationDeployment}),

    # ApplicationDependency
    path('application-dependencies/', views.ApplicationDependencyListView.as_view(), name='applicationdependency_list'),
    path('application-dependencies/add/', views.ApplicationDependencyEditView.as_view(), name='applicationdependency_add'),
    path('application-dependencies/import/', views.ApplicationDependencyBulkImportView.as_view(), name='applicationdependency_bulk_import'),
    path('application-dependencies/edit/', views.ApplicationDependencyBulkEditView.as_view(), name='applicationdependency_bulk_edit'),
    path('application-dependencies/delete/', views.ApplicationDependencyBulkDeleteView.as_view(), name='applicationdependency_bulk_delete'),
    path('application-dependencies/<int:pk>/', views.ApplicationDependencyView.as_view(), name='applicationdependency'),
    path('application-dependencies/<int:pk>/edit/', views.ApplicationDependencyEditView.as_view(), name='applicationdependency_edit'),
    path('application-dependencies/<int:pk>/delete/', views.ApplicationDependencyDeleteView.as_view(), name='applicationdependency_delete'),
    path('application-dependencies/<int:pk>/changelog/', ObjectChangeLogView.as_view(), name='applicationdependency_changelog', kwargs={'model': models.ApplicationDependency}),
)
