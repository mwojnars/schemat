from hyperweb.core.categories import *


#####################################################################################################################################################
#####
#####  ITEMS
#####

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
        }
        h1 { font-size: 26px; line-height: 34px; margin-top: 30px }
        a { color: #006ecc }
        a:visited { color: #00427a }
        .catlink { font-size: 14px; margin-top: -20px }
        
        table.data {
          /*font-family: "Times New Roman", Times, serif;*/
          /* background: #F6F6F6; */
          text-align: center;
          border-collapse: collapse;
        }
        table.data tr:not(:last-child) {
          border-bottom: 1px solid #fff;
        }
        table.data td {
          /*border-right: none;*/
          padding: 14px 35px 11px;
        }
        table.data td {
          line-height: 20px;
        }
        table.data td.key  {
          border-right: 1px solid #fff;
          text-align: left;
          padding-right: 25px;
        }
        table.data td.value {
          font-size: 13px;
          font-family: monospace;     /* courier */
        }

        /* table.data tr:nth-child(odd) { background: #e2eef9; } */  /* #D0E4F5 */
        /* table.data tfoot td { font-size: 14px; } */

        table.data tr.color0 { background: #e2eef9; }   /* #D0E4F5 */
        table.data tr.color1 { background: #f6f6f6; }

        table.data td.nested { padding-right: 0px; padding-bottom: 0px; }

        table.data.depth1        { width: 980px; }
        table.data.depth1 td.key { width: 200px; }
        table.data.depth1 td.key {
          font-size:   15px;
          font-weight: bold;
        }
        /* widths below should be equal to depth1's only decreased by "padding-left" and "border" size of a td */
        table.data.depth2        { width: 945px; margin-left: 20px; margin-top: 10px; }
        table.data.depth2 td.key { width: 165px; }
        table.data.depth2 td.key {
          font-size:    15px;
          font-style:   italic;
          font-weight:  normal;
          padding-left: 15px;
        }
    """,
)

base_hy = Code_(
    language = 'hypertag',
    code = """
        %print_catalog data schema start_color=0
            $c = start_color
            table .data .depth2
                for name, value in data.items()
                    $text = schema.display(value)
                    tr class="color{c}"
                        td .key   | $name
                        td .value | $text
                    $c = 1 - c
        
        %print_data item
            $c = 0          # alternating color of rows: 0 or 1
            table .data .depth1
                for name, value in item.data.items()
                    $schema = item.get_schema(name)

                    # from hypertag.core.dom import $DOM
                    # if isinstance(html, DOM):
                    #     html = html.render()
                    
                    tr class="color{c}"
                        if schema.is_catalog
                            td .key .nested colspan=2
                                | {name}
                                print_catalog $value $schema.values $c
                            # tr
                            #     td .key | {name}
                            #     td .value
                            # tr
                            #     td colspan=2
                            #         print_catalog $value $schema.values
                        else
                            $text = schema.display(value)
                            td .key   | $name
                            td .value | $text
                            
                    $c = 1 - c
    """,
)

"""
%flexi_table start_color=0 depth=1

%print_catalog2 data schema
    table .data
        for field, value in data.items()
            tr
                schemas = item.category.get_schema()          # = item.category.get('schema') or object_schema
                value_schema = schemas.fields.get(field).schema    # category.get_field(field) ... category.get_schema(field)
                if value_schema.is_catalog:
                    td .key colspan=2 | {field}
                    print_catalog1 value value_schema
                else
                    td .key  | {field}
                    td .value | {schema.render(value)}
                    
"""

directory = Directory_(
    items = {
        'base.hy':      base_hy,            # reusable components for use in pages
        'base.css':     base_css,           # global styles for use in pages
        # 'item.hy':      page_item,          # generic page of an item
        # 'category.hy':  page_category,      # generic page of a category
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

app_items = Application_(
    name        = "Items",
    base_url    = "http://localhost:8001/admin/item/",
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
        'items':        app_items,
        'catalog':      app_catalog,
    },
)

#####################################################################################################################################################

item_001 = Varia_(title ="Ala ma kota Sierściucha i psa Kłapoucha.")
item_002 = Varia_(title ="ąłęÓŁŻŹŚ")
item_002.add('name', "test_item")  #, "duplicate")


