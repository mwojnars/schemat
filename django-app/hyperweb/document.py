"""
"""

#####################################################################################################################################################
#####
#####  DOCUMENT
#####

class Document:
    """
    Web document (page, response) object that allows incremental (stream-like)
    addition of content that is rendered to standard Django HttpResponse at the end.
    Content can be written to predefined, named "zones" (Zone class).
    Typically, a zone accepts strings or Widgets - "bits" of content - and appends them to existing content,
    however, some types of zones may perform deduplication of submitted bits
    (e.g., to avoid creating multiple <link>s to the same resource);
    and/or accept data of other types, for example, custom objects for cookies specification.
    Zones can be nested. New zones can be created by putting a Zone object in the input stream
    - this object can already be filled in, and/or can be written to later on.
    
    Arbitrary zone (X) can be accessed in 3 different ways:
    - doc.get_zone("X")
    - doc["X"]
    - doc.X
    
    Name of a nested zone is prepended with names of outer zones separated by dots, for example, X.Y.X.
    To access a nested zone use any of:
    - doc.get_zone("X").get_zone("Y").get_zone("Z")
    - doc["X"]["Y"]["Z"]
    - doc.X.Y.Z
    
    The last form is recommended, unless zone names clash with names of standard attributes or methods
    of Document or Zone subclass. Names of zones should be *valid python identifiers* and,
    in particular, they shall not contain dots.
    """
    
    zones   = None          # dict of special Zones that hold HTTP metadata: cookies, status code etc.
    root    = None          # root Zone, the one which encloses all text contents; may include nested zones
    default = None          # default zone to append to when no other was specified (`root` should only be used during initialization)
    
    def __init__(self):
        self.root = self.default = Zone('', self)
        self.zones = {}
        self.init_template()
    
    def init_template(self):
        
        # create metadata zones
        cookies = CookiesZone('cookies')
        self.zones['cookies'] = cookies
        for zone in self.zones:
            zone.set_document(self)
        
        # create top-level text zones
        meta    = Zone('meta')          # all <meta> information, put at the beginning of <head>
        include = Zone('include')       # external resources to be loaded in <head>: css, js, ico ... converted to <link> / <script> tags, appropriately
        head    = Zone('head')          # other tags to be put inside <head> that don't fit elsewhere
        styles  = Zone('styles')        # inline CSS styles, put in <head>
        main    = Zone('main')          # main HTML contents, put in <body>
        scripts = Zone('scripts')       # inline scripts put at the end of <body>
        
        self \
            << "<!DOCTYPE html><html><head>"    \
                << meta                         \
                << include                      \
                << head                         \
                << styles                       \
            << "</head><body>"                  \
                << main                         \
                << scripts                      \
            << "</body></html>"
        
        self.default = main

    def get_zone(self, name):
        
        if '.' in name:
            head, tail = name.split('.', 1)
            zone = self.zones.get(head)
            if zone: return zone[tail]
            return self.root[head][tail]
        else:
            zone = self.zones.get(name)
            if zone: return zone
            return self.root[name]
    
    __getitem__ = get_zone
    __getattr__ = get_zone

    def append(self, element):
        self.default.append(element)
        return self

    def append_block(self, block):
        self.default.append_block(block)
        return self

    __lt__     = append
    __lshift__ = append_block


#####################################################################################################################################################

class DjangoDocument(Document):
    """A Document that can be turned into Django's HttpResponse object."""

    def as_django_response(self):
        """Return contents of this Document as a Django's HttpResponse object."""
        

#####################################################################################################################################################
#####
#####  BASE ZONE
#####

class Zone:
    """
    """
    
    doc     = None          # Document that contains this zone
    name    = None          # last component of the (nested) zone name
    content = None          # list of bits that will be rendered into strings and combined
    zones   = None          # dict of nested child zones
    
    def __init__(self, name, doc = None):
        self.doc = doc
        self.name = name
        self.content = []
        self.zones = {}
    
    def set_document(self, doc):
        self.doc = doc

    def get_zone(self, name):
        
        if '.' in name:
            head, tail = name.split('.', 1)
            return self.zones[head][tail]
        else:
            return self.zones[name]
    
    __getitem__ = get_zone
    __getattr__ = get_zone

    def _append(self, element, sep = ''):
        """
        Check type of `element` and take appropriate action: embed a Widget, add a new Zone,
        or just append a new chunk of content.
        """
        if isinstance(element, Zone):
            self.add_zone(element)
        elif isinstance(element, Widget):
            element.embed(self, self.doc)       # this may recursively call append() on this zone object
        else:
            if self.content and sep:
                self.content.append(sep)
            self.content.append(str(element))

    def append(self, snippet):
        """Snippets are concatenated directly (without space) to preceeding blocks or snippets."""
        self._append(snippet)
        return self
    
    def append_block(self, block):
        """Block is separated by a new line from a preceeding block/snippet, unlike a snippet."""
        self._append(block, '\n')
        return self
    
    __lt__     = append
    __lshift__ = append_block
    
    def add_zone(self, zone):
        name = zone.name
        if name in self.zones:
            if zone is self.zones[name]: return
            raise Exception(f"Repeated insertion of two different Zone objects under the name `{name}`")
        self.zones[name] = zone
        zone.set_document(self.doc)
    
    def render(self):
        return ''.join(map(str, self.content))
    
    def render_stream(self):
        first = True
        for bit in self.content:
            yield str(bit) if first else '\n' + str(bit)
            first = False
            
            
#####################################################################################################################################################
#####
#####  METADATA ZONES
#####

class Cookie:
    """"""

class CookiesZone(Zone):
    """
    """

#####################################################################################################################################################
#####
#####  SPECIAL ZONES (js, css...)
#####



#####################################################################################################################################################
#####
#####  WIDGET
#####

class Widget:
    """
    An element of web document that can write (embed) itself to a given Zone of a Document,
    possibly with appending necessary metadata (e.g., cookies) and dependencies
    (e.g., links to CSS or JS resources) to some other zones of the document.
    """
    
    def embed(self, zone, doc):
        """
        Embed this widget in a given Document and return the contents that has to be appended
        to the zone where this widget occured.
        """
        