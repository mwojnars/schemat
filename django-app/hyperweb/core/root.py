from hyperweb.schema import *
from hyperweb.item import Index


# default template to display a generic item page if a category-specific template is missing
page_item = """
context $item
from base import %page_item
page_item $item
# dedent : page_item $item
"""


# fields of categories, including the root category
root_fields = FIELDS(
    name         = Field(STRING(), info = "human-readable title of the category"),
    info         = Field(STRING()),
    prototype    = Field(ITEM(), info = "Base category from which this one inherits. Multiple prototypes are allowed, the first ones override settings of subsequent ones."),
    class_name   = Field(STRING(), default = 'hyperweb.core.Item', info = "Full (dotted) path of a python class. Or the class name that should be imported from `class_code` after its execution."),
    class_code   = Field(TEXT()),     # TODO: take class name from `name` not `class_name`; drop class_name; rename class_code to `code`
    endpoints    = Field(CATALOG(CODE()), default = {"view": page_item}),
    fields       = Field(CATALOG(FIELD(), type = FIELDS)),
    indexes      = Field(CATALOG(ITEM(Index))),
)

