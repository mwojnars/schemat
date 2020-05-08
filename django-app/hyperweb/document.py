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
    (e.g., to avoid creating multiple <link>s to the same asset);
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
    
    http    = None          # dict of special Zones that hold HTTP header data: cookies, status code etc.
    text    = None          # the root Zone that encloses all text contents; may include nested zones
    default = None          # default zone to append to when no other was specified (`root` should only be used during initialization)
    
    def __init__(self):
        self.text = self.default = Zone('', self)
        self.http = {}
        self.init_template()
    
    def init_template(self):
        
        # create metadata zones
        cookies = CookiesZone('cookies')
        self.http['cookies'] = cookies
        for zone in self.http.values():
            zone.set_document(self)
        
        # create top-level text zones
        meta    = HtmlZone('meta')          # <meta> information at the beginning of <head>, before assets
        assets  = HtmlZone('assets')        # external assets loaded in <head>: css, js, ico ... converted to <link> / <script> tags, appropriately
        head    = HtmlZone('head')          # other tags to be put inside <head> that don't fit elsewhere
        styles  = HtmlZone('styles')        # inline CSS styles, put in <head>
        main    = HtmlZone('main')          # main HTML contents, put in <body>
        scripts = HtmlZone('scripts')       # inline scripts put at the end of <body>
        
        self \
            << "<!DOCTYPE html><html><head>"    \
                << meta                         \
                << assets                       \
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
            zone = self.http.get(head)
            if zone: return zone[tail]
            return self.text[head][tail]
        else:
            zone = self.http.get(name)
            if zone: return zone
            return self.text[name]
    
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

    def django_response(self):
        """Return contents of this Document as a Django's HttpResponse object."""

        from django.http import HttpResponse
        text = self.text.render()
        return HttpResponse(text)
    

#####################################################################################################################################################
#####
#####  BASE ZONE
#####

class Zone:
    """
    """
    
    doc     = None          # parent Document that contains this zone
    name    = None          # last component of the name of this (nested) zone
    content = None          # list of elements that will be rendered into strings and combined
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
        zone.set_document(self.doc)
        self.zones[name] = zone
        self.content.append(zone)
    
    def render(self):
        return ''.join(self.render_stream())
    
    def render_stream(self):
        return map(str, self.content)
    
    __str__ = render
    
    
#####################################################################################################################################################

class HtmlZone(Zone):
    
    debug_comments = True
    
    def render_stream(self):
        if self.debug_comments:
            yield f"<!-- zone start: {self.name} -->"
        for passage in map(str, self.content):
            yield passage
        if self.debug_comments:
            yield f"<!-- zone end: {self.name} -->"

            
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
    (e.g., links to CSS assets or JS resources) to some other zones of the document.
    """
    
    def embed(self, zone, doc):
        """
        Embed this widget in a given Document and return the contents that has to be appended
        to the zone where this widget occured.
        """
        