from django.shortcuts import render
from django.http import HttpResponse
from django.template import loader
from django.shortcuts import render

from hyperweb.site import registry


def item_view(request, descriptor, endpoint = None):
    
    site = registry.get_site()
    item = site.get_from_url(descriptor)
    doc  = item.__handle__(request, endpoint)
    return HttpResponse(doc)

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

