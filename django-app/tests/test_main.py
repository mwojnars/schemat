#-*- coding: utf-8 -*-
"""
Run in "tests" folder:
$
$  py.test-3 -vW ignore::DeprecationWarning .
$

"""

import requests

from hypertag import HyperHTML


#####################################################################################################################################################
#####
#####  UTILITIES
#####

BASE_URL = "http://localhost:8001/"

def get(relative_url):
    return requests.get(BASE_URL + relative_url)

def assert200(relative_url):
    response = get(relative_url)
    assert response.status_code == 200
    

#####################################################################################################################################################
#####
#####  TESTS
#####

# def test_environment():
#
#     response = requests.get("http://api.zippopotam.us/us/90210")
#     assert response.status_code == 200
    

def test_basic():

    assert200("meta.category:0")
    assert200("meta.category:4")
    assert200("meta.item:1")
    