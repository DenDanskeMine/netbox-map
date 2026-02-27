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

    # AJAX marker detail
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
    path('tiles/delete/', views.FloorPlanTileBulkDeleteView.as_view(), name='floorplantile_bulk_delete'),
    path('tiles/<int:pk>/', views.FloorPlanTileView.as_view(), name='floorplantile'),
    path('tiles/<int:pk>/edit/', views.FloorPlanTileEditView.as_view(), name='floorplantile_edit'),
    path('tiles/<int:pk>/delete/', views.FloorPlanTileDeleteView.as_view(), name='floorplantile_delete'),
    path('tiles/<int:pk>/changelog/', ObjectChangeLogView.as_view(), name='floorplantile_changelog', kwargs={'model': models.FloorPlanTile}),

    # MapMarker
    path('map-markers/', views.MapMarkerListView.as_view(), name='mapmarker_list'),
    path('map-markers/add/', views.MapMarkerEditView.as_view(), name='mapmarker_add'),
    path('map-markers/import/', views.MapMarkerBulkImportView.as_view(), name='mapmarker_bulk_import'),
    path('map-markers/delete/', views.MapMarkerBulkDeleteView.as_view(), name='mapmarker_bulk_delete'),
    path('map-markers/<int:pk>/', views.MapMarkerView.as_view(), name='mapmarker'),
    path('map-markers/<int:pk>/edit/', views.MapMarkerEditView.as_view(), name='mapmarker_edit'),
    path('map-markers/<int:pk>/delete/', views.MapMarkerDeleteView.as_view(), name='mapmarker_delete'),
    path('map-markers/<int:pk>/changelog/', ObjectChangeLogView.as_view(), name='mapmarker_changelog', kwargs={'model': models.MapMarker}),
)
