from django.shortcuts import render
from django.http import HttpResponse
from django.template import loader
from django.shortcuts import render

from hyperweb.core import site


def item_view(request, descriptor, handler = None):
    
    item = site.load(descriptor)
    
    if handler:
        return item.__handle__(request, handler)
    
    context = {'item': vars(item)}
    #return render(request, 'item.html.j2', context)
    
    template = loader.get_template('item.html.j2')
    return HttpResponse(template.render(context, request))
    
    #head = f"This is an item page for: {space}, {category}, {item_id}.<br>\n"
    #content = ''
    #data = vars(item)
    
    #for attr in sorted(data.keys()):
    #    value = data[attr]
    #    content += f'<li><b>{attr}</b>: {value}</li>\n'
    #    
    #content = f'<ul>{content}</ul>'
    
    #return HttpResponse(head + content)
