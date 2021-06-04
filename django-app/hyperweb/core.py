"""
Core system items defined as Python objects.
"""
from hyperweb.item import RootCategory, Category
from hyperweb.schema import Record


rootCategory = RootCategory(
    name = "Category",
    info = "Category of items that represent categories",
    itemclass = Category,
    
    schema = Record(),
    
    templates = {},
)