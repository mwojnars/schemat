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
          --textarea-height: 12rem;
        }
        body {
          width: 1120px;
          margin: 0 auto;
          padding-bottom: 50px;
          font-family: 'Quattrocento Sans', "Helvetica Neue", Helvetica, Arial, sans-serif;
        }
        
        h1, h2, h3 { margin-top: 0.8em; margin-bottom: 0.6em; }
        
        a { color: #006ecc }
        a:visited { color: #00427a }
        
        /*** SITEWIDE */
        
        .btn { border: none; border-radius: 0; }
        .btn-primary, .btn-primary.disabled, .btn-primary:disabled       { background-color: #5b8fdd; }
        .btn-primary:hover                                               { background-color: #4b78bb; }
        .btn-secondary, .btn-secondary.disabled, .btn-secondary:disabled { background-color: #7e8993; }
        
        /*** UTILITIES */
        
        .scroll {
            overflow: scroll;
            max-height: var(--textarea-height);
            border-bottom: 1px solid rgba(0,0,0,0.1);
            border-right:  1px solid rgba(0,0,0,0.1);
            resize: vertical;
        }
        .scroll[style*="height"] {
            max-height: unset;              /* this allows manual resizing (resize:vertical) to exceed predefined max-height */
        }
        
        /*** WIDGETS */
        
        .ace-editor {
            --bk-color: rgba(255,255,255,0.3);
            background-color: var(--bk-color);
            height: var(--textarea-height);
            width: 100%;
            line-height: 1.4;
            font-family: var(--bs-font-monospace);
            font-size: 13px;
            resize: vertical;        /* editor box resizing requires editor.resize() to be invoked by ResizeObserver */
            /*margin-left: -10px;      /* shift the editor to better align inner text with text of surrounding rows in a catalog */
            /*border-left: 8px solid var(--bk-color);*/
        }

        /*** ITEM PAGE */

        .ct-color0                      { background: #e2eef9; }   /* #D0E4F5 */
        .ct-color1                      { background: #f6f6f6; }

        .catalog-1 th, .catalog-1 td    { padding: 14px var(--ct-cell-pad) 11px; /*border-right: none;*/ }
        .wrap-offset                    { padding-left: calc(var(--ct-nested-offset) - var(--ct-cell-pad)); }
        td.ct-nested                    { padding-right: 0px; padding-bottom: 0px; }
        td.ct-flags                     { width: 30px; padding-left:20px; padding-right:20px; }

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
        
        .ct-value, .ct-value > *    { font-size: 14px; font-family: monospace; /* courier */ }
        .ct-value .field .default   { color: #888; }
        .ct-value .field .info      { font-style: italic; }
        .ct-value pre               { margin-bottom: 0px; font-size: 13px; font-family: monospace; }
    """,
)

# box model of a catalog of item properties:
"""
    hw-item-properties
        table .catalog-1
            tr .ct-colorX                              # X = 0 or 1
                # field with an atomic value:
                th .ct-field
                td .ct-value
            tr .ct-colorX
                # field with a catalog of sub-fields:
                td .ct-nested colspan=2
                    div .ct-field
                    div .wrap-offset : table .catalog-2
                        tr .ct-colorX
                            th .ct-field
                            td .ct-value
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
    %assets_external
        # jQuery 3.6.0
        script src="https://cdn.jsdelivr.net/npm/jquery@3.6.0/dist/jquery.min.js" integrity="sha256-/xUj+3OJU5yExlq6GSYGSHk7tPXikynS7ogEvDej/m4=" crossorigin="anonymous"
        # Bootstrap 5.0.2
        link href="https://cdn.jsdelivr.net/npm/bootstrap@5.0.2/dist/css/bootstrap.min.css" rel="stylesheet" integrity="sha384-EVSTQN3/azprG1Anm3QDgpJLIm9Nao0Yz1ztcQTwFspd3yD65VohhpuuCOmLASjC" crossorigin="anonymous"
        script src="https://cdn.jsdelivr.net/npm/bootstrap@5.0.2/dist/js/bootstrap.bundle.min.js" integrity="sha384-MrcW6ZMFYlzcLA8Nl+NtUVF0sA7MsXsP1UyJoMp4YLEuNSfAP+JcXn/tWtIaxVXM" crossorigin="anonymous"
        # Lodash 4.17.21 (https://lodash.com/)
        script src="https://cdn.jsdelivr.net/npm/lodash@4.17.21/lodash.min.js" integrity="sha256-qXBd/EfAdjOA2FGrGAG+b3YBn2tn5A6bhz+LSgYD96k=" crossorigin="anonymous"

        # # React
        # # Uwaga: podczas wdrażania aplikacji do środowiska produkcyjnego, zamień "development.js" na "production.min.js"
        # script src="https://unpkg.com/react@17/umd/react.development.js" crossorigin=True
        # script src="https://unpkg.com/react-dom@17/umd/react-dom.development.js" crossorigin=True
        
        # # Lit
        # script type="module" !
        #     import {LitElement, html, css} from 'https://unpkg.com/lit-element/lit-element.js?module';
        #     window.LitElement = LitElement;
        #
        #     class MyElement extends LitElement {
        #         static get properties() { return { mood: {type: String} } }
        #         static get styles() { return css`.mood { color: green; }`; }
        #         render() { return html`Web Components are <span class="mood">${this.mood}</span>!`; }
        #     }
        #     customElements.define('my-element', MyElement);

        # ACE (code editor)
        # keyboard shortcuts: https://github.com/ajaxorg/ace/wiki/Default-Keyboard-Shortcuts
        # existing highlighters: https://github.com/ajaxorg/ace/tree/master/lib/ace/mode
        # default commands and shortcuts: https://github.com/ajaxorg/ace/tree/master/lib/ace/commands (-> editor.commands.addCommand() ..removeCommand())
        script src="https://cdnjs.cloudflare.com/ajax/libs/ace/1.4.12/ace.js" integrity="sha512-GZ1RIgZaSc8rnco/8CXfRdCpDxRCphenIiZ2ztLy3XQfCbQUSCuk8IudvNHxkRA3oUg6q0qejgN/qqyG1duv5Q==" crossorigin="anonymous" referrerpolicy="no-referrer"
        
        # # CodeMirror (code editor)
        # script src="https://cdn.jsdelivr.net/npm/codemirror@5.62.3/lib/codemirror.min.js"

    %assets_internal
        script type="module" src="/sys.file:1/get"

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
        # td .ct-flags | *
        td .ct-value / $schema.display(value)

    %catalog_2 data schema start_color=0
        $c = start_color
        div .wrap-offset : table .catalog-2
            for name, value in data.items()
                tr class="ct-color{c}"
                    catalog_row $name $value $schema
                # $c = 1 - c
    
    %catalog_1 item
        $c = 0          # alternating color of rows: 0 or 1
        table .catalog-1
            for name, value in item.get_entries()
                $schema = item.get_schema(name)
                tr class="ct-color{c}"
                    if schema.is_catalog
                        td .ct-nested colspan=2
                            div .ct-field | {name}
                            catalog_2 $value $schema.values $c
                    else
                        catalog_row $name $value $schema
                $c = 1 - c
                
    %properties item
        # for field, value in item.data.items()
        #     $schema = $item.get_schema(field)
        #     $schema_json = generic_schema.dump_json(schema)
        #     $entry = (schema_json, $item.dump_data())
        #     $entries.append(entry)
        from hyperweb.serialize import $JSON
        
        custom "hw-item-page"
            # p style="display:none" type="json" #item     | $item.dump_data()
            p style="display:none" type="json" #item     | $JSON.dump(item.data)
            p style="display:none" type="json" #category | $item.category.dump_data()
            < catalog_1 $item
            div style="text-align:right; padding-top:20px"
                button #cancel-changes .btn .btn-secondary disabled=False | Cancel
                button #save-changes   .btn .btn-primary   disabled=False | Save

    %page @body
        doctype
        ...html @body
    
    %page_item @extra item
        page
            head
                title | $item['name']? $item.ciid(False)
                assets
                style / $item.registry.files.open('base.css')['source']
    
            # body .container : div .row
            #   div .col-1
            #   div .col-10
            body
                h1
                    $ciid = item.ciid()
                    try
                        | $item['name']
                        span style="font-size:40%; font-weight:normal" / $ciid
                    else / $ciid
                
                h2 | Properties
                properties $item
                
                @extra
            
    %page_category category
        page_item category
            h2 | Items
            table
                for item in list(category.registry.load_items(category))
                    tr
                        td / #{item.iid} &nbsp;
                        td
                            $ iname = item['name']? or item
                            try
                                a href=$item.url() | $iname
                            else
                                | $iname (no public URL)
    
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
