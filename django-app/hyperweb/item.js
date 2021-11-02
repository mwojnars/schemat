import { print, assert, T, escape_html } from './utils.js'
import { e, DIV, P, H1, H2, SPAN, delayed_render } from './utils.js'
import { generic_schema, RECORD } from './types.js'

export const ROOT_CID = 0

const useState = React.useState
const useEffect = React.useEffect


/**********************************************************************************************************************
 **
 **  ITEM & CATEGORY
 **
 */

export class Item {

    cid = null      // CID (Category ID) of this item; cannot be undefined, only "null" if missing
    iid = null      // IID (Item ID within a category) of this item; cannot be undefined, only "null" if missing

    data            // properties of this item, as a plain object {..}; in the future, MultiDict can be used instead

    category        // parent category of this item, as an instance of Category
    registry        // Registry that manages access to this item (should refer to the unique global registry)

    //loaded = null;    // names of fields that have been loaded so far

    get id()   { return [this.cid, this.iid] }
    has_id()   { return this.cid !== null && this.iid !== null }
    // has_id()   { let id = this.id; return !(id.includes(null) || id.includes(undefined)) }
    has_data() { return !!this.data }

    constructor(category = null, data = null) {
        if (data) this.data = data
        if (category) {
            this.category = category
            this.registry = category.registry
            this.cid      = category.iid
        }
    }

    static async from_dump(state, category = null, use_schema = true) {
        /* Recreate an item that was serialized with Item.dump_item(), possibly at the server. */
        let schema = use_schema ? await category.get_schema() : generic_schema
        let data = await schema.decode(state['data'])
        delete state['data']

        let item = new Item(category, data)
        Object.assign(item, state)                  // copy remaining metadata from `state` to `item`
        return item
    }

    async get(field, default_ = undefined) {
        await this.load(field)

        if (this.data.hasOwnProperty(field))
            return this.data[field]

        if (this.category !== this) {
            let cat_default = await this.category.get_default(field)
            if (cat_default !== undefined)
                return cat_default
        }
        return default_
    }
    async load(field = null, data_json = null, use_schema = true) {
        /*
        Load properties of this item from a DB or JSON string `data_json` into this.data, IF NOT LOADED YET.
        Only with a not-None `data_json`, (re)loading takes place even if `this` was already loaded
        - the newly loaded `data` fully replaces the existing this.data in such case.
        */
        // if field !== null && field in this.loaded: return      # this will be needed when partial loading from indexes is available

        if (this.has_data() && !data_json) return this
        if (this.iid === null) throw Error(`trying to load() a newborn item with no IID`)
        if (!data_json) {
            let record = await this.registry.load_record(this.id)
            data_json = record['data']          // TODO: initialize item metadata - the remaining attributes from `record`
        }
        let schema = use_schema ? await this.category.get_schema() : generic_schema
        let state  = (typeof data_json === 'string') ? JSON.parse(data_json) : data_json
        this.data  = await schema.decode(state)
        this.bind()
        print(`done item.load() of [${this.cid},${this.iid}]`)
        return this
    }
    bind() {
        /*
        Override this method in subclasses to provide initialization after this item is retrieved from DB.
        Typically, this method initializes transient properties and performs cross-item initialization.
        Only after bind(), the item is a fully functional element of a graph of interconnected items.
        When creating new items, bind() should be called manually, typically after all related items
        have been created and connected.
        */
    }

    async ciid({html = true, brackets = true, max_len = null, ellipsis = '...'} = {}) {
        /*
        "Category-Item ID" (CIID) string (stamp, emblem) having the form:
        - [CATEGORY-NAME:IID], if the category of self has a "name" property; or
        - [CID:IID] otherwise.
        If html=True, the first part (CATEGORY-NAME or CID) is hyperlinked to the category's profile page
        (unless URL failed to generate) and the CATEGORY-NAME is HTML-escaped. If max_len is not None,
        CATEGORY-NAME gets truncated and suffixed with '...' to make its length <= max_len.
        */
        // return `Item [${this.id}]`

        let cat = await this.category.get('name', this.cid.toString())
        if (max_len && cat.length > max_len) cat = cat.slice(max_len-3) + ellipsis
        if (html) {
            cat = escape_html(cat)
            let url = '' //this.category.url('')
            if (url) cat = `<a href=${url}>${cat}</a>`
        }
        let stamp = `${cat}:${this.iid}`
        if (!brackets) return stamp
        return `[${stamp}]`
    }

    display(target) {
        /* `target` is an HTMLElement where to inject the rendered HTML output. */
        let Page = this.Page  //Item.Page
        ReactDOM.render(e(Page, {item: this}), target)
    }

    // Title(props) {
    //     const [name, setName] = useState()
    //     const [ciid, setCiid] = useState()
    //     // print('Item.Title:name =', name)
    //
    //     const initData = async () => {
    //         setName(await props.item.get('name', null))
    //         setCiid(await props.item.ciid())
    //     }
    //     useEffect(initData, [])
    //
    //     if (name === undefined) return null         // skip rendering until initData() above executes
    //     if (name)
    //         return H1(name, SPAN({style:"font-size:40%; font-weight:normal"}, ciid))
    //     else
    //         return H1(ciid)
    // }

    Title(props) {
        return delayed_render(async () => {
            let name = await props.item.get('name', null)
            let ciid = await props.item.ciid()
            if (name)
                return H1(name, ' ', SPAN({style: {fontSize:'40%', fontWeight:"normal"}}, ciid))
            else
                return H1(ciid)
        })
    }

    // static Properties = class extends Catalog {}

    Page(props) {           // React functional component
        let item = props.item
        return DIV(
            e(item.Title, props),
            H2('Properties'),                               //{style: {color:'blue'}}
            P(`Item ID: [${item.id}]`),
        )
    }
    // static Page = class extends React.Component {
    //     render() {
    //         let item = this.props.item
    //         return DIV(
    //             e(item.constructor.Title, {item: item}),
    //             H2('Properties'),                               //{style: {color:'blue'}}
    //             P(`Item ID: [${item.id}]`),
    //         )
    //     }
    // }
}

/**********************************************************************************************************************/

export class Category extends Item {

    async fields() { return await this.get('fields') }

    async get_class() {

        let name = await this.get('class_name')
        let code = await this.get('class_code')

        if (code)
            return eval(code)
            // TODO: save the newly created class to registry as a subclass NAME_XXX of Item
            // TODO: check this.data for individual methods & templates to be treated as methods

        assert(name, `no class_name defined for category ${this}: ${name}`)

        return globalThis.registry.get_class(name)
    }
    async get_default(field, default_ = undefined) {
        /* Get default value of a field from category schema. Return `default` if no category default is configured. */
        let fields = await this.fields()
        let schema = T.getOwnProperty(fields, field)
        return schema ? schema.default : default_
    }
    async get_schema(field = null) {
        /* Return schema of a given field, or all Item.data (if field=null). */
        let fields = await this.fields()
        if (!field)                                     // create and return a schema for the entire Item.data
            return new RECORD(fields, {strict: true})
        else {                                          // return a schema for a selected field only
            let schema = (field in fields) ? fields[field] : null
            return schema || generic_schema
        }
    }
}

/**********************************************************************************************************************/

export class RootCategory extends Category {
    cid = ROOT_CID
    iid = ROOT_CID

    constructor(registry) {
        super()
        this.registry = registry
        this.category = this                    // root category is a category for itself
    }
    encode_data(use_schema = false) {
        /* Same as Item.encode_data(), but use_schema is false to avoid circular dependency during deserialization. */
        return super.encode_data(false)
    }
    async load(field = null, data_json = null, use_schema = false) {
        /* Same as Item.load(), but use_schema is false to avoid circular dependency during deserialization. */
        return await super.load(field, data_json, false)
    }
}

/**********************************************************************************************************************
 **
 **  SUBCLASSES
 **
 */

export class Site extends Item {
    /* Global configuration of all applications that comprise this website, with URL routing etc. */
}

export class Application extends Item {}
export class AppRoot extends Application {}
export class AppAdmin extends Application {}
export class AppAjax extends Application {}
export class AppFiles extends Application {}
export class AppSpaces extends Application {}

export class Folder extends Item {}
export class File extends Item {}
export class FileLocal extends File {}


// #####################################################################################################################################################
// #####
// #####  APPLICATIONS
// #####
//
// class Application(Item):
//     """
//     An application implements a mapping of URL paths to item methods, and the way back.
//     Some application classes may support nested applications.
//     INFO what characters are allowed in URLs: https://stackoverflow.com/a/36667242/1202674
//     """
//     SEP_ROUTE    = '/'      # separator of route segments in URL, each segment corresponds to another (sub)application
//     SEP_ENDPOINT = '@'
//
//     def handle(self, request, path):
//         """
//         Handle a web `request` in a way identified by a given URL `path`:
//         find an item pointed to by `path` and call its serve() to render response.
//         Raise an exception if item not found or the path not recognized.
//         `path` is a part of the URL after application's base URL that typically identifies an item
//         and its endpoint within this application; may include a query string.
//         Parent applications should ensure that whenever a sub-application's handle() is called,
//         the leading SEP_ROUTE separator is preserved in its `path`, so that the sub-application
//         can differentiate between URLs of the form ".../PARENT/" and ".../PARENT".
//         """
//         raise NotImplementedError()
//
//     def url_path(self, item, route = '', relative = True, endpoint = None, params = None):
//         """
//         Generate URL path (URL fragment after route) for `item`, possibly extended with a non-default
//         endpoint designation and/or arguments to be passed to a handler function or a template.
//         If relative=True, the path is relative to a given application `route`; otherwise,
//         it is absolute, i.e., includes segments for all intermediate applications;
//         the path does NOT have a leading separator, or it has a different meaning -
//         in any case, a leading separator should be appended by caller if needed.
//         """
//         raise NotImplementedError()
//
//     def _split_endpoint(self, path):
//         """Decode @endpoint from the URL path."""
//
//         endpoint = ""
//         if '?' in path:
//             path, args = path.split('?', 1)
//         if self.SEP_ENDPOINT in path:
//             path, endpoint = path.rsplit(self.SEP_ENDPOINT, 1)
//
//         return path, endpoint
//
//     def _set_endpoint(self, url, endpoint, params):
//
//         if endpoint: url += f'{self.SEP_ENDPOINT}{endpoint}'
//         if params: url += f'?{urlencode(params)}'
//         return url
//
//
// class AppRoot(Application):
//     """A set of sub-applications, each bound to a different URL prefix."""
//
//     def _route(self, path):
//         """
//         Make one step forward along a URL `path`. Return the extracted route segment (step),
//         the associated application object, and the remaining subpath.
//         """
//         lead = 0
//
//         # consume leading '/' (lead=1) when it's followed by text, but treat it as terminal
//         # and preserve in a returned subpath otherwise
//         if path.startswith(self.SEP_ROUTE):
//             lead = (len(path) >= 2)
//             step = path[1:].split(self.SEP_ROUTE, 1)[0]
//         else:
//             step = path.split(self.SEP_ROUTE, 1)[0]
//
//         apps = self['apps']
//         app  = apps.get(step, None)
//
//         if step and app:                       # non-default (named) route can be followed with / in path
//             return step, app, path[lead+len(step):]
//
//         if '' in apps:                          # default (unnamed) route has special format, no "/"
//             return '', apps[''], path
//
//         raise Exception(f'URL path not found: {path}')
//
//     def handle(self, request, path):
//         """
//         Find an application in self['apps'] that matches the requested URL path and call its handle().
//         `path` can be an empty string; if non-empty, it starts with SEP_ROUTE character.
//         """
//
//         route, app, path = self._route(path)
//
//         # # request-dependent global function that converts leaf application's local URL path to an absolute URL by passing it up through the current route
//         # request.route = lambda path_: f"{base}{route}/{path_}"
//         # request.base_url += route + self.SEP_ROUTE
//
//         return app.handle(request, path)
//
//     def url_path(self, item, route = '', relative = True, endpoint = None, params = None):
//
//         step, app, path = self._route(route)
//         subpath = app.url_path(item, path, relative = relative)
//         if relative: return subpath                                     # path relative to `route`
//         # if subpath[:1] == '/': subpath = subpath[1:]
//         return self.SEP_ROUTE.join(filter(None, [step, subpath]))       # absolute path, empty segments excluded
//         # if relative or not step: return subpath                         # step can be '' (default route)
//         # if subpath and subpath[:1] != '/': subpath = '/' + subpath
//         # return step + subpath                                           # nothing is appended if subpath was originally empty
//
//
//
// class AppAdmin(Application):
//     """Admin interface. All items are accessible through the 'raw' routing pattern: .../CID:IID """
//
//     def _find_item(self, path, request):
//         """Extract CID, IID, endpoint from a raw URL of the form CID:IID@endpoint, return CID and IID, save endpoint to request."""
//         try:
//             path, request.endpoint = self._split_endpoint(path[1:])
//             cid, iid = map(int, path.split(':'))
//         except Exception as ex:
//             raise Exception(f'URL path not found: {path}')
//
//         return self.registry.get_item((cid, iid))
//
//     def handle(self, request, path):
//
//         item = self._find_item(path, request)
//         return item.serve(request, self)
//
//     def url_path(self, item, route = '', relative = True, endpoint = None, params = None):
//         assert item.has_id()
//         cid, iid = item.id
//         url = f'{cid}:{iid}'
//         return self._set_endpoint(url, endpoint, params)
//
// class AppAjax(AppAdmin):
//
//     def handle(self, request, path):
//         item = self._find_item(path, request)
//         request.endpoint = "json"
//         return item.serve(request, self)
//
// class AppFiles(Application):
//     """
//     Filesystem application. Folders and files are accessible through the hierarchical
//     "file path" routing pattern: .../dir1/dir2/file.txt
//     """
//     def handle(self, request, path):
//         if not path.startswith('/'): return redirect(request.url + '/')
//
//         # TODO: make sure that special symbols, e.g. "$", are forbidden in file paths
//         filepath, request.endpoint = self._split_endpoint(path[1:])
//         request.state = {'filepath': filepath}
//
//         root = self.get('root_folder') or self.registry.files
//         item = root.search(filepath)
//
//         files = self.registry.files
//         File_ = files.search('system/File')
//         Folder_ = files.search('system/Folder')
//
//         default_endpoint = ()
//         if item.isinstance(File_):
//             default_endpoint = ('download',)
//         elif item.isinstance(Folder_):
//             # if not filepath.endswith('/'): raise Exception("folder URLs must end with '/'") #return redirect(request.url + '/')       # folder URLs must end with '/'
//             request.state['folder'] = item          # leaf folder, for use when generating file URLs (url_path())
//             # default_endpoint = ('browse',)
//
//         return item.serve(request, self, *default_endpoint)
//
//     def url_path(self, item, route = '', relative = True, endpoint = None, params = None):
//         # TODO: convert folder-item relationship to bottom-up to avoid using current_request.state
//
//         state = self.registry.current_request.state
//         return state['folder'].get_name(item)
//
//     # def _search(self, path):
//     #     """Find an item (folder/file) pointed to by `path` and its direct parent folder. Return both."""
//     #     parent = None
//     #     item = self.get('root_folder') or self.registry.files
//     #     while path:
//     #         parent = item
//     #         name = path.split(self.SEP_FOLDER, 1)[0]
//     #         item = parent.get('files')[name]
//     #         path = path[len(name)+1:]
//     #     return item, parent
//
//
// class AppSpaces(Application):
//     """
//     Application for accessing public data through verbose paths of the form: .../SPACE:IID,
//     where SPACE is a text identifier assigned to a category in `spaces` property.
//     """
//     def handle(self, request, path):
//         try:
//             path, request.endpoint = self._split_endpoint(path[1:])
//             space, item_id = path.split(':')        # decode space identifier and convert to a category object
//             category = self['spaces'][space]
//         except Exception as ex:
//             raise Exception(f'URL path not found: {path}')
//
//         item = category.get_item(int(item_id))
//         return item.serve(request, self)
//
//     def url_path(self, item, route = '', relative = True, endpoint = None, params = None):
//         category  = item.category
//         space = self._find_space(category)
//         iid   = category.encode_url(item.iid)
//         url   = f'{space}:{iid}'
//         return self._set_endpoint(url, endpoint, params)
//
//     @cached(ttl = 10)
//     def _find_space(self, category):
//         for space, cat in self['spaces'].items():
//             if cat.id == category.id: return space
//         raise Exception(f'URL path not found for items of category {category}')
//
//
// class Folder(Item):
//     """"""
//     SEP_FOLDER = '/'          # separator of folders in a file path
//
//     def exists(self, path):
//         """Check whether a given path exists in this folder."""
//
//     def search(self, path):
//         """
//         Find an item pointed to by a `path`. The path may start with '/', but this is not obligatory.
//         The search is performed recursively in subfolders.
//         """
//         if path.startswith(self.SEP_FOLDER): path = path[1:]
//         item = self
//         while path:
//             name = path.split(self.SEP_FOLDER, 1)[0]
//             item = item.get('files')[name]
//             path = path[len(name)+1:]
//         return item
//
//     def read(self, path):
//         """Search for a File/FileLocal pointed to by a given `path` and return its content."""
//         f = self.search(path)
//         if isinstance(f, File): return f.read()
//         raise Exception(f"not a file: {path}")
//
//     def get_name(self, item):
//         """Return a name assigned to a given item. If the same item is assigned multiple names,
//         the last one is returned."""
//         names = self._names()
//         return names.get(item.id, None)
//
//     @cached(ttl=10)
//     def _names(self):
//         """Take `files` property and compute its reverse mapping: item ID -> name."""
//         files = self.get('files')
//         return {f.id: name for name, f in files.items()}
//
//
// class File(Item):
//     """"""
//     def read(self):
//         """Return full content of this file, either as <str> or a Response object."""
//         return self.get('content')
//
//     @handler('download')
//     def download(self, request):
//         return self.read()
//
// class FileLocal(File):
//
//     def read(self):
//         path = self.get('path', None)
//         if path is None: return None
//         return open(path, 'rb').read()
//
//     @handler('download')
//     def download(self, request):
//
//         content = self.get('content', None)
//         if isinstance(content, str): return FileResponse(content)
//
//         path = self.get('path', None)
//         if not path: raise Http404
//
//         content_type, encoding = mimetypes.guess_type(path)
//         content_type = content_type or 'application/octet-stream'
//
//         content = open(path, 'rb')
//         response = FileResponse(content, content_type = content_type)
//
//         if encoding:
//             response.headers["Content-Encoding"] = encoding
//
//         # TODO respect the "If-Modified-Since" http header like in django.views.static.serve(), see:
//         # https://github.com/django/django/blob/main/django/views/static.py
//
//         return response
//
