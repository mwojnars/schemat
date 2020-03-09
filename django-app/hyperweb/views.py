from django.shortcuts import render
from django.http import HttpResponse

from .models import Item


def item_view(request, space, category, item_id):
    
    #item = Item.objects.raw("SELECT *, CONCAT(cid,':',iid) as gid FROM hyper_items WHERE cid = %s AND iid = %s", [int(category), int(item_id)])[0]
    item = Item.objects.get(category, item_id)
    
    head = f"This is an item page for: {space}, {category}, {item_id}.<br>\n"
    content = str(item.__dict__)
    
    return HttpResponse(head + content)
