from dcim.models import Device, DeviceRole, DeviceType, Location, Manufacturer, Site
from django.contrib.contenttypes.models import ContentType
from django.core.exceptions import ValidationError
from django.test import TestCase
from tenancy.models import Tenant

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
    MapSettings,
    TilePortAssignment,
    TopologySavedView,
)


class CustomMarkerTypeTest(TestCase):
    def test_create(self):
        cmt = CustomMarkerType.objects.create(name='Test Sensor', slug='custom_sensor')
        self.assertEqual(str(cmt), 'Test Sensor')
        self.assertIn('/plugins/map/', cmt.get_absolute_url())

    def test_slug_auto_prefix(self):
        cmt = CustomMarkerType(name='Fire Alarm', slug='fire_alarm')
        cmt.clean()
        self.assertTrue(cmt.slug.startswith('custom_'))

    def test_slug_already_prefixed(self):
        cmt = CustomMarkerType(name='Sensor', slug='custom_sensor')
        cmt.clean()
        self.assertEqual(cmt.slug, 'custom_sensor')

    def test_slug_uniqueness(self):
        CustomMarkerType.objects.create(name='Sensor A', slug='custom_sensor_a')
        with self.assertRaises(Exception):
            CustomMarkerType.objects.create(name='Sensor A Dupe', slug='custom_sensor_a')


class FloorPlanTest(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.site = Site.objects.create(name='Site 1', slug='site-1')

    def test_create(self):
        fp = FloorPlan.objects.create(site=self.site, name='Ground Floor')
        self.assertEqual(str(fp), f'Ground Floor ({self.site})')
        self.assertIn('/plugins/map/', fp.get_absolute_url())

    def test_unique_site_name(self):
        FloorPlan.objects.create(site=self.site, name='Floor 1')
        with self.assertRaises(Exception):
            FloorPlan.objects.create(site=self.site, name='Floor 1')


class FloorPlanTileTest(TestCase):
    @classmethod
    def setUpTestData(cls):
        site = Site.objects.create(name='Site 1', slug='site-1')
        cls.floorplan = FloorPlan.objects.create(site=site, name='FP1')

    def test_create(self):
        tile = FloorPlanTile.objects.create(floorplan=self.floorplan, x_position=0, y_position=0, tile_type='rack')
        self.assertIn('(0, 0)', str(tile))
        self.assertIn('/plugins/map/', tile.get_absolute_url())

    def test_unique_position(self):
        FloorPlanTile.objects.create(floorplan=self.floorplan, x_position=1, y_position=1)
        with self.assertRaises(Exception):
            FloorPlanTile.objects.create(floorplan=self.floorplan, x_position=1, y_position=1)

    def test_custom_type_validation(self):
        tile = FloorPlanTile(floorplan=self.floorplan, x_position=5, y_position=5, tile_type='custom_nonexistent')
        with self.assertRaises(ValidationError):
            tile.clean()

    def test_custom_type_valid(self):
        CustomMarkerType.objects.create(name='Sensor', slug='custom_sensor')
        tile = FloorPlanTile(floorplan=self.floorplan, x_position=6, y_position=6, tile_type='custom_sensor')
        tile.clean()  # Should not raise


class TilePortAssignmentTest(TestCase):
    @classmethod
    def setUpTestData(cls):
        site = Site.objects.create(name='Site 1', slug='site-1')
        fp = FloorPlan.objects.create(site=site, name='FP1')
        cls.drop_tile = FloorPlanTile.objects.create(floorplan=fp, x_position=0, y_position=0, tile_type='drop')
        cls.rack_tile = FloorPlanTile.objects.create(floorplan=fp, x_position=1, y_position=1, tile_type='rack')

    def test_non_drop_tile_rejected(self):
        ct = ContentType.objects.get_for_model(Device)
        tpa = TilePortAssignment(tile=self.rack_tile, port_type=ct, port_id=1)
        with self.assertRaises(ValidationError):
            tpa.clean()


class LocationCoordinatesTest(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.site = Site.objects.create(name='Site 1', slug='site-1')
        cls.location = Location.objects.create(site=cls.site, name='DC Room', slug='dc-room')

    def test_create(self):
        lc = LocationCoordinates.objects.create(location=self.location, latitude=55.6761, longitude=12.5683)
        self.assertIn('55.6761', str(lc))
        self.assertEqual(lc.get_absolute_url(), self.location.get_absolute_url())


class MapMarkerTest(TestCase):
    def test_create_with_label(self):
        m = MapMarker.objects.create(latitude=55.0, longitude=12.0, label='Test Marker')
        self.assertEqual(str(m), 'Test Marker')
        self.assertIn('/plugins/map/', m.get_absolute_url())

    def test_create_without_label(self):
        m = MapMarker.objects.create(latitude=55.0, longitude=12.0)
        self.assertIn('55.0', str(m))

    def test_custom_marker_type_validation(self):
        m = MapMarker(latitude=55.0, longitude=12.0, marker_type='custom_nonexistent')
        with self.assertRaises(ValidationError):
            m.clean()


class CablePathTest(TestCase):
    def test_create_with_label(self):
        cp = CablePath.objects.create(label='Fiber Run A', path_coordinates=[[55.0, 12.0], [55.1, 12.1]])
        self.assertEqual(str(cp), 'Fiber Run A')
        self.assertIn('/plugins/map/', cp.get_absolute_url())

    def test_create_without_label(self):
        cp = CablePath.objects.create(path_coordinates=[])
        self.assertIn('Cable Path', str(cp))


class MapSettingsTest(TestCase):
    def test_singleton_load(self):
        s1 = MapSettings.load()
        s2 = MapSettings.load()
        self.assertEqual(s1.pk, s2.pk)
        self.assertEqual(str(s1), 'Map Settings')

    def test_defaults_populated(self):
        s = MapSettings.load()
        self.assertTrue(s.show_mac)
        self.assertIsInstance(s.device_fields, list)
        self.assertGreater(len(s.device_fields), 0)


class TopologySavedViewTest(TestCase):
    def test_create(self):
        v = TopologySavedView.objects.create(name='My View')
        self.assertEqual(str(v), 'My View')
        self.assertIn('/plugins/map/', v.get_absolute_url())

    def test_unique_name(self):
        TopologySavedView.objects.create(name='View 1')
        with self.assertRaises(Exception):
            TopologySavedView.objects.create(name='View 1')


class ApplicationGroupTest(TestCase):
    def test_create(self):
        g = ApplicationGroup.objects.create(name='Web Services', slug='web-services')
        self.assertEqual(str(g), 'Web Services')
        self.assertIn('/plugins/map/', g.get_absolute_url())


class ApplicationTemplateTest(TestCase):
    def test_create(self):
        t = ApplicationTemplate.objects.create(name='Cache Template', slug='cache-template')
        self.assertEqual(str(t), 'Cache Template')
        self.assertIn('/plugins/map/', t.get_absolute_url())


class ApplicationTest(TestCase):
    def test_create(self):
        app = Application.objects.create(name='Order Service')
        self.assertEqual(str(app), 'Order Service')
        self.assertIn('/plugins/map/', app.get_absolute_url())

    def test_unique_name_env_tenant(self):
        tenant = Tenant.objects.create(name='T1', slug='t1')
        Application.objects.create(name='App A', environment='production', tenant=tenant)
        with self.assertRaises(Exception):
            Application.objects.create(name='App A', environment='production', tenant=tenant)

    def test_same_name_different_env(self):
        Application.objects.create(name='App B', environment='production')
        Application.objects.create(name='App B', environment='staging')
        self.assertEqual(Application.objects.filter(name='App B').count(), 2)


class ApplicationDeploymentTest(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.app = Application.objects.create(name='Deploy Test App')
        site = Site.objects.create(name='Site 1', slug='site-1')
        manufacturer = Manufacturer.objects.create(name='Mfr', slug='mfr')
        device_type = DeviceType.objects.create(manufacturer=manufacturer, model='Model 1', slug='model-1')
        device_role = DeviceRole.objects.create(name='Server', slug='server')
        cls.device = Device.objects.create(
            name='srv-01', site=site, device_type=device_type, role=device_role,
        )
        cls.device_ct = ContentType.objects.get_for_model(Device)

    def test_create(self):
        dep = ApplicationDeployment.objects.create(
            application=self.app, host_type=self.device_ct, host_id=self.device.pk,
        )
        self.assertIn('on', str(dep))
        self.assertIn('/plugins/map/', dep.get_absolute_url())

    def test_unique_app_host(self):
        ApplicationDeployment.objects.create(
            application=self.app, host_type=self.device_ct, host_id=self.device.pk,
        )
        with self.assertRaises(Exception):
            ApplicationDeployment.objects.create(
                application=self.app, host_type=self.device_ct, host_id=self.device.pk,
            )


class ApplicationDependencyTest(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.app_a = Application.objects.create(name='Service A')
        cls.app_b = Application.objects.create(name='Service B')

    def test_create(self):
        dep = ApplicationDependency.objects.create(
            source_application=self.app_a, target_application=self.app_b,
        )
        self.assertIn('→', str(dep))
        self.assertIn('/plugins/map/', dep.get_absolute_url())

    def test_self_dependency_rejected(self):
        dep = ApplicationDependency(
            source_application=self.app_a, target_application=self.app_a,
        )
        with self.assertRaises(ValidationError):
            dep.clean()

    def test_unique_source_target(self):
        ApplicationDependency.objects.create(
            source_application=self.app_a, target_application=self.app_b,
        )
        with self.assertRaises(Exception):
            ApplicationDependency.objects.create(
                source_application=self.app_a, target_application=self.app_b,
            )
