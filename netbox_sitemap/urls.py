from django.urls import path
from netbox.views.generic import ObjectChangeLogView
from . import models, views

urlpatterns = (
    # FloorPlan
    path('floorplans/', views.FloorPlanListView.as_view(), name='floorplan_list'),
    path('floorplans/add/', views.FloorPlanEditView.as_view(), name='floorplan_add'),
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
    path('tiles/delete/', views.FloorPlanTileBulkDeleteView.as_view(), name='floorplantile_bulk_delete'),
    path('tiles/<int:pk>/', views.FloorPlanTileView.as_view(), name='floorplantile'),
    path('tiles/<int:pk>/edit/', views.FloorPlanTileEditView.as_view(), name='floorplantile_edit'),
    path('tiles/<int:pk>/delete/', views.FloorPlanTileDeleteView.as_view(), name='floorplantile_delete'),
    path('tiles/<int:pk>/changelog/', ObjectChangeLogView.as_view(), name='floorplantile_changelog', kwargs={'model': models.FloorPlanTile}),
)
