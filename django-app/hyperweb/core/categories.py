from hyperweb.item import Category
from hyperweb.schema import *


#####################################################################################################################################################
#####
#####  ELEMENTS of items
#####

# default template that displays a generic item page if a category-specific template is missing
page_item = """
context $item, $category as cat, $app, $files
from base import %page, %assets, %properties

. #dedent
    % print_headline
            p .catlink
            a href=$app.url(cat) | {cat['name']? or cat}
            | ($item.cid,$item.iid)

    < page
        $name = item['name']? or str(item)
        head
            title | {name}
            assets
            style / $files.open('base.css')['source']

        # body .container : div .row
        #   div .col-1
        #   div .col-10
        body
            h1  | {name}
            print_headline
            
            h2 | Properties
            properties $item
            # print_catalog1 $item
          
"""

# template that displays a category page
page_category = """
context $item as cat, $app, $files
from base import %page, %assets, %properties

. #dedent
    < page
        $name = cat['name']? or str(cat)
        head
            title | {name ' -' }? category #{cat.iid}
            assets
            style / $files.open('base.css')['source']

        body
            h1
                try
                    i | $name
                    . | -
                | category #{cat.iid}

            h2 | Properties

            properties $cat

            h2 | Items
            table
                for item in list(cat.registry.load_items(cat))
                    tr
                        td / #{item.iid} &nbsp;
                        td
                            $ iname = item['name']? or item
                            try
                                a href=app.url(item) | $iname
                            else
                                | $iname (no public URL)
"""

# text_schema = STRUCT(name = STRING(), lang = STRING(), markup = STRING(), text = TEXT())   # HumanLang() MarkupLang() TEXT()
# code_schema = STRUCT(name = STRING(), lang = STRING(), code = TEXT())   # ProgramLang() Code()
# method_schema = STRUCT(language = STRING(), code = TEXT())
# class_schema = VARIANT(native = CLASS(), inline = code_schema)       # reference = LINK(_Code)


# fields of categories, including the root category
root_fields = FIELDS(
    name         = Field(STRING(), info = "human-readable title of the category"),
    info         = Field(STRING()),
    class_name   = Field(STRING(), default = 'hyperweb.item.Item', info = "Full (dotted) path of a python class. Or the class name that should be imported from `class_code` after its execution."),
    class_code   = Field(TEXT()),     # TODO: take class name from `name` not `class_name`; drop class_name; rename class_code to `code`
    endpoints    = Field(CATALOG(TEXT()), default = {"__view__": page_item}),
    fields       = Field(CATALOG(FIELD(), type = FIELDS)),
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
    endpoints   = {"__view__": page_category},
    fields      = root_fields,
    # page_category = Template(page_category),
    # page_item     = Template(page_item),
    # fun  = Method(...),
    # new  = Handler(...),
)
Category_.category = Category_

Directory_ = Category_(
    name        = "Directory",
    info        = "A directory of items, each item has a unique name (path). May contain nested subdirectories. Similar to a file system.",
    class_name  = 'hyperweb.item.Directory',
    fields      = FIELDS(items = CATALOG(keys = ENTRY_NAME(), values = LINK()))     # file & directory names mapped to item IDs
)
# Filesystem_ = Category_(
#     name        = "File system",
#     fields      = FIELDS(root = PATH()),
# )

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
    fields      = FIELDS(name = STRING(), categories = CATALOG(LINK(Category_))),
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
    class_name  = 'hyperweb.item.Application',
    # class_name  = "Application",
    # class_code  =
    # """
    #     from hyperweb.item import Item
    #     class Application(Item):
    #         def get_space(self, name):
    #             return self['spaces'][name]
    # """,
    fields      = FIELDS(name = STRING(), url_scheme = ENUM('raw', 'spaces'), spaces = CATALOG(LINK(Space_))),
    folder      = PATH(),           # path to a folder in the site's directory where this application was installed;
                                    # if the app needs to store data items in the directory, it's recommended
                                    # to do this inside a .../data subfolder
)

# route_schema    = STRUCT(Route, base = STRING(), path = STRING(), app = LINK(Application_))

Site_ = Category_(
    name        = "Site",
    info        = "Category of site records. A site contains information about applications, servers, startup",
    class_name  = 'hyperweb.item.Site',
    fields      = FIELDS(name = STRING(), apps = CATALOG(LINK(Application_))),
    directory   = LINK(Directory_),     # root of the site-global hierarchical directory of items
)

Varia_ = Category_(
    name        = "Varia",
    info        = "Category of items that do not belong to any specific category",
    class_name  = 'hyperweb.item.Item',
    fields      = FIELDS(name = STRING(), title = STRING()),            # multi = True
)


Code_ = Category_(
    name    = "Code",
    info    = """Source code. May keep information about programming language.
                If Code item is used in a context where a single object (a class, a function) is expected,
                the `name` property must be set and equal to the name of the object that should be imported
                after compilation. Some uses may allow multiple names to be declared.
              """,
    fields  = FIELDS(
        language = STRING(),    # ProgramLanguage()
        source   = CODE(),
    ),
)
Text_ = Category_(
    name    = "Text",
    info    = "Plain or rich text for human consumption. May keep information about language and/or markup.",
    fields  = FIELDS(
        language = STRING(),    # HumanLanguage()
        markup   = STRING(),    # MarkupLanguage()
        text     = TEXT()
    ),
)
File_ = Category_(
    name        = "File",
    info        = """Binary or text file that can be accompanied with information about its format: pdf, jpg, zip, ...""",
    class_name  = 'hyperweb.item.File',
    fields      = FIELDS(
        path    = STRING(),     # path to a local file on disk
        format  = STRING(),     # file format: pdf, xlsx, ...
        content = VARIANT(bin = BYTES(), txt = TEXT()),
    ),
    # endpoints   = {"__view__": page_item, "get": File_get},
)


# Import_     = STRUCT(name = STRING(), code = LINK(_Code))      # an object imported from a Code item
# SchemaType_ = Category_(
#     name        = "SchemaType",
#     schema      = '???',
# )
# Struct_ = SchemaType_(
#     name = 'STRUCT',
#     schema = FIELDS(name = STRING(), type = CLASS(), fields = CATALOG(OBJECT(Schema))),
# )

