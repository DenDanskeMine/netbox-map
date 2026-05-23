/* #52 — Auto-suggest grid_width / grid_height on the FloorPlan add/edit form
 * whenever the user picks a background image. The browser already has the
 * image data once the file input changes, so no server round-trip is
 * needed: we read the pixel dimensions client-side, divide by tile_size,
 * and fill in the two grid fields. The user can still override the
 * suggestion manually.
 */
(function () {
    'use strict';

    function attach() {
        var bgInput     = document.getElementById('id_background_image');
        var tileInput   = document.getElementById('id_tile_size');
        var widthInput  = document.getElementById('id_grid_width');
        var heightInput = document.getElementById('id_grid_height');

        if (!bgInput || !tileInput || !widthInput || !heightInput) return;

        // Cache the last decoded image so changing tile_size after picking a
        // file still recomputes without re-reading the file.
        var lastImage = null;

        function recompute() {
            if (!lastImage) return;
            var tile = parseInt(tileInput.value, 10);
            if (!tile || tile <= 0) return;
            widthInput.value  = Math.round(lastImage.naturalWidth  / tile);
            heightInput.value = Math.round(lastImage.naturalHeight / tile);
        }

        bgInput.addEventListener('change', function (e) {
            var file = e.target.files && e.target.files[0];
            if (!file) {
                lastImage = null;
                return;
            }
            var img = new Image();
            img.onload = function () {
                lastImage = img;
                recompute();
                URL.revokeObjectURL(img.src);
            };
            img.onerror = function () {
                lastImage = null;
                URL.revokeObjectURL(img.src);
            };
            img.src = URL.createObjectURL(file);
        });

        tileInput.addEventListener('input', recompute);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', attach);
    } else {
        attach();
    }
})();
