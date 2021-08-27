from hyperweb.core.categories import *


#####################################################################################################################################################
#####
#####  ITEMS
#####

base_css = Code_(
    language = 'css',
    source = """
        /*** GENERAL STYLES */
        # html {
        #   font-family: 'Quattrocento Sans', "Helvetica Neue", Helvetica, Arial, sans-serif;
        #   font-size: 16px;
        #   color: #333;
        # }

        html {
          --ct-cell-pad: 35px;          /* default left & right padding of all table cells */
          --ct-nested-offset: 50px;     /* distance between left edges of a nested catalog and its container catalog */
          --ct-th1-width: 300px;
          --ct-th2-width: calc(var(--ct-th1-width) - var(--ct-nested-offset));
        }
        body {
          width: 1120px;
          margin: 0 auto;
          padding-bottom: 50px;
        }
        
        h1, h2, h3 { margin-top: 0.8em; margin-bottom: 0.6em; }
        
        a { color: #006ecc }
        a:visited { color: #00427a }
        .catlink { font-size: 14px; margin-top: -20px }
        
        /*** UTILITIES */
        
        .scroll { overflow: scroll; }
        .scroll pre { overflow: visible; }
        
        /*** SITEWIDE */
        /*** ITEM PAGE */

        .ct-color0                      { background: #e2eef9; }   /* #D0E4F5 */
        .ct-color1                      { background: #f6f6f6; }

        .catalog-1 th, .catalog-1 td    { padding: 14px var(--ct-cell-pad) 11px; /*border-right: none;*/ }
        td.ct-nested                    { padding-right: 0px; padding-bottom: 0px; }
        .wrap-offset                    { padding-left: calc(var(--ct-nested-offset) - var(--ct-cell-pad)); }

        .catalog-1, .catalog-2          { border-collapse: collapse; table-layout: fixed; }
        .catalog-1 th, .catalog-2 th    { border-right: 1px solid #fff; }
        .catalog-1 tr:not(:last-child)  { border-bottom: 1px solid #fff; }

        .catalog-1                      { width: 100%; min-width: 100%; max-width: 100%; }
        .catalog-1 th                   { width: var(--ct-th1-width); min-width: var(--ct-th1-width); max-width: var(--ct-th1-width); }

        /* th widths get reduced by 55px when nesting a subcatalog to account for paddings of outer td + div */
        .catalog-2                  { width: 100%; }
        .catalog-2 th               { padding-left: 15px; width: var(--ct-th2-width); min-width: var(--ct-th2-width); max-width: var(--ct-th2-width); }
        /*.catalog-2 th               { width: 195px; min-width: 195px; max-width: 195px; padding-left: 15px; }*/
        
        .catalog-1 .ct-field        { font-weight: bold;   font-size: 15px; }
        .catalog-2 .ct-field        { font-weight: normal; font-style: italic; }
        
        .ct-value                   { font-size: 14px; font-family: monospace; /* courier */ }
        .ct-value .field .default   { color: #888; }
        .ct-value .field .info      { font-style: italic; }
        .ct-value pre               { font-size: 13px; padding-bottom: 0px; margin-bottom: 0px; }
        .ct-value .scroll           { max-height: 10rem; border-bottom: 1px solid rgba(0,0,0,0.1); border-right: 1px solid rgba(0,0,0,0.1); }
    """,
)

# box model of an item data table:
"""
    table .catalog-1
        tr .ct-colorX                              # X = 0 or 1
            # field with an atomic value:
            th .ct-field
            td .ct-value : div [.scroll]
        tr .ct-colorX
            # field with a catalog of sub-fields:
            td .ct-nested colspan=2
                div .ct-field
                div padding-left : table .catalog-2
                    tr .ct-colorX
                        th .ct-field
                        td .ct-value : div [.scroll]
"""

base_js = Code_(
    language = 'javascript',
    source = """
        "use strict";
    """,
)

base_hy = Code_(
    language = 'hypertag',
    source = """
    
        %page @body
            doctype_html
            ...html @body
        
        %assets_external
            # jQuery 3.6.0
            script src="https://cdn.jsdelivr.net/npm/jquery@3.6.0/dist/jquery.min.js" integrity="sha256-/xUj+3OJU5yExlq6GSYGSHk7tPXikynS7ogEvDej/m4=" crossorigin="anonymous"
            # Bootstrap 5.0.2
            link href="https://cdn.jsdelivr.net/npm/bootstrap@5.0.2/dist/css/bootstrap.min.css" rel="stylesheet" integrity="sha384-EVSTQN3/azprG1Anm3QDgpJLIm9Nao0Yz1ztcQTwFspd3yD65VohhpuuCOmLASjC" crossorigin="anonymous"
            script src="https://cdn.jsdelivr.net/npm/bootstrap@5.0.2/dist/js/bootstrap.bundle.min.js" integrity="sha384-MrcW6ZMFYlzcLA8Nl+NtUVF0sA7MsXsP1UyJoMp4YLEuNSfAP+JcXn/tWtIaxVXM" crossorigin="anonymous"
            # # Lodash 4.17.21 (https://lodash.com/)
            # script src="https://cdn.jsdelivr.net/npm/lodash@4.17.21/lodash.min.js" integrity="sha256-qXBd/EfAdjOA2FGrGAG+b3YBn2tn5A6bhz+LSgYD96k=" crossorigin="anonymous"
            
            # ACE (code editor)
            # keyboard shortcuts: https://github.com/ajaxorg/ace/wiki/Default-Keyboard-Shortcuts
            # existing highlighters: https://github.com/ajaxorg/ace/tree/master/lib/ace/mode
            # default commands and shortcuts: https://github.com/ajaxorg/ace/tree/master/lib/ace/commands
            #   editor.commands.addCommand(), editor.commands.removeCommand()
            script src="https://cdnjs.cloudflare.com/ajax/libs/ace/1.4.12/ace.js" integrity="sha512-GZ1RIgZaSc8rnco/8CXfRdCpDxRCphenIiZ2ztLy3XQfCbQUSCuk8IudvNHxkRA3oUg6q0qejgN/qqyG1duv5Q==" crossorigin="anonymous" referrerpolicy="no-referrer"
            
            # CodeMirror (code editor)
            script src="https://cdn.jsdelivr.net/npm/codemirror@5.62.3/lib/codemirror.min.js"

        %assets_internal
            script src="/sys.file:1/get"
    
        %assets
            assets_external
            assets_internal
        
        %protocol @body classname
            # asset ".../protocols.js"
            div .widget protocol=classname
                @body
    
        %catalog_row key value schema
            # a row containing an atomic value of a data field (not a subcatalog)
            th .ct-field | $key
            td .ct-value / $schema.display(value)
            # $class = "scroll" if schema.is_lengthy(value) else ""
            # div class=$class / $schema.display(value)
    
        %catalog_2 data schema start_color=0
            $c = start_color
            div .wrap-offset : table .catalog-2
                for name, value in data.items()
                    tr class="ct-color{c}"
                        catalog_row $name $value $schema
                    # $c = 1 - c
        
        %properties item
            $c = 0          # alternating color of rows: 0 or 1
            table .catalog-1
                for name, value in item.data.items()
                    $schema = item.get_schema(name)

                    # from hypertag.core.dom import $DOM
                    # if isinstance(html, DOM):
                    #     html = html.render()
                    
                    tr class="ct-color{c}"
                        if schema.is_catalog
                            td .ct-nested colspan=2
                                div .ct-field | {name}
                                catalog_2 $value $schema.values $c
                        else
                            catalog_row $name $value $schema
                            
                    $c = 1 - c
    """,
)


directory = Directory_(
    items = {
        'base.hy':      base_hy,            # reusable components for use in pages
        'base.css':     base_css,           # global styles for use in pages
        # 'item.hy':      page_item,          # generic page of an item
        # 'category.hy':  page_category,      # generic page of a category
    },
)

file_protocols = File_(path = '/home/marcin/Documents/priv/catalog/src/django-app/hyperweb/static/protocols.js')


#####################################################################################################################################################

space_meta = Space_(
    name        = "Meta",
    categories  = {'category': Category_, 'item': Varia_}
)
space_sys = Space_(
    name        = "System",
    categories  = {'space': Space_, 'app': Application_, 'site': Site_, 'dir': Directory_, 'file': File_}
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


### All the items defined above are automatically included in an initial DB
