from dcim.models import Device, DeviceRole, DeviceType, Location, Manufacturer, Site
from django.contrib.contenttypes.models import ContentType
from django.test import TestCase

from netbox_map.filtersets import (
    ApplicationDependencyFilterSet,
    ApplicationDeploymentFilterSet,
    ApplicationFilterSet,
    ApplicationGroupFilterSet,
    CustomMarkerTypeFilterSet,
    FloorPlanFilterSet,
    LocationCoordinatesFilterSet,
)
from netbox_map.models import (
    Application,
    ApplicationDependency,
    ApplicationDeployment,
    ApplicationGroup,
    CustomMarkerType,
    FloorPlan,
    LocationCoordinates,
)


class FloorPlanFilterSetTest(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.site_a = Site.objects.create(name='Site A', slug='site-a')
        cls.site_b = Site.objects.create(name='Site B', slug='site-b')
        FloorPlan.objects.create(site=cls.site_a, name='Floor 1')
        FloorPlan.objects.create(site=cls.site_b, name='Floor 2')

    def test_filter_by_site(self):
        qs = FloorPlan.objects.all()
        fs = FloorPlanFilterSet({'site_id': [self.site_a.pk]}, qs)
        self.assertEqual(fs.qs.count(), 1)

    def test_search(self):
        qs = FloorPlan.objects.all()
        fs = FloorPlanFilterSet({'q': 'Floor 1'}, qs)
        self.assertEqual(fs.qs.count(), 1)


class CustomMarkerTypeFilterSetTest(TestCase):
    @classmethod
    def setUpTestData(cls):
        CustomMarkerType.objects.create(name='Sensor', slug='custom_sensor')
        CustomMarkerType.objects.create(name='Alarm', slug='custom_alarm')

    def test_search(self):
        qs = CustomMarkerType.objects.all()
        fs = CustomMarkerTypeFilterSet({'q': 'sensor'}, qs)
        self.assertEqual(fs.qs.count(), 1)


class LocationCoordinatesFilterSetTest(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.site = Site.objects.create(name='Site 1', slug='site-1')
        loc = Location.objects.create(site=cls.site, name='Room A', slug='room-a')
        LocationCoordinates.objects.create(location=loc, latitude=55.0, longitude=12.0)

    def test_filter_by_site(self):
        qs = LocationCoordinates.objects.all()
        fs = LocationCoordinatesFilterSet({'site_id': [self.site.pk]}, qs)
        self.assertEqual(fs.qs.count(), 1)

    def test_search(self):
        qs = LocationCoordinates.objects.all()
        fs = LocationCoordinatesFilterSet({'q': 'Room A'}, qs)
        self.assertEqual(fs.qs.count(), 1)


class ApplicationFilterSetTest(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.site = Site.objects.create(name='Site 1', slug='site-1')
        Application.objects.create(
            name='Web App', status='active', criticality='high',
            environment='production', site=cls.site,
        )
        Application.objects.create(name='DB Service', status='planned', criticality='critical', environment='staging')
        Application.objects.create(name='Cache', status='active', criticality='low', environment='production')

    def test_filter_by_status(self):
        qs = Application.objects.all()
        fs = ApplicationFilterSet({'status': ['active']}, qs)
        self.assertEqual(fs.qs.count(), 2)

    def test_filter_by_criticality(self):
        qs = Application.objects.all()
        fs = ApplicationFilterSet({'criticality': ['critical']}, qs)
        self.assertEqual(fs.qs.count(), 1)

    def test_filter_by_environment(self):
        qs = Application.objects.all()
        fs = ApplicationFilterSet({'environment': ['production']}, qs)
        self.assertEqual(fs.qs.count(), 2)

    def test_filter_by_site(self):
        qs = Application.objects.all()
        fs = ApplicationFilterSet({'site_id': [self.site.pk]}, qs)
        self.assertEqual(fs.qs.count(), 1)

    def test_search(self):
        qs = Application.objects.all()
        fs = ApplicationFilterSet({'q': 'web'}, qs)
        self.assertEqual(fs.qs.count(), 1)


class ApplicationGroupFilterSetTest(TestCase):
    @classmethod
    def setUpTestData(cls):
        ApplicationGroup.objects.create(name='Web', slug='web')
        ApplicationGroup.objects.create(name='Data', slug='data')

    def test_search(self):
        qs = ApplicationGroup.objects.all()
        fs = ApplicationGroupFilterSet({'q': 'web'}, qs)
        self.assertEqual(fs.qs.count(), 1)


class ApplicationDependencyFilterSetTest(TestCase):
    @classmethod
    def setUpTestData(cls):
        app_a = Application.objects.create(name='A')
        app_b = Application.objects.create(name='B')
        app_c = Application.objects.create(name='C')
        ApplicationDependency.objects.create(source_application=app_a, target_application=app_b, dependency_type='hard')
        ApplicationDependency.objects.create(source_application=app_b, target_application=app_c, dependency_type='soft')

    def test_filter_by_type(self):
        qs = ApplicationDependency.objects.all()
        fs = ApplicationDependencyFilterSet({'dependency_type': ['hard']}, qs)
        self.assertEqual(fs.qs.count(), 1)


class ApplicationDeploymentFilterSetTest(TestCase):
    @classmethod
    def setUpTestData(cls):
        site = Site.objects.create(name='Site', slug='site')
        mfr = Manufacturer.objects.create(name='Mfr', slug='mfr')
        dt = DeviceType.objects.create(manufacturer=mfr, model='M', slug='m')
        dr = DeviceRole.objects.create(name='Srv', slug='srv')
        device = Device.objects.create(name='d1', site=site, device_type=dt, role=dr)
        app = Application.objects.create(name='App')
        device_ct = ContentType.objects.get_for_model(Device)
        ApplicationDeployment.objects.create(application=app, host_type=device_ct, host_id=device.pk, role='primary')

    def test_filter_by_role(self):
        qs = ApplicationDeployment.objects.all()
        fs = ApplicationDeploymentFilterSet({'role': ['primary']}, qs)
        self.assertEqual(fs.qs.count(), 1)
