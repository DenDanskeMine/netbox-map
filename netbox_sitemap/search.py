from netbox.search import SearchIndex, register_search
from .models import FloorPlan, FloorPlanTile


@register_search
class FloorPlanIndex(SearchIndex):
    model = FloorPlan
    fields = (
        ('name', 100),
        ('description', 500),
        ('comments', 5000),
    )


@register_search
class FloorPlanTileIndex(SearchIndex):
    model = FloorPlanTile
    fields = (
        ('label', 100),
    )
