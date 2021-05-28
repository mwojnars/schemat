from django.shortcuts import render
from django.http import HttpResponse
from django.template import loader
from django.shortcuts import render

from hyperweb.site import registry


def item_view(request, path):    # descriptor, endpoint = ""):
    
    site = registry.get_site()
    text = site.handle(request, path)
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

