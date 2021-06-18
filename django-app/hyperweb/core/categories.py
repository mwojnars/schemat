from hyperweb.item import Category, Route
from hyperweb.schema import *


#####################################################################################################################################################
#####
#####  ELEMENTS of items
#####

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
            
            # $item.print_data x1 x2 x3
            # @(item.dom_properties())     -- item's method returns a DOM tree for embedding into a document
            # %(item.print_data) x1 x2     -- item's attr is a Hypertag that can be used as a tag in a document
            
            # from APP/pages import %print_data
            # from /apps/APP/pages import %print_data
            from pages_common import %print_data

            h2 | Properties
            print_data $item
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

            h2 | Items
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
#####  CATEGORIES... The underscore _ is appended to names to avoid name clash with schema classes
#####

Category_ = Category(
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
Category_.category = Category_

Directory_ = Category_(
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

Space_ = Category_(
    name        = "Space",
    info        = "Category of items that represent item spaces.",
    schema      = Record(name = String(), categories = Catalog(Link(Category_))),
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

Application_ = Category_(
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
    schema      = Record(name = String(), spaces = Catalog(Link(Space_))),
    folder      = PathString(),         # path to a folder in the site's directory where this application was installed;
                                        # if the app needs to store data items in the directory, it's recommended
                                        # to do this inside a .../data subfolder
)

route_schema    = Struct(Route, base = String(), path = String(), app = Link(Application_))

Site_ = Category_(
    name        = "Site",
    info        = "Category of site records. A site contains information about applications, servers, startup",
    class_name  = 'hyperweb.item.Site',
    schema      = Record(name = String(),
                         routes = Field(schema = Catalog(route_schema),
                                        multi = False,
                                        info = "dictionary of named URL routes, each route specifies a base URL (protocol+domain), fixed URL path prefix, and a target application object")),
    directory   = Link(Directory_),     # root of the site-global hierarchical directory of items
)

Varia_ = Category_(
    name        = "Varia",
    info        = "Category of items that do not belong to any specific category",
    class_name  = 'hyperweb.item.Item',
    schema      = Record(name = Field(schema = String(), multi = True), title = String()),
)

Text_ = Category_(
    name    = 'Text',
    info    = 'A piece of plain or rich text for human consumption. May keep information about language and/or markup.',
    # schema  = text_schema,
)
Code_ = Category_(
    name    = 'Code',
    info    = '''A piece of source code. May keep information about programming language.
                If Code item is used in a context where a single object (a class, a function) is expected,
                the `name` property must be set and equal to the name of the object that should be imported
                from the code after its compilation. Some uses may allow multiple names to be declared.
    ''',
    # schema  = code_schema,
)

# CodeObject_ = Struct(name = String(), code = String())         # inline code with a python object: a class, a function, ...
# Import_     = Struct(name = String(), code = Link(_Code))      # an object imported from a Code item

# SchemaType_ = Category_(
#     name        = "SchemaType",
#     schema      = '???',
# )
# Struct_ = SchemaType_(
#     name = 'Struct',
#     schema = Record(name = String(), type = Class(), fields = Catalog(Object(Schema))),
# )

