from hyperweb.core.categories import *


#####################################################################################################################################################
#####
#####  ITEMS
#####

pages_common = Code_(
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

directory = Directory_(
    items = {
        'pages_common': pages_common,
    },
)

#####################################################################################################################################################

meta_space = Space_(
    name        = "Meta",
    categories  = {'category': Category_, 'item': Varia_}
)

sys_space = Space_(
    name        = "System",
    categories  = {'space': Space_, 'app': Application_, 'site': Site_}
)

Catalog_wiki = Application_(
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

catalog_wiki = Site_(
    name        = "catalog.wiki",
    routes      = {'default': Route(base = "http://localhost:8001", path = "/", app = Catalog_wiki)},
    directory   = directory,
)


#####################################################################################################################################################

item_001 = Varia_(title ="Ala ma kota Sierściucha i psa Kłapoucha.")
item_002 = Varia_(title ="ąłęÓŁŻŹŚ")
item_002.add('name', "test_item", "duplicate")


