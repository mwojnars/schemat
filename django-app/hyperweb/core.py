"""
Core system items defined as Python objects.
"""

import json, yaml

from hyperweb.item import Category, Route
from hyperweb.registry import Registry
from hyperweb.schema import Schema, Object, Boolean, String, Text, Class, Dict, Link, Select, Field, Record, Struct, RecordSchema


#####################################################################################################################################################
#####
#####  ELEMENTS of items
#####

# default template that displays a generic item page if a category-specific template is missing
page_item = """
    context $view
    $item = view._item
    $cat  = item.category

    style !
        body { font: 16px/24px 'Quattrocento Sans', "Helvetica Neue", Helvetica, Arial, sans-serif; }
        .page { width: 980px; margin: 0 auto; overflow: hidden }
        h1 { font-size: 26px; line-height: 34px; margin-top: 30px }
        .catlink { font-size: 14px; margin-top: -20px }

    % print_headline
            p .catlink
            a href=$view.url(cat) | {cat['name']? or cat}
            | ($item.cid,$item.iid)

    html
        $name = item['name']? or str(item)
        head
            title | {name}
        body .page
            h1  | {name}
            print_headline
            # from hyperweb.pages import %print_data
            # from +pages import %print_data
            # print_data $view
            # $item.print_data()
            # $item.print_data x1 x2 x3
            # $item.view.data x1 x2 x3     # `view` is a complete HT script that exposes multiple symbols
            # $item.data       $paper.title    $paper.data()
            h2  | Properties
            ul
                for attr, value in item.data.items()
                    li
                        b | {attr}:
                        . | {str(value)}
"""

# template that displays a category page
page_category = """
    context $view
    $cat = view._item

    style !
        body { font: 16px/24px 'Quattrocento Sans', "Helvetica Neue", Helvetica, Arial, sans-serif; }
        .page { width: 980px; margin: 0 auto; overflow: hidden }
        h1 { font-size: 26px; line-height: 34px; margin-top: 30px }
        .catlink { font-size: 14px; margin-top: -20px }

    html
        $name = cat['name']? or str(cat)
        head
            title | {name ' -' }? category #{cat.iid}
        body .page
            h1
                try
                    i | $name
                    . | -
                | category #{cat.iid}
            h2  | Properties
            ul
                for attr, value in cat.data.items()
                    li
                        b | {attr}:
                        . | {str(value)}
            h2  | Items
            table
                for item in cat.registry.load_items(cat)
                    tr
                        td / #{item.iid} &nbsp;
                        td : a href=$view.url(item)
                            | {item['name']? or item}
"""

text_schema = Struct(name = String(), language = String(), markup = String(), text = Text())   # HumanLang() MarkupLang() Text()
code_schema = Struct(name = String(), language = String(), code = Text())   # ProgramLang() Code()
method_schema = Struct(language = String(), code = Text())

class_schema = Select(native = Class(), inline = code_schema)       # reference = Link(_Code)


# schema of categories, including the root category
root_schema = Record(
    schema       = RecordSchema(),
    name         = Field(schema = String(), info = "human-readable title of the category"),
    info         = String(),
    class_name   = Field(schema = String(), default = 'hyperweb.item.Item', info = "Full (dotted) path of a python class. Or the class name that should be imported from `class_code` after its execution."),
    class_code   = Text(),     # TODO: take class name from `name` not `class_name`; drop class_name; rename class_code to `code`
    templates    = Field(schema = Dict(String(), Text()), default = {"": page_item}),
    # templates  = Field(schema = Catalog(Text()), default = {"": page_item}),
    # template   = Field(schema = Struct(name = String(), code = Text()), default = ("", page_item)),
    # methods    = Catalog(method_schema),
    # handlers... views...
    # ...
    # properties = Catalog(Property())
)

# category-level properties:
# - Method -> code + language + caching settings
# ? Handler -> code
# - View / template -> Hypertag code (full script)
# ? Hypertag / snippet -> Hypertag code (individual symbol)

# item-level properties:
# - Field -> schema + default
# - Asset: style (css), javascript (js), image, ...


#####################################################################################################################################################
#####
#####  CATEGORIES
#####

_Category = Category(
    name        = "Category",
    info        = "Category of items that represent categories",
    class_name  = 'hyperweb.item.Category',
    schema      = root_schema,
    templates   = {"": page_category},
    # view_category = Template(page_category),
    # view_item     = Template(page_item),
    # fun  = Method(...),
    # new  = Handler(...),
)
_Category.category = _Category

_Space = _Category(
    name        = "Space",
    info        = "Category of items that represent item spaces.",
    schema      = Record(name = String(), categories = Dict(String(), Link(_Category))),
    # class_name  = 'hyperweb.item.Space',
    class_name  = "Space",
    class_code  =
    """
        from hyperweb.item import Item
        class Space(Item):
            def get_category(self, name):
                return self['categories'][name]
    """,
    # get_category = Method("""
    #     def get_category(self, name):
    #         return self['categories'][name]
    # """),
)

_Application = _Category(
    name        = "Application",
    info        = "Category of application records. An application groups all spaces & categories available in the system and provides system-level configuration.",
    # class_name  = 'hyperweb.item.Application',
    class_name  = "Application",
    class_code  =
    """
        from hyperweb.item import Item
        class Application(Item):
            def get_space(self, name):
                return self['spaces'][name]
    """,
    schema      = Record(name = String(), spaces = Dict(String(), Link(_Space))),
)

route_schema    = Struct(Route, base = String(), path = String(), app = Link(_Application))

_Site = _Category(
    name        = "Site",
    info        = "Category of site records. A site contains information about applications, servers, startup",
    class_name  = 'hyperweb.item.Site',
    schema      = Record(name = String(),
                         routes = Field(schema = Dict(String(), route_schema),
                                        multi = False,
                                        info = "dictionary of named URL routes, each route specifies a base URL (protocol+domain), fixed URL path prefix, and a target application object")),
)

_Varia = _Category(
    name        = "Varia",
    info        = "Category of items that do not belong to any specific category",
    class_name  = 'hyperweb.item.Item',
    schema      = Record(name = Field(schema = String(), multi = True), title = String()),
)

_Text = _Category(
    name    = 'Text',
    info    = 'A piece of plain or rich text for human consumption. May keep information about language and/or markup.',
    schema  = text_schema,
)
_Code = _Category(
    name    = 'Code',
    info    = '''A piece of source code. May keep information about programming language.
                If Code item is used in a context where a single object (a class, a function) is expected,
                the `name` property must be set and equal to the name of the object that should be imported
                from the code after its compilation. Some uses may allow multiple names to be declared.
    ''',
    schema  = code_schema,
)

# _CodeObject = Struct(name = String(), code = String())         # inline code with a python object: a class, a function, ...
# _Import     = Struct(name = String(), code = Link(_Code))      # an object imported from a Code item

# _SchemaType = _Category(
#     name        = "SchemaType",
#     schema      = '???',
# )
# _Struct = _SchemaType(
#     name = 'Struct',
#     schema = Record(name = String(), type = Class(), fields = Dict(String(), Object(Schema))),
# )

#####################################################################################################################################################
#####
#####  ITEMS
#####

meta_space = _Space(
    name        = "Meta",
    categories  = {'category': _Category, 'item': _Varia}
)

sys_space = _Space(
    name        = "System",
    categories  = {'space': _Space, 'app': _Application, 'site': _Site}
)

Catalog_wiki = _Application(
    name        = "Catalog.wiki",
    spaces      = {'meta': meta_space, 'sys': sys_space},

    base_style  = """
        body { font: 16px/24px 'Quattrocento Sans', "Helvetica Neue", Helvetica, Arial, sans-serif; }
        .page { width: 980px; margin: 0 auto; overflow: hidden }
        h1 { font-size: 26px; line-height: 34px; margin-top: 30px }
        .catlink { font-size: 14px; margin-top: -20px }
    """,
    base_widgets = """::hypertag::
        %properties_list item
            h2  | Properties
            ul
                for attr, value in item.data.items()
                    li
                        b | {attr}:
                        . | {str(value)}
    """
)

catalog_wiki = _Site(
    name        = "catalog.wiki",
    routes      = {'default': Route(base = "http://localhost:8001", path = "/", app = Catalog_wiki)},
)

# pages_common = code_schema(...)
pages_common = _Code(
    name = 'print_data',
    lang = 'hypertag',
    code = """
        %print_data $item
            h2  | Data
            ul
                for field, value in item.data.items()
                    li
                        b | {field}:
                        . | {str(value)}
    """,
)


#####################################################################################################################################################

item_001 = _Varia(title = "Ala ma kota Sierściucha i psa Kłapoucha.")
item_002 = _Varia(title = "ąłęÓŁŻŹŚ")
item_002.add('name', "test_item", "duplicate")


#####################################################################################################################################################

core_items = [
    _Category,
    _Space,
    _Application,
    _Site,
    _Varia,
    meta_space,
    sys_space,
    Catalog_wiki,
    catalog_wiki,
    # _Struct,
    
    item_001,
    item_002,
]


#####################################################################################################################################################

if __name__ == "__main__":
    
    print()
    flats = []

    registry = Registry()
    registry.seed(core_items)
    
    # serialize items to YAML
    for item in core_items:
        
        raw  = item.to_json()
        flat = {'id': list(item.id)}
        flat.update(json.loads(raw))
        flats.append(flat)
        # print(yaml.dump(flat))
        
    print()
    print("ITEMS:")
    print()
    print(yaml.dump(flats, default_flow_style = None, sort_keys = False, allow_unicode = True))
    
