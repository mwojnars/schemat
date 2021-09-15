from django.http import HttpRequest, HttpResponse
# from django.template import loader
# from django.shortcuts import render

#####################################################################################################################################################

def item_view(request, path):    # descriptor, endpoint = ""):
    from hyperweb.boot import registry
    
    # if not registry.booted:
    #     from hyperweb.core import core_items
    #     registry.seed(core_items)

    response = registry.handle_request(request)

    if isinstance(response, str):
        return HttpResponse(response)
    return response

    
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

