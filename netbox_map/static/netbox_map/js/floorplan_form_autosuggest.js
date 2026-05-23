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
        var autofillCb  = document.getElementById('id_autofill_grid');

        if (!bgInput || !tileInput || !widthInput || !heightInput) return;

        // Cache the last detected dimensions so changing tile_size after
        // picking a file still recomputes without re-reading.
        var lastDims = null;  // {width, height}

        function autofillEnabled() {
            // If the checkbox is missing (older template / template
            // extension stripped it), default to enabled — the old
            // behaviour was always to auto-fill.
            return !autofillCb || autofillCb.checked;
        }

        function recompute() {
            if (!lastDims) return;
            if (!autofillEnabled()) return;
            var tile = parseInt(tileInput.value, 10);
            if (!tile || tile <= 0) return;
            widthInput.value  = Math.round(lastDims.width  / tile);
            heightInput.value = Math.round(lastDims.height / tile);
        }

        function csrfToken() {
            // Prefer the form's hidden csrfmiddlewaretoken input — it is
            // always in sync with whatever token NetBox baked into the
            // page (the cookie can be stale if CSRF_USE_SESSIONS is on or
            // the token was rotated since the cookie was set in another
            // tab). Fall back to the cookie if the input isn't found.
            var input = document.querySelector('input[name="csrfmiddlewaretoken"]');
            if (input && input.value) return input.value;
            var m = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
            return m ? decodeURIComponent(m[1]) : '';
        }

        function pdfDimensionsEndpoint() {
            // The form template includes a data-pdf-dim-url attribute on
            // the auto-suggest script tag if available; otherwise fall
            // back to the conventional plugin URL.
            return '/plugins/map/api/pdf-dimensions/';
        }

        function loadPdfDimensions(file) {
            var fd = new FormData();
            fd.append('file', file);
            fetch(pdfDimensionsEndpoint(), {
                method: 'POST',
                headers: { 'X-CSRFToken': csrfToken() },
                body: fd,
                credentials: 'same-origin',
            })
                .then(function (r) {
                    if (!r.ok) throw new Error('HTTP ' + r.status);
                    return r.json();
                })
                .then(function (data) {
                    if (data && data.width && data.height) {
                        lastDims = { width: data.width, height: data.height };
                        recompute();
                    }
                })
                .catch(function () { lastDims = null; });
        }

        function loadImageDimensions(file) {
            var img = new Image();
            img.onload = function () {
                lastDims = { width: img.naturalWidth, height: img.naturalHeight };
                recompute();
                URL.revokeObjectURL(img.src);
            };
            img.onerror = function () {
                lastDims = null;
                URL.revokeObjectURL(img.src);
            };
            img.src = URL.createObjectURL(file);
        }

        bgInput.addEventListener('change', function (e) {
            var file = e.target.files && e.target.files[0];
            if (!file) { lastDims = null; return; }
            var isPdf = /\.pdf$/i.test(file.name) || file.type === 'application/pdf';
            if (isPdf) loadPdfDimensions(file);
            else loadImageDimensions(file);
        });

        tileInput.addEventListener('input', recompute);
        if (autofillCb) autofillCb.addEventListener('change', recompute);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', attach);
    } else {
        attach();
    }
})();
