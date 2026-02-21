VENV     := venv
PYTHON   := $(VENV)/bin/python
PIP      := $(VENV)/bin/pip
TWINE    := $(VENV)/bin/twine
BUILD    := $(VENV)/bin/python -m build

.PHONY: setup clean build test-upload upload check

## First-time dev setup (run once after apt packages are installed)
setup:
	python3 -m venv $(VENV)
	$(PIP) install --upgrade pip
	$(PIP) install build twine
	@echo ""
	@echo "=== Dev environment ready ==="
	@echo "Activate with:  source $(VENV)/bin/activate"

## Remove all build artifacts
clean:
	rm -rf dist/ build/ *.egg-info netbox_sitemap.egg-info netbox_sitemap/__pycache__

## Build sdist + wheel
build: clean
	$(BUILD)

## Validate the built package
check: build
	$(TWINE) check dist/*

## Upload to TestPyPI (https://test.pypi.org)
test-upload: check
	@. ./.env && TWINE_PASSWORD=$$TEST_PYPI_API_TOKEN $(TWINE) upload --repository testpypi dist/*

## Upload to real PyPI
upload: check
	@. ./.env && TWINE_PASSWORD=$$PYPI_API_TOKEN $(TWINE) upload dist/*
