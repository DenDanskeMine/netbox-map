(function () {
    'use strict';

    /**
     * When a floorplan is selected on the FloorPlanTile add/edit form,
     * fetch the floorplan's site via the API and update the hidden #id_site
     * field so that the rack/device/powerpanel DynamicModelChoiceFields
     * can filter correctly by site.
     */
    function onFloorplanChange(e) {
        var floorplanId = e.target.value;
        var siteField = document.getElementById('id_site');
        if (!siteField) return;

        if (!floorplanId) {
            siteField.value = '';
            siteField.dispatchEvent(new Event('change'));
            return;
        }

        fetch('/api/plugins/netbox-map/floorplans/' + floorplanId + '/?brief=1', {
            headers: { 'Accept': 'application/json' }
        })
        .then(function (r) { return r.json(); })
        .then(function (data) {
            var siteId = data.site && data.site.id ? data.site.id : '';
            siteField.value = siteId;
            siteField.dispatchEvent(new Event('change'));
        })
        .catch(function () {
            siteField.value = '';
            siteField.dispatchEvent(new Event('change'));
        });
    }

    function init() {
        var floorplanField = document.getElementById('id_floorplan');
        if (!floorplanField) return;
        floorplanField.addEventListener('change', onFloorplanChange);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
