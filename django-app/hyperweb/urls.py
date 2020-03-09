from django.urls import path

from . import views

urlpatterns = [
    path('<space>.<category>:<item_id>', views.item_view),
]
