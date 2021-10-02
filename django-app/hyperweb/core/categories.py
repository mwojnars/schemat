"""
Core system categories defined as Python objects.

Every object created through Category_(...) call is automatically inserted to the registry's
staging area and will be inserted to DB upon registry.commit() - see boot.py.
"""

from hyperweb.schema import *
from hyperweb.core.root import registry


#####################################################################################################################################################
#####
#####  ELEMENTS of items
#####

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
#####  CATEGORIES... The underscore _ is appended to names to differentiate them from names of classes
#####

Category_ = registry.create_root()

# Category_ is newly created here (not loaded), so it must be marked for insertion to DB;
# all other items/categories are staged automatically
registry.stage(Category_)

#####################################################################################################################################################

File_ = Category_(
    name    = "File",
    info    = """File with a text content. Accessible through the web filesystem.""",
    # info    = """Source code. May keep information about programming language.
    #             If Code item is used in a context where a single object (a class, a function) is expected,
    #             the `name` property must be set and equal to the name of the object that should be imported
    #             after compilation. Some uses may allow multiple names to be declared.
    #           """,
    class_name  = 'hyperweb.core.File',
    fields      = FIELDS(
        format  = STRING(),    # ProgrammingLanguage()
        content = CODE(),      # VARIANT(bin = BYTES(), txt = TEXT()),
    ),
)
FileLocal_ = Category_(
    name        = "FileLocal",
    info        = """File located on a local disk, identified by its local file path.""",
    prototype   = File_,
    class_name  = 'hyperweb.core.FileLocal',
    fields      = FIELDS(
        path    = STRING(),     # path to a local file on disk
        # format  = STRING(),     # file format: pdf, xlsx, ...
    ),
    # endpoints   = {"view": page_item, "get": File_get},
)

Folder_ = Category_(
    name        = "Folder",
    info        = "A directory of files, each file has a unique name (path). May contain nested directories.",
    class_name  = 'hyperweb.core.Folder',
    fields      = FIELDS(files = CATALOG(keys = FILENAME(), values = ITEM()))     # file & directory names mapped to item IDs
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
#     # class_name  = 'hyperweb.core.Space',
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

#####################################################################################################################################################

Application_ = Category_(
    name        = "Application",
    info        = "Category of application records. An application groups all spaces & categories available in the system and provides system-level configuration.",
    class_name  = 'hyperweb.core.Application',
    fields      = FIELDS(name = STRING()),
    # folder      = FILEPATH(),       # path to a folder in the site's directory where this application was installed;
                                    # if the app needs to store data items in the directory, it's recommended
                                    # to do this inside a .../data subfolder
)
AppRoot_  = Category_(
    name        = "AppRoot",
    info        = "A set of sub-applications, each bound to a different URL prefix.",
    class_name  = 'hyperweb.core.AppRoot',
    prototype   = Application_,     # TODO: add support for category inheritance (prototypes)
    fields      = FIELDS(name = STRING(), apps = CATALOG(ITEM())),  # TODO: restrict apps to sub-categories of Application_ (?)
)

AppAdmin_ = Category_(
    name        = "AppAdmin",
    class_name  = 'hyperweb.core.AppAdmin',
    fields      = FIELDS(name = STRING()),
)
AppFiles_ = Category_(
    name        = "AppFiles",
    class_name  = 'hyperweb.core.AppFiles',
    fields      = FIELDS(name = STRING(), root_folder = ITEM(Folder_)),    # if root_folder is missing, Site's main folder is used
)
AppSpaces_ = Category_(
    name        = "AppSpaces",
    info        = "Application for accessing public data through verbose paths of the form: .../SPACE:IID, where SPACE is a text identifier assigned to a category in `spaces` property.",
    class_name  = 'hyperweb.core.AppSpaces',
    fields      = FIELDS(name = STRING(), spaces = CATALOG(ITEM(Category_))),
)

Site_ = Category_(
    name        = "Site",
    info        = "Category of site records. A site contains information about applications, servers, startup",
    class_name  = 'hyperweb.core.Site',
    fields      = FIELDS(
        name        = STRING(),
        base_url    = STRING(),                 # the base URL at which the `application` is served, /-terminated
        filesystem  = ITEM(Folder_),         # root of the site-global file system
        application = ITEM(),                   # Application hosted on this site, typically an AppRoot with multiple subapplications
    ),
)

Varia_ = Category_(
    name        = "Varia",
    info        = "Category of items that do not belong to any specific category",
    class_name  = 'hyperweb.core.Item',
    fields      = FIELDS(name = STRING(), title = STRING()),            # multi = True
)


# Text_ = Category_(
#     name    = "Text",
#     info    = "Plain or rich text for human consumption. May keep information about language and/or markup.",
#     fields  = FIELDS(
#         language = STRING(),    # HumanLanguage()
#         markup   = STRING(),    # MarkupLanguage()
#         text     = TEXT(),
#     ),
# )

# Import_     = STRUCT(name = STRING(), code = ITEM(_Code))      # an object imported from a Code item
# SchemaType_ = Category_(
#     name        = "SchemaType",
#     schema      = '???',
# )
# Struct_ = SchemaType_(
#     name = 'STRUCT',
#     schema = FIELDS(name = STRING(), type = CLASS(), fields = CATALOG(OBJECT(Schema))),
# )

