from django.shortcuts import render
from django.http import HttpResponse
from django.template import loader
from django.shortcuts import render

#from hyperweb.builtin import Item
from hyperweb.startup import site


def item_view(request, item_aspect):
    
    parts = item_aspect.split('/')
    descriptor = parts[0]
    aspect = parts[1] if len(parts) > 1 else None
    
    item = site.load_item(descriptor)
    
    #qualifier, item_id = descriptor.split(':')
    #item = Item.objects.get(item_id, qualifier)
    
    #cat = Item.objects.get_category(name = category)
    #print("Category:", cat.__data__)
    # 
    ##item = Item.objects.raw("SELECT *, CONCAT(cid,':',iid) as gid FROM hyper_items WHERE cid = %s AND iid = %s", [int(category), int(item_id)])[0]
    #item = Item.objects.get(cat.__iid__, item_id)
    
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
