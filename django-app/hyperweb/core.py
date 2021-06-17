"""
Core system items defined as Python objects.


item.title: type Text; any string, any language, possibly rich text; multiple variants for different languages;
            no need to ensure uniqueness (!)
item.name: type String; human-readable non-unique name; different languages, but NO rich text
directory[item].name: open relation, unique names; no natural "auto-increment"; new names assigned by item creator;
           names must be stored in a TABLE to allow transactional inserts (primary data, not derived);
           derived INDEX maps item IDs back to names (reversed link)
Directory: one-directional mapping name -> item
Namespace: bidirectional mapping name <-> item
"""

import json, yaml

from hyperweb.item import Category, Route
from hyperweb.registry import Registry
from hyperweb.schema import *


#####################################################################################################################################################
#####
#####  ELEMENTS of items
#####

# TODO pass context objects separately: $data, $item, $category, $user, $request, $route, $app, $site, ($load)
# TODO allow imports from directory

# default template that displays a generic item page if a category-specific template is missing
page_item = """
    context $item, $category as cat, $app, $route, $directory

    style / $app['base_style']

    % print_headline
            p .catlink
            a href=$route(cat) | {cat['name']? or cat}
            | ($item.cid,$item.iid)

    html
        $name = item['name']? or str(item)
        head
            title | {name}
        body .page
            h1  | {name}
            print_headline
            
            # p
            #     | script:
            #     pre
            #         / $directory.open('pages_common')['code']
            
            # from /site/pages import %print_data
            # from /site/app_X/pages import %print_data
            # from /templates import %print_data
            # $item.print_data x1 x2 x3
            # $item.view.data x1 x2 x3     # `view` is a complete HT script that exposes multiple symbols
            # $item.data       $paper.title    $paper.data()
            # $app['base_widgets']
            # @(item.dom_properties())     -- item's method returns a DOM tree for embedding into a document
            # %(item.print_data) x1 x2     -- item's attr is a Hypertag that can be used as a tag in a document
            
            h2 | Properties
            
            from pages_common import %print_data
            print_data $item
            
            # ul
            #     for attr, value in item.data.items()
            #         li
            #             b | {attr}:
            #             . | {str(value)}
"""

# template that displays a category page
page_category = """
    context $item, $category as cat, $app, $route, $directory

    style / $app['base_style']

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

            h2 | Properties
            
            from pages_common import %print_data
            print_data $cat

            # ul
            #     for attr, value in cat.data.items()
            #         li
            #             b | {attr}:
            #             . | {str(value)}

            h2  | Items
            table
                for item in cat.registry.load_items(cat)
                    tr
                        td / #{item.iid} &nbsp;
                        td : a href=$route(item)
                            | {item['name']? or item}
"""

# text_schema = Struct(name = String(), language = String(), markup = String(), text = Text())   # HumanLang() MarkupLang() Text()
# code_schema = Struct(name = String(), language = String(), code = Text())   # ProgramLang() Code()
# method_schema = Struct(language = String(), code = Text())
# class_schema = Select(native = Class(), inline = code_schema)       # reference = Link(_Code)


# schema of categories, including the root category
root_schema = Record(
    schema       = Field(schema = RecordSchema(), default = Record()),
    name         = Field(schema = String(), info = "human-readable title of the category"),
    info         = String(),
    class_name   = Field(schema = String(), default = 'hyperweb.item.Item', info = "Full (dotted) path of a python class. Or the class name that should be imported from `class_code` after its execution."),
    class_code   = Text(),     # TODO: take class name from `name` not `class_name`; drop class_name; rename class_code to `code`
    templates    = Field(schema = Catalog(Text()), default = {"": page_item}),
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

_Directory = _Category(
    info        = "A directory of items, each item has a unique name (path). May contain nested subdirectories. Similar to a file system.",
    class_name  = 'hyperweb.item.Directory',
    schema      = Record(items = Catalog(keys = EntryName(), values = Link())),      # file & directory names mapped to item IDs
)
# file system arrangement (root directory organization) - see https://en.wikipedia.org/wiki/Filesystem_Hierarchy_Standard
#  /categories/* (auto) -- categories listed by IID (or IID_name?), each entry links to a profile, shows links to other endpoints, and a link to /items/CAT
#  /items/CAT/* (auto) -- items in a category, CAT, listed by *IID* ... /item/Category/* lists categories by IID
#  /system/* -- global resources available in this installation: schemas, templates, images, css, js, ...
#  /apps/APP/* -- assets of an application, APP; no writes, only reads; on search path when loading assets internally
#  /data/APP/* -- working directory of an application, APP, where app-specific data items can be created and modified
#  /site -- the global Site item that's booted upon startup (?)

_Space = _Category(
    name        = "Space",
    info        = "Category of items that represent item spaces.",
    schema      = Record(name = String(), categories = Catalog(Link(_Category))),
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
    schema      = Record(name = String(), spaces = Catalog(Link(_Space))),
    folder      = PathString(),         # path to a folder in the site's directory where this application was installed;
                                        # if the app needs to store data items in the directory, it's recommended
                                        # to do this inside a .../data subfolder
)

route_schema    = Struct(Route, base = String(), path = String(), app = Link(_Application))

_Site = _Category(
    name        = "Site",
    info        = "Category of site records. A site contains information about applications, servers, startup",
    class_name  = 'hyperweb.item.Site',
    schema      = Record(name = String(),
                         routes = Field(schema = Catalog(route_schema),
                                        multi = False,
                                        info = "dictionary of named URL routes, each route specifies a base URL (protocol+domain), fixed URL path prefix, and a target application object")),
    directory   = Link(_Directory),     # root of the site-global hierarchical directory of items
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
    # schema  = text_schema,
)
_Code = _Category(
    name    = 'Code',
    info    = '''A piece of source code. May keep information about programming language.
                If Code item is used in a context where a single object (a class, a function) is expected,
                the `name` property must be set and equal to the name of the object that should be imported
                from the code after its compilation. Some uses may allow multiple names to be declared.
    ''',
    # schema  = code_schema,
)

# _CodeObject = Struct(name = String(), code = String())         # inline code with a python object: a class, a function, ...
# _Import     = Struct(name = String(), code = Link(_Code))      # an object imported from a Code item

# _SchemaType = _Category(
#     name        = "SchemaType",
#     schema      = '???',
# )
# _Struct = _SchemaType(
#     name = 'Struct',
#     schema = Record(name = String(), type = Class(), fields = Catalog(Object(Schema))),
# )

#####################################################################################################################################################
#####
#####  ITEMS
#####

pages_common = _Code(
    lang = 'hypertag',
    code = """
        %print_data item
            ul
                for field, value in item.data.items()
                    li
                        b | {field}:
                        . | {str(value)}
    """,
)

directory = _Directory(
    items = {
        'pages_common': pages_common,
    },
)

#####################################################################################################################################################

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
    base_widgets = """
        %properties_list item
            h2  | Properties
            ul
                for attr, value in item.data.items()
                    li
                        b | {attr}:
                        . | {str(value)}
    """,
)

catalog_wiki = _Site(
    name        = "catalog.wiki",
    routes      = {'default': Route(base = "http://localhost:8001", path = "/", app = Catalog_wiki)},
    directory   = directory,
)


#####################################################################################################################################################

item_001 = _Varia(title = "Ala ma kota Sierściucha i psa Kłapoucha.")
item_002 = _Varia(title = "ąłęÓŁŻŹŚ")
item_002.add('name', "test_item", "duplicate")


#####################################################################################################################################################

core_items = {name: obj for name, obj in globals().items() if isinstance(obj, Item)}

print('core items:')
for name in core_items.keys(): print(name)
print()
core_items = list(core_items.values())


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
    
