from hyperweb.item import Category
from hyperweb.schema import *


#####################################################################################################################################################
#####
#####  ELEMENTS of items
#####

# default template to display a generic item page if a category-specific template is missing
page_item = """
context $item
from base import %page_item
page_item $item
# dedent : page_item $item
"""

# template to display a category page
page_category = """
context $item
from base import %page_category
page_category item
"""

# text_schema = STRUCT(name = STRING(), lang = STRING(), markup = STRING(), text = TEXT())   # HumanLang() MarkupLang() TEXT()
# code_schema = STRUCT(name = STRING(), lang = STRING(), code = TEXT())   # ProgramLang() Code()
# method_schema = STRUCT(language = STRING(), code = TEXT())
# class_schema = VARIANT(native = CLASS(), inline = code_schema)       # reference = ITEM(_Code)


# fields of categories, including the root category
root_fields = FIELDS(
    name         = Field(STRING(), info = "human-readable title of the category"),
    info         = Field(STRING()),
    class_name   = Field(STRING(), default = 'hyperweb.item.Item', info = "Full (dotted) path of a python class. Or the class name that should be imported from `class_code` after its execution."),
    class_code   = Field(TEXT()),     # TODO: take class name from `name` not `class_name`; drop class_name; rename class_code to `code`
    endpoints    = Field(CATALOG(CODE()), default = {"view": page_item}),
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
    endpoints   = {"view": page_category},
    fields      = root_fields,
    # page_category = Template(page_category),
    # page_item     = Template(page_item),
    # fun  = Method(...),
    # new  = Handler(...),
)
Category_.category = Category_

Directory_ = Category_(
    name        = "Directory",
    info        = "A directory of files, each file has a unique name (path). May contain nested directories.",
    class_name  = 'hyperweb.item.Directory',
    fields      = FIELDS(files = CATALOG(keys = FILENAME(), values = FILE()))     # file & directory names mapped to item IDs
)
# file system arrangement (root directory organization) - see https://en.wikipedia.org/wiki/Filesystem_Hierarchy_Standard
#  /categories/* (auto) -- categories listed by IID (or IID_name?), each entry links to a profile, shows links to other endpoints, and a link to /items/CAT
#  /items/CAT/* (auto) -- items in a category, CAT, listed by *IID* ... /item/Category/* lists categories by IID
#  /system/* -- global resources available in this installation: schemas, templates, images, css, js, ...
#  /apps/APP/* -- assets of an application, APP; no writes, only reads; on search path when loading assets internally
#  /data/APP/* -- working directory of an application, APP, where app-specific data items can be created and modified
#  /site -- the global Site item that's booted upon startup (?)

# Space_ = Category_(
#     name        = "Space",
#     info        = "Category of items that represent item spaces.",
#     fields      = FIELDS(name = STRING(), categories = CATALOG(ITEM(Category_))),
#     # class_name  = 'hyperweb.item.Space',
#     class_name  = "Space",
#     class_code  =
#     """
#         from hyperweb.item import Item
#         class Space(Item):
#             def get_category(self, name):
#                 return self['categories'][name]
#     """,
#     # get_category = Method("""
#     #     def get_category(self, name):
#     #         return self['categories'][name]
#     # """),
# )

Application_ = Category_(
    name        = "Application",
    info        = "Category of application records. An application groups all spaces & categories available in the system and provides system-level configuration.",
    class_name  = 'hyperweb.item.Application',
    fields      = FIELDS(name = STRING()),
    # folder      = FILEPATH(),       # path to a folder in the site's directory where this application was installed;
                                    # if the app needs to store data items in the directory, it's recommended
                                    # to do this inside a .../data subfolder
)
RootApp_  = Category_(
    name        = "Root App",
    info        = "A set of sub-applications, each bound to a different URL prefix.",
    class_name  = 'hyperweb.item.RootApp',
    prototype   = Application_,     # TODO: add support for category inheritance (prototypes)
    fields      = FIELDS(name = STRING(), apps = CATALOG(ITEM())),  # TODO: restrict apps to sub-categories of Application_ (?)
)

AdminApp_ = Category_(
    name        = "Admin App",
    class_name  = 'hyperweb.item.AdminApp',
    fields      = FIELDS(name = STRING()),
)
FilesApp_ = Category_(
    name        = "Files App",
    class_name  = 'hyperweb.item.FilesApp',
    fields      = FIELDS(name = STRING(), root_folder = ITEM(Directory_)),    # if root_folder is missing, Site's main folder is used
)
SpacesApp_ = Category_(
    name        = "Spaces App",
    info        = "Application for accessing public data through verbose paths of the form: .../SPACE:IID, where SPACE is a text identifier assigned to a category in `spaces` property.",
    class_name  = 'hyperweb.item.SpacesApp',
    fields      = FIELDS(name = STRING(), spaces = CATALOG(ITEM(Category_))),
)

Site_ = Category_(
    name        = "Site",
    info        = "Category of site records. A site contains information about applications, servers, startup",
    class_name  = 'hyperweb.item.Site',
    fields      = FIELDS(
        name        = STRING(),
        base_url    = STRING(),                 # the base URL at which the `application` is served, /-terminated
        directory   = ITEM(Directory_),         # root of the site-global file system
        #filesystem  = None,
        application = ITEM(),                   # Application hosted on this site, typically a RootApp with multiple subapplications
    ),
)

Varia_ = Category_(
    name        = "Varia",
    info        = "Category of items that do not belong to any specific category",
    class_name  = 'hyperweb.item.Item',
    fields      = FIELDS(name = STRING(), title = STRING()),            # multi = True
)


File_ = Category_(
    name    = "File",
    info    = """File with a text content. Accessible through the web filesystem.""",
    # info    = """Source code. May keep information about programming language.
    #             If Code item is used in a context where a single object (a class, a function) is expected,
    #             the `name` property must be set and equal to the name of the object that should be imported
    #             after compilation. Some uses may allow multiple names to be declared.
    #           """,
    class_name  = 'hyperweb.item.File',
    fields      = FIELDS(
        format  = STRING(),    # ProgrammingLanguage()
        content = CODE(),      # VARIANT(bin = BYTES(), txt = TEXT()),
    ),
)
Text_ = Category_(
    name    = "Text",
    info    = "Plain or rich text for human consumption. May keep information about language and/or markup.",
    fields  = FIELDS(
        language = STRING(),    # HumanLanguage()
        markup   = STRING(),    # MarkupLanguage()
        text     = TEXT(),
    ),
)
LocalFile_ = Category_(
    name        = "LocalFile",
    info        = """File located on a local disk, identified by its local file path.""",
    class_name  = 'hyperweb.item.LocalFile',
    fields      = FIELDS(
        path    = STRING(),     # path to a local file on disk
        # format  = STRING(),     # file format: pdf, xlsx, ...
    ),
    # endpoints   = {"view": page_item, "get": File_get},
)


# Import_     = STRUCT(name = STRING(), code = ITEM(_Code))      # an object imported from a Code item
# SchemaType_ = Category_(
#     name        = "SchemaType",
#     schema      = '???',
# )
# Struct_ = SchemaType_(
#     name = 'STRUCT',
#     schema = FIELDS(name = STRING(), type = CLASS(), fields = CATALOG(OBJECT(Schema))),
# )

