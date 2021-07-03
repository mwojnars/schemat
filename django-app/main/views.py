from django.http import HttpRequest, HttpResponse
from django.template import loader
from django.shortcuts import render

# from hyperweb.site import registry
from hyperweb.registry import Registry
from hyperweb.core import core_items

registry = None         # registry is initialized on the first web request

def get_registry():
    global registry
    if registry is None:
        registry = Registry()
        registry.seed(core_items)
        # registry.boot()
    return registry


def item_view(request, path):    # descriptor, endpoint = ""):
    """
    During request processing, Hyperweb assigns in `request` additional non-standard attributes
    that carry Hyperweb-specific information for use in downstream processing functions.
    These attributes may include:
    - request.site  = Site item that received the request (this overrides the Django's meaning of this attribute)
    - request.app   = Application item this request is addressed to
    - request.item  = target item that's responsible for actual handling of this request
    - request.route = name of the route of the `site` object where the application `app` was found to match the requested URL
    - request.ipath = part of the URL after an application prefix and excluding the query string; identifies an item
                      and its endpoint within a scope of a given application
    - request.endpoint = name of endpoint (item's method or template) as extracted from the URL
    - request.user  = User item representing the current user who issued the request (overrides Django's value ??)
    """
    
    site = request.site = get_registry().get_site()
    text = site.handle(request)
    return HttpResponse(text)
    
    # item = site.resolve(descriptor)
    # doc  = item.serve(request, endpoint)
    # return HttpResponse(doc)

    # if isinstance(doc, str):
    #     return HttpResponse(doc)
    # else:
    #     return doc.django_response()
    
    # values = {}
    # values['__class__'] = item.__class__
    # values.update(vars(item))
    # values['__id__'] = item.__id__
    # values.update(item.__data__.items_all())
    #
    # context = {'item': values}
    # #return render(request, 'item.html.j2', context)
    #
    # template = loader.get_template('item.html.j2')
    # return HttpResponse(template.render(context, request))
    
    #return HttpResponse(head + content)

