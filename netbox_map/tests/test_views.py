from dcim.models import Site
from django.test import TestCase, override_settings
from django.urls import reverse
from users.models import ObjectPermission, User
from utilities.testing import ViewTestCases

from netbox_map.models import (
    Application,
    ApplicationGroup,
    CustomMarkerType,
    FloorPlan,
    TopologySavedView,
)


class FloorPlanViewTest(
    ViewTestCases.GetObjectViewTestCase,
    ViewTestCases.GetObjectChangelogViewTestCase,
    ViewTestCases.CreateObjectViewTestCase,
    ViewTestCases.EditObjectViewTestCase,
    ViewTestCases.DeleteObjectViewTestCase,
    ViewTestCases.ListObjectsViewTestCase,
    ViewTestCases.BulkDeleteObjectsViewTestCase,
):
    model = FloorPlan

    @classmethod
    def setUpTestData(cls):
        site = Site.objects.create(name='Test Site', slug='test-site')

        FloorPlan.objects.create(site=site, name='Floor 1')
        FloorPlan.objects.create(site=site, name='Floor 2')
        FloorPlan.objects.create(site=site, name='Floor 3')

        cls.form_data = {
            'site': site.pk,
            'name': 'Floor 4',
            'grid_width': 20,
            'grid_height': 20,
            'tile_size': 60,
            'description': '',
            'comments': '',
            'tags': [],
        }

    def _get_base_url(self):
        return 'plugins:netbox_map:floorplan_{}'


class CustomMarkerTypeViewTest(
    ViewTestCases.GetObjectViewTestCase,
    ViewTestCases.CreateObjectViewTestCase,
    ViewTestCases.EditObjectViewTestCase,
    ViewTestCases.DeleteObjectViewTestCase,
    ViewTestCases.ListObjectsViewTestCase,
    ViewTestCases.BulkDeleteObjectsViewTestCase,
):
    model = CustomMarkerType

    @classmethod
    def setUpTestData(cls):
        CustomMarkerType.objects.create(name='Type A', slug='custom_type_a')
        CustomMarkerType.objects.create(name='Type B', slug='custom_type_b')
        CustomMarkerType.objects.create(name='Type C', slug='custom_type_c')

        cls.form_data = {
            'name': 'Type D',
            'slug': 'custom_type_d',
            'color': '#ff5733',
            'icon': 'mdi-shape',
            'description': '',
            'tags': [],
        }

    def _get_base_url(self):
        return 'plugins:netbox_map:custommarkertype_{}'


class ApplicationGroupViewTest(
    ViewTestCases.GetObjectViewTestCase,
    ViewTestCases.CreateObjectViewTestCase,
    ViewTestCases.EditObjectViewTestCase,
    ViewTestCases.DeleteObjectViewTestCase,
    ViewTestCases.ListObjectsViewTestCase,
    ViewTestCases.BulkDeleteObjectsViewTestCase,
):
    model = ApplicationGroup

    @classmethod
    def setUpTestData(cls):
        ApplicationGroup.objects.create(name='Group A', slug='group-a')
        ApplicationGroup.objects.create(name='Group B', slug='group-b')
        ApplicationGroup.objects.create(name='Group C', slug='group-c')

        cls.form_data = {
            'name': 'Group D',
            'slug': 'group-d',
            'color': '#3498db',
            'description': '',
            'tags': [],
        }

    def _get_base_url(self):
        return 'plugins:netbox_map:applicationgroup_{}'


class ApplicationViewTest(
    ViewTestCases.GetObjectViewTestCase,
    ViewTestCases.CreateObjectViewTestCase,
    ViewTestCases.EditObjectViewTestCase,
    ViewTestCases.DeleteObjectViewTestCase,
    ViewTestCases.ListObjectsViewTestCase,
    ViewTestCases.BulkDeleteObjectsViewTestCase,
):
    model = Application

    @classmethod
    def setUpTestData(cls):
        Application.objects.create(name='App A')
        Application.objects.create(name='App B')
        Application.objects.create(name='App C')

        cls.form_data = {
            'name': 'App D',
            'status': 'active',
            'criticality': 'medium',
            'environment': 'production',
            'version': '',
            'description': '',
            'comments': '',
            'external_url': '',
            'default_port': None,
            'default_protocol': '',
            'tags': [],
        }

    def _get_base_url(self):
        return 'plugins:netbox_map:application_{}'


class TopologySavedViewViewTest(
    ViewTestCases.GetObjectViewTestCase,
    ViewTestCases.DeleteObjectViewTestCase,
    ViewTestCases.ListObjectsViewTestCase,
):
    model = TopologySavedView

    @classmethod
    def setUpTestData(cls):
        TopologySavedView.objects.create(name='View A')
        TopologySavedView.objects.create(name='View B')
        TopologySavedView.objects.create(name='View C')

    def _get_base_url(self):
        return 'plugins:netbox_map:topologysavedview_{}'


class TopologyViewSmokeTest(TestCase):
    """Smoke test that the topology page loads."""

    @classmethod
    def setUpTestData(cls):
        cls.site = Site.objects.create(name='Topo Site', slug='topo-site')

    def setUp(self):
        self.user = User.objects.create_user(username='testuser', password='testpass')
        self.client.login(username='testuser', password='testpass')
        # Grant view permission on all objects
        perm = ObjectPermission.objects.create(name='View all', actions=['view'])
        perm.users.add(self.user)
        from django.contrib.contenttypes.models import ContentType
        perm.object_types.set(ContentType.objects.all())

    @override_settings(LOGIN_REQUIRED=False, EXEMPT_VIEW_PERMISSIONS=['*'])
    def test_topology_page_loads(self):
        url = reverse('plugins:netbox_map:topology')
        response = self.client.get(url, {'site_id': self.site.pk})
        self.assertIn(response.status_code, [200, 302])
