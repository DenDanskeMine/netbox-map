/**
 * FloorplanApp Panels — Edit-mode panels: link object, link floorplan, drop ports,
 * FOV editor, label editor, placeholder sync.
 * Depends on: floorplan_core.js
 */
(function(App) {
    'use strict';

    // Move Tom Select dropdown to <body> so it escapes the sidebar's
    // overflow clipping entirely. Override positionDropdown to use
    // fixed positioning relative to the viewport.
    function _hookTomSelectDropdown(selectEl) {
        function attach(ts) {
            // Move dropdown out of sidebar into body
            ts.dropdown.classList.add('fp-dropdown');
            document.body.appendChild(ts.dropdown);

            // Override Tom Select's positioning
            ts.positionDropdown = function() {
                var rect = ts.control.getBoundingClientRect();
                var dd = ts.dropdown;
                dd.style.position = 'fixed';
                dd.style.left = rect.left + 'px';
                dd.style.width = rect.width + 'px';
                dd.style.zIndex = '9999';

                // Decide open direction based on available space
                var ddHeight = Math.min(dd.scrollHeight, 180);
                var spaceBelow = window.innerHeight - rect.bottom - 4;

                if (spaceBelow >= ddHeight || spaceBelow >= rect.top) {
                    dd.style.top = rect.bottom + 'px';
                } else {
                    dd.style.top = Math.max(0, rect.top - ddHeight) + 'px';
                }
            };

            // Clean up when Tom Select is destroyed (type change)
            var origDestroy = ts.destroy.bind(ts);
            ts.destroy = function() {
                if (ts.dropdown && ts.dropdown.parentNode === document.body) {
                    document.body.removeChild(ts.dropdown);
                }
                return origDestroy();
            };
        }

        if (selectEl.tomselect) {
            attach(selectEl.tomselect);
        } else {
            var attempts = 0;
            var interval = setInterval(function() {
                attempts++;
                if (selectEl.tomselect) {
                    clearInterval(interval);
                    attach(selectEl.tomselect);
                } else if (attempts >= 10) {
                    clearInterval(interval);
                }
            }, 50);
        }
    }

    function Panels(state, events) {
        this.state = state;
        this.events = events;
        this.api = new App.API(state);

        if (!state.editMode) return;

        this._initLinkObjectPanel();
        this._initDropPortsPanel();
        this._initLinkFloorplanPanel();
        this._initFOVEditor();
        this._initLabelEditor();

        // Show/hide panels based on selected tile type
        var self = this;
        events.on('tile:select', function(tile) { self._onTileSelect(tile); });
        events.on('tile:deselect', function() { self._onTileDeselect(); });
    }

    // ─── Panel Visibility ─────────────────────────────────────────

    Panels.prototype._onTileSelect = function(tile) {
        var linkPanel = document.getElementById('link-object-panel');
        var dropPanel = document.getElementById('drop-ports-panel');
        var fpLinkPanel = document.getElementById('link-floorplan-panel');

        if (tile.type === 'drop') {
            if (linkPanel) linkPanel.classList.add('d-none');
            if (dropPanel) dropPanel.classList.remove('d-none');
            if (fpLinkPanel) fpLinkPanel.classList.add('d-none');
            this._loadAssignedPorts(tile.id);
        } else if (tile.type === 'floorplan_link') {
            if (linkPanel) linkPanel.classList.add('d-none');
            if (dropPanel) dropPanel.classList.add('d-none');
            if (fpLinkPanel) fpLinkPanel.classList.remove('d-none');
            this._updateFpLinkState(tile);
        } else {
            if (linkPanel) linkPanel.classList.remove('d-none');
            if (dropPanel) dropPanel.classList.add('d-none');
            if (fpLinkPanel) fpLinkPanel.classList.add('d-none');
            this._updateLinkState(tile);
        }
    };

    Panels.prototype._onTileDeselect = function() {
        var linkPanel = document.getElementById('link-object-panel');
        var dropPanel = document.getElementById('drop-ports-panel');
        var fpLinkPanel = document.getElementById('link-floorplan-panel');
        if (linkPanel) linkPanel.classList.add('d-none');
        if (dropPanel) dropPanel.classList.add('d-none');
        if (fpLinkPanel) fpLinkPanel.classList.add('d-none');
    };


    // ─── Link Object Panel ────────────────────────────────────────

    Panels.prototype._initLinkObjectPanel = function() {
        var s = this.state;
        var events = this.events;

        var API_ENDPOINTS = {
            'dcim.rack': '/api/dcim/racks/',
            'dcim.device': '/api/dcim/devices/',
            'dcim.powerpanel': '/api/dcim/power-panels/',
            'dcim.powerfeed': '/api/dcim/power-feeds/',
            'dcim.rearport': '/api/dcim/rear-ports/',
            'dcim.frontport': '/api/dcim/front-ports/'
        };

        var linkTypeSelect = document.getElementById('link-object-type');
        var linkObjectSelect = document.getElementById('link-object-select');
        var linkBtn = document.getElementById('link-object-btn');
        var unlinkBtn = document.getElementById('unlink-object-btn');
        var linkStatus = document.getElementById('link-status');

        if (!linkTypeSelect || !linkObjectSelect) return;

        linkObjectSelect.addEventListener('change', function() {
            linkBtn.disabled = !this.value;
        });

        // Type change — configure Tom Select
        linkTypeSelect.addEventListener('change', function() {
            var objectType = this.value;

            if (linkObjectSelect.tomselect) {
                linkObjectSelect.tomselect.destroy();
            }
            linkBtn.disabled = true;

            if (!objectType) {
                linkObjectSelect.innerHTML = '<option value="">-- Select object type first --</option>';
                linkObjectSelect.disabled = true;
                linkObjectSelect.classList.remove('api-select');
                linkObjectSelect.classList.add('no-ts');
                linkObjectSelect.removeAttribute('data-url');
                linkObjectSelect.removeAttribute('data-static-params');
                return;
            }

            var endpoint = API_ENDPOINTS[objectType];
            if (!endpoint) return;

            var typeName = objectType.split('.')[1];
            var typeLabel = typeName.charAt(0).toUpperCase() + typeName.slice(1);
            linkObjectSelect.innerHTML = '<option value=""></option>';
            linkObjectSelect.disabled = false;
            linkObjectSelect.setAttribute('data-url', endpoint);
            linkObjectSelect.setAttribute('placeholder', 'Search and select a ' + typeLabel + '...');

            if (objectType !== 'dcim.powerfeed') {
                linkObjectSelect.setAttribute('data-static-params',
                    JSON.stringify([{queryParam: 'site_id', queryValue: [String(s.siteId)]}]));
            } else {
                linkObjectSelect.removeAttribute('data-static-params');
            }

            linkObjectSelect.classList.remove('no-ts');
            linkObjectSelect.classList.remove('tomselected');
            linkObjectSelect.classList.add('api-select');

            document.dispatchEvent(new Event('htmx:afterSettle'));

            _hookTomSelectDropdown(linkObjectSelect);
        });

        // Link
        linkBtn.addEventListener('click', function() {
            var tile = s.selectedTile;
            if (!tile) { alert('No tile selected.'); return; }

            var objectType = linkTypeSelect.value;
            var objectId = parseInt(linkObjectSelect.value, 10);
            if (!objectType || !objectId) { alert('Select an object type and object.'); return; }

            linkStatus.textContent = 'Linking...';
            linkBtn.disabled = true;
            var api = new App.API(s);

            api.patch(s.apiUrl + tile.id + '/', {
                assigned_object_type: objectType,
                assigned_object_id: objectId
            }).then(function(updated) {
                linkStatus.textContent = 'Linked!';
                linkStatus.className = 'small text-success ms-1';

                var selectedText = '';
                var ts = linkObjectSelect.tomselect;
                if (ts) {
                    var opt = ts.options[String(objectId)];
                    selectedText = opt ? (opt.display || '') : '';
                }
                var assignedObj = updated.assigned_object || {};

                tile.object_type = objectType.split('.')[1];
                tile.object_type_model = objectType.split('.')[1];
                tile.object_name = assignedObj.display || selectedText;
                tile.object_id = objectId;
                tile.object_url = assignedObj.url || assignedObj.display_url || null;
                tile.utilization = updated.utilization;

                if (objectType === 'dcim.device' && assignedObj.primary_ip4) {
                    tile.primary_ip = assignedObj.primary_ip4.address ? assignedObj.primary_ip4.address.split('/')[0] : null;
                } else if (objectType === 'dcim.device' && assignedObj.primary_ip6) {
                    tile.primary_ip = assignedObj.primary_ip6.address ? assignedObj.primary_ip6.address.split('/')[0] : null;
                } else {
                    tile.primary_ip = null;
                }
                if (!tile.label) tile.label = assignedObj.display || selectedText;

                events.emit('tile:update', tile);
                events.emit('sidebar:rebuild');

                setTimeout(function() { linkStatus.textContent = ''; linkStatus.className = 'small text-muted ms-1'; }, 2000);
            }).catch(function(err) {
                linkStatus.textContent = 'Error!';
                linkStatus.className = 'small text-danger ms-1';
                alert('Error: ' + (err.detail ? JSON.stringify(err.detail) : err.message));
                linkBtn.disabled = false;
            });
        });

        // Unlink
        unlinkBtn.addEventListener('click', function() {
            var tile = s.selectedTile;
            if (!tile) return;

            linkStatus.textContent = 'Unlinking...';
            unlinkBtn.disabled = true;
            var api = new App.API(s);

            api.patch(s.apiUrl + tile.id + '/', {
                assigned_object_type: null,
                assigned_object_id: null
            }).then(function() {
                linkStatus.textContent = 'Unlinked!';
                linkStatus.className = 'small text-success ms-1';

                tile.object_type = null;
                tile.object_type_model = null;
                tile.object_name = null;
                tile.object_id = null;
                tile.object_url = null;
                tile.utilization = null;
                tile.primary_ip = null;

                events.emit('tile:update', tile);
                events.emit('sidebar:rebuild');

                setTimeout(function() { linkStatus.textContent = ''; linkStatus.className = 'small text-muted ms-1'; }, 2000);
            }).catch(function(err) {
                alert('Error: ' + (err.detail ? JSON.stringify(err.detail) : err.message));
                unlinkBtn.disabled = false;
            });
        });
    };

    Panels.prototype._updateLinkState = function(tile) {
        var linkCurrent = document.getElementById('link-current');
        var unlinkBtn = document.getElementById('unlink-object-btn');
        if (!linkCurrent) return;

        if (tile.object_type) {
            linkCurrent.innerHTML = 'Currently linked: <strong>' + tile.object_type + '</strong>';
            if (unlinkBtn) unlinkBtn.disabled = false;
        } else {
            linkCurrent.textContent = 'No object linked to this tile.';
            if (unlinkBtn) unlinkBtn.disabled = true;
        }
    };

    // ─── Drop Ports Panel ─────────────────────────────────────────

    Panels.prototype._initDropPortsPanel = function() {
        var s = this.state;
        var events = this.events;
        var self = this;

        var DROP_API_ENDPOINTS = {
            'dcim.frontport': '/api/dcim/front-ports/',
            'dcim.rearport': '/api/dcim/rear-ports/'
        };
        var assignmentApiUrl = '/api/plugins/map/tile-port-assignments/';

        var portTypeSelect = document.getElementById('drop-port-type');
        var portSelect = document.getElementById('drop-port-select');
        var addBtn = document.getElementById('add-drop-port-btn');
        var statusEl = document.getElementById('drop-port-status');

        if (!portTypeSelect || !portSelect) return;

        this._assignmentApiUrl = assignmentApiUrl;

        portSelect.addEventListener('change', function() {
            addBtn.disabled = !this.value;
        });

        // Port type change — configure Tom Select
        portTypeSelect.addEventListener('change', function() {
            var portType = this.value;

            if (portSelect.tomselect) {
                portSelect.tomselect.destroy();
            }
            addBtn.disabled = true;

            if (!portType) {
                portSelect.innerHTML = '<option value="">-- Select port type first --</option>';
                portSelect.disabled = true;
                portSelect.classList.remove('api-select');
                portSelect.classList.add('no-ts');
                portSelect.removeAttribute('data-url');
                portSelect.removeAttribute('data-static-params');
                return;
            }

            var endpoint = DROP_API_ENDPOINTS[portType];
            if (!endpoint) return;

            var typeName = portType.split('.')[1];
            var typeLabel = typeName === 'frontport' ? 'Front Port' : 'Rear Port';
            portSelect.innerHTML = '<option value=""></option>';
            portSelect.disabled = false;
            portSelect.setAttribute('data-url', endpoint);
            portSelect.setAttribute('placeholder', 'Search and select a ' + typeLabel + '...');
            portSelect.setAttribute('data-static-params',
                JSON.stringify([{queryParam: 'site_id', queryValue: [String(s.siteId)]}]));

            portSelect.classList.remove('no-ts');
            portSelect.classList.remove('tomselected');
            portSelect.classList.add('api-select');

            document.dispatchEvent(new Event('htmx:afterSettle'));

            _hookTomSelectDropdown(portSelect);
        });

        // Add port
        addBtn.addEventListener('click', function() {
            var tile = s.selectedTile;
            if (!tile) return;

            var portType = portTypeSelect.value;
            var portId = parseInt(portSelect.value, 10);
            if (!portType || !portId) return;

            statusEl.textContent = 'Adding...';
            addBtn.disabled = true;

            var api = new App.API(s);
            api.post(assignmentApiUrl, {
                tile: tile.id,
                port_type: portType,
                port_id: portId
            }).then(function() {
                statusEl.textContent = 'Added!';
                statusEl.className = 'small text-success ms-1';
                addBtn.disabled = false;

                tile.drop_port_count = (tile.drop_port_count || 0) + 1;
                events.emit('tile:update', tile);
                events.emit('ports:change', { tileId: tile.id });

                self._loadAssignedPorts(tile.id);
                setTimeout(function() { statusEl.textContent = ''; statusEl.className = 'small text-muted ms-1'; }, 2000);
            }).catch(function(err) {
                statusEl.textContent = 'Error!';
                statusEl.className = 'small text-danger ms-1';
                addBtn.disabled = false;
                console.error('Drop port add error:', err.message);
                self._loadAssignedPorts(tile.id);
                setTimeout(function() { statusEl.textContent = ''; statusEl.className = 'small text-muted ms-1'; }, 3000);
            });
        });
    };

    Panels.prototype._loadAssignedPorts = function(tileId) {
        var s = this.state;
        var events = this.events;
        var self = this;
        var portListEl = document.getElementById('drop-port-list');
        if (!portListEl) return;
        var assignmentApiUrl = this._assignmentApiUrl || '/api/plugins/map/tile-port-assignments/';

        fetch(assignmentApiUrl + '?tile_id=' + tileId, { credentials: 'same-origin' })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            var results = data.results || [];
            var html = '';
            for (var i = 0; i < results.length; i++) {
                var a = results[i];
                var portName = a.port ? (a.port.display || ('Port #' + a.port_id)) : ('Port #' + a.port_id);
                var portTypeBadge = a.port_type === 'dcim.frontport'
                    ? '<span class="badge bg-primary text-white me-1">FP</span>'
                    : '<span class="badge bg-info text-white me-1">RP</span>';
                html += '<div class="d-flex align-items-center gap-1 mb-1">';
                html += portTypeBadge;
                html += '<span class="small flex-grow-1">' + portName + '</span>';
                html += '<button class="btn btn-sm btn-outline-danger px-1 remove-drop-port" data-id="' + a.id + '" title="Remove">';
                html += '<i class="mdi mdi-close"></i></button></div>';
            }
            portListEl.innerHTML = html || '<span class="text-muted small">No ports assigned</span>';

            // Remove handlers
            var removeBtns = portListEl.querySelectorAll('.remove-drop-port');
            for (var j = 0; j < removeBtns.length; j++) {
                removeBtns[j].addEventListener('click', (function(btn) {
                    return function() {
                        var assignId = btn.getAttribute('data-id');
                        var api = new App.API(s);
                        api.del(assignmentApiUrl + assignId + '/').then(function() {
                            var tile = s.selectedTile;
                            if (tile) {
                                tile.drop_port_count = Math.max(0, (tile.drop_port_count || 1) - 1);
                                events.emit('tile:update', tile);
                                events.emit('ports:change', { tileId: tile.id });
                            }
                            self._loadAssignedPorts(tileId);
                        });
                    };
                })(removeBtns[j]));
            }
        });
    };

    // ─── Link Floorplan Panel ─────────────────────────────────────

    Panels.prototype._initLinkFloorplanPanel = function() {
        var s = this.state;
        var events = this.events;

        var fpLinkSelect = document.getElementById('link-floorplan-select');
        var fpLinkBtn = document.getElementById('link-floorplan-btn');
        var fpUnlinkBtn = document.getElementById('unlink-floorplan-btn');
        var fpLinkStatus = document.getElementById('link-floorplan-status');
        var fpLinkCurrent = document.getElementById('link-floorplan-current');

        if (!fpLinkSelect) return;

        fpLinkSelect.addEventListener('change', function() {
            fpLinkBtn.disabled = !this.value;
        });

        // Link
        fpLinkBtn.addEventListener('click', function() {
            var tile = s.selectedTile;
            if (!tile) { alert('No tile selected.'); return; }

            var fpId = parseInt(fpLinkSelect.value, 10);
            if (!fpId) { alert('Select a floor plan.'); return; }

            fpLinkStatus.textContent = 'Linking...';
            fpLinkBtn.disabled = true;
            var api = new App.API(s);

            api.patch(s.apiUrl + tile.id + '/', { linked_floorplan: fpId })
            .then(function(updated) {
                fpLinkStatus.textContent = 'Linked!';
                fpLinkStatus.className = 'small text-success ms-1';

                var selectedOpt = fpLinkSelect.options[fpLinkSelect.selectedIndex];
                var fpName = selectedOpt ? selectedOpt.textContent : '';

                tile.linked_floorplan_id = fpId;
                tile.linked_floorplan_name = fpName;
                tile.linked_floorplan_url = '/plugins/map/floorplans/' + fpId + '/visualization/';
                if (!tile.label) tile.label = fpName;

                events.emit('tile:update', tile);
                events.emit('sidebar:rebuild');

                fpUnlinkBtn.disabled = false;
                var name = fpName || ('Floor Plan #' + fpId);
                fpLinkCurrent.innerHTML = 'Linked to: <a href="/plugins/map/floorplans/' + fpId + '/visualization/"><strong>' + name + '</strong></a>';

                setTimeout(function() { fpLinkStatus.textContent = ''; fpLinkStatus.className = 'small text-muted ms-1'; }, 2000);
            }).catch(function(err) {
                fpLinkStatus.textContent = 'Error!';
                fpLinkStatus.className = 'small text-danger ms-1';
                alert('Error: ' + (err.detail ? JSON.stringify(err.detail) : err.message));
                fpLinkBtn.disabled = false;
            });
        });

        // Unlink
        fpUnlinkBtn.addEventListener('click', function() {
            var tile = s.selectedTile;
            if (!tile) return;

            fpLinkStatus.textContent = 'Unlinking...';
            fpUnlinkBtn.disabled = true;
            var api = new App.API(s);

            api.patch(s.apiUrl + tile.id + '/', { linked_floorplan: null })
            .then(function() {
                fpLinkStatus.textContent = 'Unlinked!';
                fpLinkStatus.className = 'small text-success ms-1';

                tile.linked_floorplan_id = null;
                tile.linked_floorplan_name = null;
                tile.linked_floorplan_url = null;

                events.emit('tile:update', tile);
                events.emit('sidebar:rebuild');

                fpLinkCurrent.textContent = 'No floor plan linked.';
                fpLinkSelect.value = '';
                fpLinkBtn.disabled = true;
                setTimeout(function() { fpLinkStatus.textContent = ''; fpLinkStatus.className = 'small text-muted ms-1'; }, 2000);
            }).catch(function(err) {
                alert('Error: ' + (err.detail ? JSON.stringify(err.detail) : err.message));
                fpUnlinkBtn.disabled = false;
            });
        });
    };

    Panels.prototype._updateFpLinkState = function(tile) {
        var fpLinkSelect = document.getElementById('link-floorplan-select');
        var fpLinkBtn = document.getElementById('link-floorplan-btn');
        var fpUnlinkBtn = document.getElementById('unlink-floorplan-btn');
        var fpLinkCurrent = document.getElementById('link-floorplan-current');
        var fpLinkStatus = document.getElementById('link-floorplan-status');
        if (!fpLinkCurrent) return;

        if (tile.linked_floorplan_id) {
            var name = tile.linked_floorplan_name || ('Floor Plan #' + tile.linked_floorplan_id);
            if (tile.linked_floorplan_url) {
                fpLinkCurrent.innerHTML = 'Linked to: <a href="' + tile.linked_floorplan_url + '"><strong>' + name + '</strong></a>';
            } else {
                fpLinkCurrent.innerHTML = 'Linked to: <strong>' + name + '</strong>';
            }
            if (fpUnlinkBtn) fpUnlinkBtn.disabled = false;
            if (fpLinkSelect) fpLinkSelect.value = String(tile.linked_floorplan_id);
        } else {
            fpLinkCurrent.textContent = 'No floor plan linked.';
            if (fpUnlinkBtn) fpUnlinkBtn.disabled = true;
            if (fpLinkSelect) fpLinkSelect.value = '';
        }
        if (fpLinkStatus) fpLinkStatus.textContent = '';
        if (fpLinkBtn) fpLinkBtn.disabled = !fpLinkSelect || !fpLinkSelect.value;
    };

    // ─── FOV Editor ───────────────────────────────────────────────

    Panels.prototype._initFOVEditor = function() {
        var s = this.state;
        var events = this.events;

        var fovDirInput = document.getElementById('edit-fov-direction');
        var fovAngleInput = document.getElementById('edit-fov-angle');
        var fovDistInput = document.getElementById('edit-fov-distance');
        var fovDirSlider = document.getElementById('edit-fov-direction-slider');
        var fovAngleSlider = document.getElementById('edit-fov-angle-slider');
        var fovDistSlider = document.getElementById('edit-fov-distance-slider');
        var saveFovBtn = document.getElementById('save-fov-btn');

        if (!fovDirInput) return;

        function onFovInputChange() {
            var tile = s.selectedTile;
            if (!tile || tile.type !== 'camera') return;
            tile.fov_direction = parseInt(fovDirInput.value, 10) || 0;
            tile.fov_angle = parseInt(fovAngleInput.value, 10) || 90;
            tile.fov_distance = parseInt(fovDistInput.value, 10) || 5;
            events.emit('render');
        }

        // Bidirectional sync: slider ↔ number input
        function syncPair(slider, number) {
            if (!slider || !number) return;
            slider.addEventListener('input', function() {
                number.value = slider.value;
                onFovInputChange();
            });
            number.addEventListener('input', function() {
                slider.value = number.value;
                onFovInputChange();
            });
        }

        syncPair(fovDirSlider, fovDirInput);
        syncPair(fovAngleSlider, fovAngleInput);
        syncPair(fovDistSlider, fovDistInput);

        if (saveFovBtn) {
            saveFovBtn.addEventListener('click', function() {
                var tile = s.selectedTile;
                if (!tile || tile.type !== 'camera') return;

                saveFovBtn.innerHTML = '<i class="mdi mdi-loading mdi-spin"></i> Saving...';
                saveFovBtn.disabled = true;
                var api = new App.API(s);

                api.patch(s.apiUrl + tile.id + '/', {
                    fov_direction: parseInt(fovDirInput.value, 10) || 0,
                    fov_angle: parseInt(fovAngleInput.value, 10) || 90,
                    fov_distance: parseInt(fovDistInput.value, 10) || 5
                }).then(function() {
                    saveFovBtn.innerHTML = '<i class="mdi mdi-check"></i> Saved!';
                    saveFovBtn.disabled = false;
                    setTimeout(function() {
                        saveFovBtn.innerHTML = '<i class="mdi mdi-check"></i> Save';
                    }, 2000);
                }).catch(function(err) {
                    console.error('FOV save error:', err);
                    alert('Error: ' + (err.detail ? JSON.stringify(err.detail) : err.message));
                    saveFovBtn.innerHTML = '<i class="mdi mdi-check"></i> Save';
                    saveFovBtn.disabled = false;
                });
            });
        }
    };

    // ─── Label Editor ─────────────────────────────────────────────

    Panels.prototype._initLabelEditor = function() {
        var s = this.state;
        var events = this.events;

        var editLabelBtn = document.getElementById('edit-label-btn');
        var editLabelForm = document.getElementById('edit-label-form');
        var editLabelInput = document.getElementById('edit-label-input');
        var saveLabelBtn = document.getElementById('save-label-btn');
        var cancelLabelBtn = document.getElementById('cancel-label-btn');

        if (!editLabelBtn || !editLabelForm) return;

        function showLabelEditor() {
            var tile = s.selectedTile;
            if (!tile) return;
            editLabelInput.value = tile.label || '';
            editLabelForm.classList.remove('d-none');
            editLabelInput.focus();
        }

        function hideLabelEditor() {
            editLabelForm.classList.add('d-none');
        }

        function saveLabel() {
            var tile = s.selectedTile;
            if (!tile) return;
            var newLabel = editLabelInput.value.trim();
            var api = new App.API(s);

            api.patch(s.apiUrl + tile.id + '/', { label: newLabel })
            .then(function() {
                tile.label = newLabel;
                hideLabelEditor();
                var nameEl = document.getElementById('tile-detail-name');
                if (nameEl) nameEl.textContent = newLabel || '-';
                events.emit('tile:update', tile);
                events.emit('sidebar:rebuild');
            })
            .catch(function(err) {
                alert('Error: ' + (err.detail ? JSON.stringify(err.detail) : err.message));
            });
        }

        editLabelBtn.addEventListener('click', showLabelEditor);
        if (saveLabelBtn) saveLabelBtn.addEventListener('click', saveLabel);
        if (cancelLabelBtn) cancelLabelBtn.addEventListener('click', hideLabelEditor);
        if (editLabelInput) {
            editLabelInput.addEventListener('keydown', function(e) {
                if (e.key === 'Enter') saveLabel();
                if (e.key === 'Escape') hideLabelEditor();
            });
        }
    };

    App.Panels = Panels;

})(window.FloorplanApp);
