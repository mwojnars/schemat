from hyperweb.core.categories import *


#####################################################################################################################################################
#####
#####  ITEMS
#####

base_css = Code_(
    language = 'css',
    source = """
        /*** GENERAL STYLES */
        body {
          font-family: 'Quattrocento Sans', "Helvetica Neue", Helvetica, Arial, sans-serif;
          font-size: 16px;
          color: #333;
        }
        .page {
          width: 980px;
          margin: 0 auto;
        }
        h1 { font-size: 26px; line-height: 34px; margin-top: 30px }
        a { color: #006ecc }
        a:visited { color: #00427a }
        .catlink { font-size: 14px; margin-top: -20px }
        
        /*** UTILITIES */
        /*** SITEWIDE */
        
        .scroll { overflow: scroll; }
        
        /*** ITEM PAGE */

        .item-data {
          /*font-family: "Times New Roman", Times, serif;*/
          text-align: left;
          border-collapse: collapse;
        }
        .item-data tr:not(:last-child) {
          border-bottom: 1px solid #fff;
        }
        .item-data td {
          /*border-right: none;*/
          padding: 14px 35px 11px;
          line-height: 20px;
        }
        .item-data td.key  {
          border-right: 1px solid #fff;
          padding-right: 25px;
        }
        .item-data td.value {
          font-size: 13px;
          font-family: monospace;     /* courier */
        }

        /* .item-data tr:nth-child(odd) { background: #e2eef9; } */  /* #D0E4F5 */
        /* .item-data tfoot td { font-size: 14px; } */

        .item-data tr.color0 { background: #e2eef9; }   /* #D0E4F5 */
        .item-data tr.color1 { background: #f6f6f6; }

        .item-data td.nested { padding-right: 0px; padding-bottom: 0px; }

        .item-data.depth1 tr     { border-top: 1px solid #fff; }
        .item-data.depth1        { width: 980px; }
        .item-data.depth1 td.key { width: 200px; }
        .item-data.depth1 td.key {
          font-size:   15px;
          font-weight: bold;
        }
        /* widths below should be equal to depth1's only decreased by "padding-left" and "border" size of a td */
        .item-data.depth2 tr     { border-top: none; }
        .item-data.depth2        { width: 925px; margin-left: 20px; }
        .item-data.depth2 td.key { width: 165px; }
        .item-data.depth2 td.key {
          font-size:    15px;
          font-style:   italic;
          font-weight:  normal;
          padding-left: 15px;
        }
        
        .value .field .default     { color: #888; }
        .value .field .info        { font-style: italic; }
        .value pre                 { line-height: 10px; }
        .value .scroll             { max-height: 150px; }
    """,
)

# box model of an item data table:
"""
    table .item-data .depth1
        tr .colorX                              # X = 0 or 1
            # field with an atomic value:
            td .key
            td .value : div .atomic [.scroll]

            # field with a catalog of sub-fields:
            td .key .nested colspan=2
            table .item-data .depth2
                tr .colorX
                    td .key
                    td .value : div .atomic [.scroll]
"""

base_hy = Code_(
    language = 'hypertag',
    source = """
        %atomic_row key value schema
            $text = schema.display(value)
            td .key   | $key
            td .value
                $class = "atomic"
                if schema.is_lengthy(value):
                    $class += " scroll"
                div class=$class
                    if (text.markup=='HTML') / $text
                    else                     | $text
    
        %print_catalog data schema start_color=0
            $c = start_color
            table .item-data .depth2
                for name, value in data.items()
                    tr class="color{c}"
                        atomic_row $name $value $schema
                    # $c = 1 - c
        
        %print_data item
            $c = 0          # alternating color of rows: 0 or 1
            table .item-data .depth1
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
                        else
                            atomic_row $name $value $schema
                            
                    $c = 1 - c
    """,
)

"""
%flexi_table start_color=0 depth=1

%print_catalog2 data schema
    table .item-data
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


