"""
Run on server:
$
$  pytest -vW ignore::DeprecationWarning tests.py
"""

# import unittest
import os, pytest

from hyperweb.hyml.parser import HyML
hyml = HyML()


#####################################################################################################################################################
#####
#####  TESTS
#####

def test_001():
    src = """
        h1 >a href="http://xxx.com"|This is <h1> title
            p  / And <a> paragraph.
        div
            | Ala
              kot.
            / i pies
        
        div #box .top.grey
        div#box.top .grey
        input enabled=True
        """
    out = """
        <h1><a href="http://xxx.com">This is &lt;h1&gt; title
            <p>And <a> paragraph.</p>
        </a></h1>
        <div>
            Ala
              kot.
            i pies
        </div>

        <div id="box" class="top grey"></div>
        <div id="box" class="top grey"></div>
        <input enabled />
    """
    assert out.strip() == hyml.parse(src).strip()


def test_002():
    assert 1 == 1


#####################################################################################################################################################
#####
#####  MAIN
#####

# print('file:', __file__)

if __name__ == '__main__':
    # unittest.main()
    pytest.main(['-vW ignore::DeprecationWarning', f'--rootdir={os.path.dirname(__file__)}', __file__])
    