from decimal import Decimal

from dcim.models import Device, DeviceRole, DeviceType, Location, Manufacturer, Site
from django.contrib.contenttypes.models import ContentType
from utilities.testing import APIViewTestCases

from netbox_map.models import (
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
    TopologySavedView,
)


# Plugin doesn't implement GraphQL — use the mixin combo without GraphQLTestCase
class _PluginAPIMixins:
    class PluginAPIViewTestCase(
        APIViewTestCases.GetObjectViewTestCase,
        APIViewTestCases.ListObjectsViewTestCase,
        APIViewTestCases.CreateObjectViewTestCase,
        APIViewTestCases.UpdateObjectViewTestCase,
        APIViewTestCases.DeleteObjectViewTestCase,
    ):
        pass


class CustomMarkerTypeAPITest(_PluginAPIMixins.PluginAPIViewTestCase):
    model = CustomMarkerType
    view_namespace = 'plugins-api:netbox_map'
    brief_fields = ['color', 'display', 'icon', 'id', 'name', 'slug', 'url']

    @classmethod
    def setUpTestData(cls):
        CustomMarkerType.objects.create(name='Type A', slug='custom_type_a')
        CustomMarkerType.objects.create(name='Type B', slug='custom_type_b')
        CustomMarkerType.objects.create(name='Type C', slug='custom_type_c')

        cls.create_data = [
            {'name': 'Type D', 'slug': 'custom_type_d'},
            {'name': 'Type E', 'slug': 'custom_type_e'},
            {'name': 'Type F', 'slug': 'custom_type_f'},
        ]
        cls.bulk_edit_data = {
            'description': 'Updated description',
        }


class FloorPlanAPITest(_PluginAPIMixins.PluginAPIViewTestCase):
    model = FloorPlan
    view_namespace = 'plugins-api:netbox_map'
    brief_fields = ['display', 'id', 'name', 'site', 'url']

    @classmethod
    def setUpTestData(cls):
        site = Site.objects.create(name='Test Site', slug='test-site')

        FloorPlan.objects.create(site=site, name='Floor 1')
        FloorPlan.objects.create(site=site, name='Floor 2')
        FloorPlan.objects.create(site=site, name='Floor 3')

        cls.create_data = [
            {'site': site.pk, 'name': 'Floor 4'},
            {'site': site.pk, 'name': 'Floor 5'},
            {'site': site.pk, 'name': 'Floor 6'},
        ]
        cls.bulk_edit_data = {
            'description': 'Updated',
        }


class FloorPlanTileAPITest(_PluginAPIMixins.PluginAPIViewTestCase):
    model = FloorPlanTile
    view_namespace = 'plugins-api:netbox_map'
    brief_fields = ['display', 'id', 'label', 'tile_type', 'url', 'x_position', 'y_position']

    @classmethod
    def setUpTestData(cls):
        site = Site.objects.create(name='Test Site', slug='test-site')
        fp = FloorPlan.objects.create(site=site, name='FP1')

        FloorPlanTile.objects.create(floorplan=fp, x_position=0, y_position=0, tile_type='rack')
        FloorPlanTile.objects.create(floorplan=fp, x_position=1, y_position=0, tile_type='rack')
        FloorPlanTile.objects.create(floorplan=fp, x_position=2, y_position=0, tile_type='rack')

        cls.create_data = [
            {'floorplan': fp.pk, 'x_position': 3, 'y_position': 0, 'tile_type': 'aisle'},
            {'floorplan': fp.pk, 'x_position': 4, 'y_position': 0, 'tile_type': 'wall'},
            {'floorplan': fp.pk, 'x_position': 5, 'y_position': 0, 'tile_type': 'door'},
        ]
        cls.bulk_edit_data = {
            'tile_type': 'empty',
        }


class LocationCoordinatesAPITest(_PluginAPIMixins.PluginAPIViewTestCase):
    model = LocationCoordinates
    view_namespace = 'plugins-api:netbox_map'
    brief_fields = ['display', 'id', 'latitude', 'location', 'longitude', 'url']

    @classmethod
    def setUpTestData(cls):
        site = Site.objects.create(name='Test Site', slug='test-site')
        loc1 = Location.objects.create(site=site, name='Loc 1', slug='loc-1')
        loc2 = Location.objects.create(site=site, name='Loc 2', slug='loc-2')
        loc3 = Location.objects.create(site=site, name='Loc 3', slug='loc-3')
        loc4 = Location.objects.create(site=site, name='Loc 4', slug='loc-4')
        loc5 = Location.objects.create(site=site, name='Loc 5', slug='loc-5')
        loc6 = Location.objects.create(site=site, name='Loc 6', slug='loc-6')

        LocationCoordinates.objects.create(location=loc1, latitude=55.0, longitude=12.0)
        LocationCoordinates.objects.create(location=loc2, latitude=55.1, longitude=12.1)
        LocationCoordinates.objects.create(location=loc3, latitude=55.2, longitude=12.2)

        cls.create_data = [
            {'location': loc4.pk, 'latitude': Decimal('55.300000'), 'longitude': Decimal('12.300000')},
            {'location': loc5.pk, 'latitude': Decimal('55.400000'), 'longitude': Decimal('12.400000')},
            {'location': loc6.pk, 'latitude': Decimal('55.500000'), 'longitude': Decimal('12.500000')},
        ]
        cls.bulk_edit_data = {
            'latitude': Decimal('56.000000'),
        }


class MapMarkerAPITest(_PluginAPIMixins.PluginAPIViewTestCase):
    model = MapMarker
    view_namespace = 'plugins-api:netbox_map'
    brief_fields = ['display', 'id', 'label', 'latitude', 'longitude', 'marker_type', 'url']

    @classmethod
    def setUpTestData(cls):
        MapMarker.objects.create(latitude=55.0, longitude=12.0, label='Marker A')
        MapMarker.objects.create(latitude=55.1, longitude=12.1, label='Marker B')
        MapMarker.objects.create(latitude=55.2, longitude=12.2, label='Marker C')

        cls.create_data = [
            {'latitude': Decimal('55.300000'), 'longitude': Decimal('12.300000'), 'label': 'Marker D'},
            {'latitude': Decimal('55.400000'), 'longitude': Decimal('12.400000'), 'label': 'Marker E'},
            {'latitude': Decimal('55.500000'), 'longitude': Decimal('12.500000'), 'label': 'Marker F'},
        ]
        cls.bulk_edit_data = {
            'label': 'Updated',
        }


class CablePathAPITest(_PluginAPIMixins.PluginAPIViewTestCase):
    model = CablePath
    view_namespace = 'plugins-api:netbox_map'
    brief_fields = ['cable_type', 'display', 'fiber_count', 'id', 'label', 'status', 'url']

    @classmethod
    def setUpTestData(cls):
        CablePath.objects.create(label='Path A', path_coordinates=[[55, 12], [55.1, 12.1]])
        CablePath.objects.create(label='Path B', path_coordinates=[[56, 13], [56.1, 13.1]])
        CablePath.objects.create(label='Path C', path_coordinates=[[57, 14], [57.1, 14.1]])

        cls.create_data = [
            {'label': 'Path D', 'path_coordinates': [[58, 15]]},
            {'label': 'Path E', 'path_coordinates': [[59, 16]]},
            {'label': 'Path F', 'path_coordinates': [[60, 17]]},
        ]
        cls.bulk_edit_data = {
            'fiber_count': 24,
        }


class TopologySavedViewAPITest(_PluginAPIMixins.PluginAPIViewTestCase):
    model = TopologySavedView
    view_namespace = 'plugins-api:netbox_map'
    brief_fields = ['display', 'id', 'name', 'url']

    @classmethod
    def setUpTestData(cls):
        TopologySavedView.objects.create(name='View A')
        TopologySavedView.objects.create(name='View B')
        TopologySavedView.objects.create(name='View C')

        cls.create_data = [
            {'name': 'View D'},
            {'name': 'View E'},
            {'name': 'View F'},
        ]
        cls.bulk_edit_data = {
            'description': 'Updated',
        }


class ApplicationGroupAPITest(_PluginAPIMixins.PluginAPIViewTestCase):
    model = ApplicationGroup
    view_namespace = 'plugins-api:netbox_map'
    brief_fields = ['color', 'display', 'id', 'name', 'slug', 'url']

    @classmethod
    def setUpTestData(cls):
        ApplicationGroup.objects.create(name='Group A', slug='group-a')
        ApplicationGroup.objects.create(name='Group B', slug='group-b')
        ApplicationGroup.objects.create(name='Group C', slug='group-c')

        cls.create_data = [
            {'name': 'Group D', 'slug': 'group-d'},
            {'name': 'Group E', 'slug': 'group-e'},
            {'name': 'Group F', 'slug': 'group-f'},
        ]
        cls.bulk_edit_data = {
            'description': 'Updated',
        }


class ApplicationTemplateAPITest(_PluginAPIMixins.PluginAPIViewTestCase):
    model = ApplicationTemplate
    view_namespace = 'plugins-api:netbox_map'
    brief_fields = ['display', 'id', 'name', 'slug', 'url']

    @classmethod
    def setUpTestData(cls):
        ApplicationTemplate.objects.create(name='Template A', slug='template-a')
        ApplicationTemplate.objects.create(name='Template B', slug='template-b')
        ApplicationTemplate.objects.create(name='Template C', slug='template-c')

        cls.create_data = [
            {'name': 'Template D', 'slug': 'template-d'},
            {'name': 'Template E', 'slug': 'template-e'},
            {'name': 'Template F', 'slug': 'template-f'},
        ]
        cls.bulk_edit_data = {
            'default_status': 'planned',
        }


class ApplicationAPITest(_PluginAPIMixins.PluginAPIViewTestCase):
    model = Application
    view_namespace = 'plugins-api:netbox_map'
    brief_fields = ['display', 'environment', 'id', 'name', 'status', 'url']

    @classmethod
    def setUpTestData(cls):
        Application.objects.create(name='App A')
        Application.objects.create(name='App B')
        Application.objects.create(name='App C')

        cls.create_data = [
            {'name': 'App D'},
            {'name': 'App E'},
            {'name': 'App F'},
        ]
        cls.bulk_edit_data = {
            'status': 'planned',
        }


class ApplicationDeploymentAPITest(_PluginAPIMixins.PluginAPIViewTestCase):
    model = ApplicationDeployment
    view_namespace = 'plugins-api:netbox_map'
    brief_fields = ['application', 'display', 'id', 'role', 'url']

    @classmethod
    def setUpTestData(cls):
        site = Site.objects.create(name='Test Site', slug='test-site')
        manufacturer = Manufacturer.objects.create(name='Mfr', slug='mfr')
        device_type = DeviceType.objects.create(manufacturer=manufacturer, model='Model', slug='model')
        device_role = DeviceRole.objects.create(name='Server', slug='server')
        devices = [
            Device.objects.create(name=f'srv-{i}', site=site, device_type=device_type, role=device_role)
            for i in range(6)
        ]
        device_ct = ContentType.objects.get_for_model(Device)

        apps = [Application.objects.create(name=f'Deploy App {i}') for i in range(6)]

        ApplicationDeployment.objects.create(application=apps[0], host_type=device_ct, host_id=devices[0].pk)
        ApplicationDeployment.objects.create(application=apps[1], host_type=device_ct, host_id=devices[1].pk)
        ApplicationDeployment.objects.create(application=apps[2], host_type=device_ct, host_id=devices[2].pk)

        cls.create_data = [
            {'application': apps[3].pk, 'host_type': 'dcim.device', 'host_id': devices[3].pk},
            {'application': apps[4].pk, 'host_type': 'dcim.device', 'host_id': devices[4].pk},
            {'application': apps[5].pk, 'host_type': 'dcim.device', 'host_id': devices[5].pk},
        ]
        cls.bulk_edit_data = {
            'role': 'replica',
        }


class ApplicationDependencyAPITest(_PluginAPIMixins.PluginAPIViewTestCase):
    model = ApplicationDependency
    view_namespace = 'plugins-api:netbox_map'
    brief_fields = ['dependency_type', 'display', 'id', 'source_application', 'target_application', 'url']

    @classmethod
    def setUpTestData(cls):
        apps = [Application.objects.create(name=f'Dep App {i}') for i in range(8)]

        ApplicationDependency.objects.create(source_application=apps[0], target_application=apps[1])
        ApplicationDependency.objects.create(source_application=apps[2], target_application=apps[3])
        ApplicationDependency.objects.create(source_application=apps[4], target_application=apps[5])

        cls.create_data = [
            {'source_application': apps[0].pk, 'target_application': apps[2].pk},
            {'source_application': apps[1].pk, 'target_application': apps[3].pk},
            {'source_application': apps[6].pk, 'target_application': apps[7].pk},
        ]
        cls.bulk_edit_data = {
            'dependency_type': 'soft',
        }
