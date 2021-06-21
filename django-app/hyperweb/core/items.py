from hyperweb.core.categories import *


#####################################################################################################################################################
#####
#####  ITEMS
#####

base_hy = Code_(
    language = 'hypertag',
    code = """
        %print_data item
            table .data : tbody
                for field, value in item.data.items()
                    tr
                        td .name  | {field}
                        td .value | {str(value)}
                        
        %print_data_ul item
            ul
                for field, value in item.data.items()
                    li
                        b | {field}:
                        . | {str(value)}
    """,
)

base_css = Code_(
    language = 'css',
    code = """
        body {
          font-family: 'Quattrocento Sans', "Helvetica Neue", Helvetica, Arial, sans-serif;
          font-size: 16px;
          color: #444;
        }
        .page {
          width: 980px;
          margin: 0 auto;
          overflow: hidden
        }
        h1 { font-size: 26px; line-height: 34px; margin-top: 30px }
        .catlink { font-size: 14px; margin-top: -20px }
        
        table.data {
          width: 100%;
          # font-family: "Times New Roman", Times, serif;
          border: 1px solid #FFFFFF;
          background-color: #F6F6F6;
          text-align: center;
          border-collapse: collapse;
        }
        table.data td, table.data th {
          border: 1px solid #FFFFFF;
          padding: 11px 12px 8px;
        }
        table.data tbody td {
          line-height: 20px;
        }
        table.data tbody td.name  {
          width: 20%;
          font-size: 15px;
          font-weight: bold;
          text-align: right;
          padding-right: 25px;
        }
        table.data tbody td.value {
          width: 80%;
          font-size: 13px;
          font-family: monospace;     /* courier */
        }

        table.data tr:nth-child(odd) {
          background: #e2eef9;    /* #D0E4F5 */
        }
        /* table.data tfoot td { font-size: 14px; } */
    """,
)

directory = Directory_(
    items = {
        'base.hy':  base_hy,
        'base.css': base_css,
    },
)

#####################################################################################################################################################

space_meta = Space_(
    name        = "Meta",
    categories  = {'category': Category_, 'item': Varia_}
)
space_sys = Space_(
    name        = "System",
    categories  = {'space': Space_, 'app': Application_, 'site': Site_, 'dir': Directory_}
)

app_admin = Application_(
    name        = "Admin",
    base_url    = "http://localhost:8001/admin/",
    url_scheme  = "raw",
)
app_catalog = Application_(
    name        = "Catalog",
    base_url    = "http://localhost:8001/",     # prefix of all URLs produced and parsed by this application
    spaces      = {'meta': space_meta, 'sys': space_sys},
)

catalog_wiki = Site_(
    name        = "catalog.wiki",
    # routes      = {'default': Route(base = "http://localhost:8001", path = "/", app = app_catalog)},
    directory   = directory,
    apps        = {
        'admin':    app_admin,
        'catalog':  app_catalog,
    },
)

#####################################################################################################################################################

item_001 = Varia_(title ="Ala ma kota Sierściucha i psa Kłapoucha.")
item_002 = Varia_(title ="ąłęÓŁŻŹŚ")
item_002.add('name', "test_item", "duplicate")


