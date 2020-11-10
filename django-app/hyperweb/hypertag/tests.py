"""
Run on server:
$
$  cd ..../hyperweb/hyml
$  pytest -vW ignore::DeprecationWarning tests.py

"""

# import unittest
import os, pytest

from hyperweb.hypertag.parser import HypertagParser
ht = HypertagParser()


#####################################################################################################################################################
#####
#####  TESTS
#####

def test_001():
    src = """
        h1 >a href="http://xxx.com"|This is <h1> title
            p  / And <a> paragraph.
        div
            | Ala { 'ęłąśźćóÓŁĄĘŚŻŹĆ' } ęłąśźćóÓŁĄĘŚŻŹĆ
              kot.
            / i pies
        
        div #box .top.grey
        div#box.top .grey-01
        input enabled=True
        """
    out = """
        <h1><a href="http://xxx.com">This is &lt;h1&gt; title
            <p>And <a> paragraph.</p>
        </a></h1>
        <div>
            Ala ęłąśźćóÓŁĄĘŚŻŹĆ ęłąśźćóÓŁĄĘŚŻŹĆ
            kot.
            i pies
        </div>

        <div id="box" class="top grey"></div>
        <div id="box" class="top grey-01"></div>
        <input enabled />
    """
    assert out.strip() == ht.parse(src).strip()


def test_002_qualifiers():
    # the code below contains NESTED qualifiers: unsatisfied ! within ?
    src = """ | kot { 'Mru' "czek" 123 0! }? {456}! {0}? """
    out = """   kot  456   """
    assert out.strip() == ht.parse(src).strip()

    src = """ | kot { 'Mru' "czek" 123 0? }! {456}? {0}? """
    out = """   kot Mruczek123 456   """
    assert out.strip() == ht.parse(src).strip()

    with pytest.raises(Exception, match = 'Obligatory expression') as ex_info:
        ht.parse("| {0}!")
    
    # assert str(ex_info.value) == 'some info'
    

#####################################################################################################################################################
#####
#####  MAIN
#####

# print('file:', __file__)

if __name__ == '__main__':
    # unittest.main()
    pytest.main(['-vW ignore::DeprecationWarning', f'--rootdir={os.path.dirname(__file__)}', __file__])
    