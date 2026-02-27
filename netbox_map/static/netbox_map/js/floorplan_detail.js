/**
 * FloorplanApp Detail — Detail panel, enriched AJAX, cable traces, rack elevation.
 * Depends on: floorplan_core.js
 */
(function(App) {
    'use strict';

    function Detail(state, events, interaction) {
        this.state = state;
        this.events = events;
        this.interaction = interaction;

        // DOM references
        this.panel = document.getElementById('tile-detail-panel');
        this.statusBar = document.getElementById('selection-status');
        this.enrichedEl = document.getElementById('fp-enriched-detail');

        // Cable trace panel
        this.cableTracePanel = document.getElementById('cable-trace-panel');
        this.cableTraceContent = document.getElementById('cable-trace-content');
        this.cableTraceTitle = document.getElementById('cable-trace-title');

        // Rack elevation
        this.rackElevationPanel = document.getElementById('rack-elevation-panel');
        this.rackElevationSvg = document.getElementById('rack-elevation-svg');
        this.rackElevationLoading = document.getElementById('rack-elevation-loading');
        this.rackElevationTitle = document.getElementById('rack-elevation-title');
        this.rackFaceFrontBtn = document.getElementById('rack-face-front');
        this.rackFaceRearBtn = document.getElementById('rack-face-rear');
        this.currentRackId = null;
        this.currentRackFace = 'front';

        // Wire up events
        var self = this;
        events.on('tile:select', function(tile) { self.show(tile); });
        events.on('tile:deselect', function() { self.hide(); });
        events.on('tile:update', function(tile) {
            if (self.state.selectedTile && self.state.selectedTile.id === tile.id) {
                self.show(tile);
            }
        });
        events.on('ports:change', function(data) {
            if (self.state.selectedTile && data && data.tileId === self.state.selectedTile.id) {
                self._loadEnriched(self.state.selectedTile);
            }
        });

        this._bindRackFaceButtons();
    }

    // ─── Show / Hide ──────────────────────────────────────────────

    Detail.prototype.show = function(tile) {
        this._updateStatusBar(tile);
        this._updateDetailPanel(tile);
        this._loadEnriched(tile);
        this._updateRackElevation(tile);
    };

    Detail.prototype.hide = function() {
        if (this.panel) {
            this.panel.classList.add('d-none');
            this.panel.dataset.selectedTileId = '';
        }
        if (this.statusBar) {
            this.statusBar.innerHTML = '<span class="text-muted">Click a tile to select</span>';
        }
        var deleteBtn = document.getElementById('delete-tile-btn');
        if (deleteBtn) deleteBtn.disabled = true;
        if (this.enrichedEl) this.enrichedEl.innerHTML = '';
        if (this.cableTracePanel) this.cableTracePanel.classList.add('d-none');
        if (this.rackElevationPanel) this.rackElevationPanel.classList.add('d-none');
        this.currentRackId = null;

        // Hide edit panels
        var fovPanel = document.getElementById('camera-fov-edit-panel');
        if (fovPanel) fovPanel.classList.add('d-none');
        var resizePanel = document.getElementById('resize-tile-panel');
        if (resizePanel) resizePanel.classList.add('d-none');

        // Hide label editor
        var labelForm = document.getElementById('edit-label-form');
        if (labelForm) labelForm.classList.add('d-none');
    };

    // ─── Status Bar ───────────────────────────────────────────────

    Detail.prototype._updateStatusBar = function(tile) {
        if (!this.statusBar) return;
        var html = '<span class="text-muted">Selected</span> &nbsp;&triangleright;&nbsp; ';
        html += '<strong>' + (tile.label || tile.type) + '</strong>';
        html += ' &nbsp; <span class="text-muted">X,Y:</span> ' + tile.x + ', ' + tile.y;
        if (tile.w > 1 || tile.h > 1) {
            html += ' &nbsp; <span class="text-muted">Size:</span> ' + tile.w + '&times;' + tile.h;
        }
        if (tile.utilization !== null && tile.utilization !== undefined) {
            html += ' &nbsp; <span class="text-muted">Util:</span> ' + Math.round(tile.utilization) + '%';
        }
        if (tile.object_type) {
            html += ' &nbsp; <span class="text-muted">' + tile.object_type + ':</span> ';
            html += '<strong>' + (tile.object_name || '') + '</strong>';
        }
        if (tile.primary_ip) {
            html += ' &nbsp; <span class="text-muted">IP:</span> ' + tile.primary_ip;
        }
        if (tile.object_url) {
            html += ' &nbsp; <a href="' + tile.object_url + '" class="text-info">View &rarr;</a>';
        }
        this.statusBar.innerHTML = html;
    };

    // ─── Detail Panel ─────────────────────────────────────────────

    Detail.prototype._updateDetailPanel = function(tile) {
        if (!this.panel) return;

        // Hide label editor when switching tiles
        var labelForm = document.getElementById('edit-label-form');
        if (labelForm) labelForm.classList.add('d-none');

        this.panel.classList.remove('d-none');
        this.panel.dataset.selectedTileId = tile.id;

        var nameEl = document.getElementById('tile-detail-name');
        if (nameEl) nameEl.textContent = tile.label || '-';

        var posEl = document.getElementById('tile-detail-position');
        if (posEl) posEl.textContent = 'X: ' + tile.x + ', Y: ' + tile.y;

        var sizeEl = document.getElementById('tile-detail-size');
        if (sizeEl) sizeEl.textContent = tile.w + ' x ' + tile.h;

        var typeEl = document.getElementById('tile-detail-type');
        if (typeEl) typeEl.textContent = tile.type;

        var utilEl = document.getElementById('tile-detail-utilization');
        if (utilEl) {
            utilEl.textContent = (tile.utilization !== null && tile.utilization !== undefined)
                ? Math.round(tile.utilization) + '%' : '-';
        }

        var objectTypeEl = document.getElementById('tile-detail-object-type');
        if (objectTypeEl) objectTypeEl.textContent = tile.object_type || '-';

        var ipEl = document.getElementById('tile-detail-ip');
        var ipRow = document.getElementById('tile-detail-ip-row');
        if (ipEl) ipEl.textContent = tile.primary_ip || '-';
        if (ipRow) ipRow.style.display = tile.primary_ip ? '' : 'none';

        var objectLinkEl = document.getElementById('tile-detail-object-link');
        if (objectLinkEl) {
            if (tile.object_url) {
                objectLinkEl.innerHTML = '<a href="' + tile.object_url + '">' +
                    (tile.object_name || tile.object_type || 'Object') + '</a>';
            } else {
                objectLinkEl.textContent = '-';
            }
        }

        // Show linked floor plan info
        var fpLinkRow = document.getElementById('tile-detail-fplink-row');
        var fpLinkEl = document.getElementById('tile-detail-fplink');
        if (fpLinkRow && fpLinkEl) {
            if (tile.linked_floorplan_url && tile.linked_floorplan_name) {
                fpLinkRow.style.display = '';
                fpLinkEl.innerHTML = '<a href="' + tile.linked_floorplan_url + '">' +
                    tile.linked_floorplan_name + '</a>';
            } else {
                fpLinkRow.style.display = 'none';
                fpLinkEl.textContent = '-';
            }
        }

        // Show/hide camera FOV edit panel
        var fovPanel = document.getElementById('camera-fov-edit-panel');
        if (fovPanel) {
            if (tile.type === 'camera') {
                fovPanel.classList.remove('d-none');
                var dirInput = document.getElementById('edit-fov-direction');
                var angleInput = document.getElementById('edit-fov-angle');
                var distInput = document.getElementById('edit-fov-distance');
                var dirSlider = document.getElementById('edit-fov-direction-slider');
                var angleSlider = document.getElementById('edit-fov-angle-slider');
                var distSlider = document.getElementById('edit-fov-distance-slider');
                if (dirInput) dirInput.value = tile.fov_direction || 0;
                if (angleInput) angleInput.value = tile.fov_angle || 90;
                if (distInput) distInput.value = tile.fov_distance || 5;
                if (dirSlider) dirSlider.value = tile.fov_direction || 0;
                if (angleSlider) angleSlider.value = tile.fov_angle || 90;
                if (distSlider) distSlider.value = tile.fov_distance || 5;
            } else {
                fovPanel.classList.add('d-none');
            }
        }

        // Show resize panel in edit mode
        var resizePanel = document.getElementById('resize-tile-panel');
        if (resizePanel) {
            resizePanel.classList.remove('d-none');
            var resizeW = document.getElementById('resize-width-input');
            var resizeH = document.getElementById('resize-height-input');
            if (resizeW) resizeW.value = tile.w;
            if (resizeH) resizeH.value = tile.h;
        }

        var deleteBtn = document.getElementById('delete-tile-btn');
        if (deleteBtn) deleteBtn.disabled = false;
    };

    // ─── Enriched Detail (AJAX) ───────────────────────────────────

    Detail.prototype._loadEnriched = function(tile) {
        if (!this.enrichedEl) return;
        var self = this;
        var s = this.state;

        if (tile.type === 'drop' && tile.id) {
            // Drop tiles: fetch traces for all assigned ports
            this.enrichedEl.innerHTML = '<div class="sidebar-detail-loading">Loading port traces\u2026</div>';
            fetch(s.detailBaseUrl + 'drop/' + tile.id + '/', {
                credentials: 'same-origin',
                headers: { 'Accept': 'application/json' }
            })
            .then(function(r) {
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.json();
            })
            .then(function(detail) {
                if (s.selectedTile !== tile) return;
                self.enrichedEl.innerHTML = '';
                self._renderCableTracePanel(detail.interfaces, tile);
            })
            .catch(function() {
                if (s.selectedTile === tile) self.enrichedEl.innerHTML = '';
            });
        } else if (tile.object_type_model && tile.object_id) {
            this.enrichedEl.innerHTML = '<div class="sidebar-detail-loading">Loading details\u2026</div>';
            fetch(s.detailBaseUrl + tile.object_type_model + '/' + tile.object_id + '/', {
                credentials: 'same-origin',
                headers: { 'Accept': 'application/json' }
            })
            .then(function(r) {
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.json();
            })
            .then(function(detail) {
                if (s.selectedTile !== tile) return;
                var html = '';
                if (detail.mac_address) {
                    html += '<div class="sidebar-detail-list">';
                    html += '<div class="detail-row"><span class="detail-label">MAC</span>';
                    html += '<span class="detail-value"><code>' + detail.mac_address + '</code></span></div></div>';
                }
                if (detail.standard_fields && detail.standard_fields.length) {
                    html += '<div class="sidebar-section-title">Details</div>';
                    html += '<div class="sidebar-detail-list">';
                    for (var i = 0; i < detail.standard_fields.length; i++) {
                        var f = detail.standard_fields[i];
                        html += '<div class="detail-row"><span class="detail-label">' + f.label + '</span>';
                        html += '<span class="detail-value">' + f.value + '</span></div>';
                    }
                    html += '</div>';
                }
                if (detail.custom_fields && detail.custom_fields.length) {
                    html += '<div class="sidebar-section-title">Custom Fields</div>';
                    html += '<div class="sidebar-detail-list">';
                    for (var j = 0; j < detail.custom_fields.length; j++) {
                        var cf = detail.custom_fields[j];
                        html += '<div class="detail-row"><span class="detail-label">' + cf.label + '</span>';
                        html += '<span class="detail-value">' + cf.value + '</span></div>';
                    }
                    html += '</div>';
                }
                self.enrichedEl.innerHTML = html;
                self._renderCableTracePanel(detail.interfaces, tile);
            })
            .catch(function() {
                if (s.selectedTile === tile) self.enrichedEl.innerHTML = '';
            });
        } else {
            this.enrichedEl.innerHTML = '';
            if (this.cableTracePanel) this.cableTracePanel.classList.add('d-none');
        }
    };

    // ─── Cable Trace Panel ────────────────────────────────────────

    Detail.prototype._renderCableTracePanel = function(interfaces, tile) {
        if (!this.cableTracePanel || !this.cableTraceContent) return;

        if (!interfaces || interfaces.length === 0) {
            this.cableTracePanel.classList.add('d-none');
            return;
        }

        this.cableTracePanel.classList.remove('d-none');
        if (this.cableTraceTitle) {
            var model = tile.object_type_model;
            if (tile.type === 'drop') {
                this.cableTraceTitle.textContent = 'Drop Ports (' + interfaces.length + ')';
            } else if (model === 'rearport' || model === 'frontport') {
                this.cableTraceTitle.textContent = 'Cable Trace';
            } else {
                this.cableTraceTitle.textContent = 'Ports (' + interfaces.length + ')';
            }
        }

        this.cableTraceContent.innerHTML = App.generateTraceHTML(interfaces, 'main', this.state.deviceTileMap);

        // Attach collapse/expand and auto-collapse in the main sidebar panel
        App.attachTraceToggleListeners(this.cableTraceContent, 'main', true);
        // Attach "show on map" buttons
        this._attachMapButtonListeners(this.cableTraceContent);
    };

    Detail.prototype._attachMapButtonListeners = function(containerEl) {
        var self = this;
        var btns = containerEl.querySelectorAll('.ct-dev-map-btn');
        for (var i = 0; i < btns.length; i++) {
            btns[i].addEventListener('click', (function(btn) {
                return function(e) {
                    e.stopPropagation();
                    var tileId = parseInt(btn.dataset.tileId);
                    var tile = self.state.findTileById(tileId);
                    if (tile) {
                        self.state.selectTile(tile);
                        self.interaction.zoomToTile(tile);
                    }
                };
            })(btns[i]));
        }
    };

    // ─── Rack Elevation ───────────────────────────────────────────

    Detail.prototype._updateRackElevation = function(tile) {
        if (!this.rackElevationPanel) return;

        if (!tile || tile.object_type_model !== 'rack' || !tile.object_id) {
            this.rackElevationPanel.classList.add('d-none');
            this.currentRackId = null;
            return;
        }

        this.rackElevationPanel.classList.remove('d-none');

        if (this.rackElevationTitle) {
            this.rackElevationTitle.textContent = (tile.label || 'Rack') + ' \u2014 Elevation';
        }

        if (this.currentRackId !== tile.object_id) {
            this.currentRackId = tile.object_id;
            this.currentRackFace = 'front';
            if (this.rackFaceFrontBtn) this.rackFaceFrontBtn.classList.add('active');
            if (this.rackFaceRearBtn) this.rackFaceRearBtn.classList.remove('active');
            this._loadRackElevation(this.currentRackId, this.currentRackFace);
        }
    };

    Detail.prototype._loadRackElevation = function(rackId, face) {
        if (!this.rackElevationPanel || !this.rackElevationSvg) return;
        var self = this;

        if (this.rackElevationLoading) this.rackElevationLoading.classList.remove('d-none');
        this.rackElevationSvg.innerHTML = '';

        var url = '/api/dcim/racks/' + rackId + '/elevation/?render=svg&face=' + face +
                  '&include_images=true&expand_devices=true';

        fetch(url, { credentials: 'same-origin' })
        .then(function(response) {
            if (!response.ok) throw new Error('Failed to load rack elevation');
            return response.text();
        })
        .then(function(svgText) {
            if (self.rackElevationLoading) self.rackElevationLoading.classList.add('d-none');
            self.rackElevationSvg.innerHTML = svgText;

            var svg = self.rackElevationSvg.querySelector('svg');
            if (svg) {
                var origW = svg.getAttribute('width');
                var origH = svg.getAttribute('height');
                if (origW && origH) {
                    svg.setAttribute('viewBox', '0 0 ' + origW + ' ' + origH);
                }
                svg.removeAttribute('width');
                svg.removeAttribute('height');
                svg.style.maxHeight = '75vh';
                svg.style.width = 'auto';
                svg.style.height = 'auto';
                svg.style.display = 'block';
                svg.style.margin = '0 auto';
            }
        })
        .catch(function(err) {
            if (self.rackElevationLoading) self.rackElevationLoading.classList.add('d-none');
            self.rackElevationSvg.innerHTML =
                '<div class="text-danger text-center py-3">Error loading rack elevation: ' +
                err.message + '</div>';
        });
    };

    Detail.prototype._bindRackFaceButtons = function() {
        var self = this;

        if (this.rackFaceFrontBtn) {
            this.rackFaceFrontBtn.addEventListener('click', function() {
                if (self.currentRackFace === 'front' || !self.currentRackId) return;
                self.currentRackFace = 'front';
                self.rackFaceFrontBtn.classList.add('active');
                self.rackFaceRearBtn.classList.remove('active');
                self._loadRackElevation(self.currentRackId, 'front');
            });
        }

        if (this.rackFaceRearBtn) {
            this.rackFaceRearBtn.addEventListener('click', function() {
                if (self.currentRackFace === 'rear' || !self.currentRackId) return;
                self.currentRackFace = 'rear';
                self.rackFaceRearBtn.classList.add('active');
                self.rackFaceFrontBtn.classList.remove('active');
                self._loadRackElevation(self.currentRackId, 'rear');
            });
        }
    };

    App.Detail = Detail;

})(window.FloorplanApp);
