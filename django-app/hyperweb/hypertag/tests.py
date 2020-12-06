"""
Run on server:
$
$  cd django-app/hyperweb/hypertag/
$  pytest -vW ignore::DeprecationWarning tests.py

"""

# import unittest
import os, re, pytest

from hyperweb.hypertag.parser import HypertagParser
ht = HypertagParser(verbose = False)

#####################################################################################################################################################
#####
#####  UTILITIES
#####

def merge_spaces(s, pat = re.compile(r'\s+')):
    """Merge multiple spaces, replace newlines and tabs with spaces, strip leading/trailing space."""
    return pat.sub(' ', s).strip()

#####################################################################################################################################################
#####
#####  TESTS
#####

def test_001():
    src = """
        h1 : a href="http://xxx.com": |This is <h1> title
            p  / And <a> paragraph.
        div
            | Ala { 'ęłąśźćóÓŁĄĘŚŻŹĆ' } ęłąśźćóÓŁĄĘŚŻŹĆ
              kot.
            / i pies
        
        div #box .top .grey
        div #box .top .grey-01
        input enabled=True
        """
    out = """
        <h1><a href="http://xxx.com">This is &lt;h1&gt; title
            <p>And <a> paragraph.</p></a></h1>
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
    
def test_003_empty_blocks():
    src = """
        p
        p:
        p |
        div /
        form !
        |
        /
        !
        B: |
    """
    out = """
        <p></p>
        <p></p>
        <p></p>
        <div></div>
        <form></form>



        <B></B>
    """
    assert out.strip() == ht.parse(src).strip()

def test_004():
    src = """
    h1
        p : b | Ala
        p
            |     Ola
                i kot
    """
    out = """
    <h1>
        <p><b>Ala</b></p>
        <p>
                Ola
              i kot
        </p>
    </h1>
    """
    assert out.strip() == ht.parse(src).strip()

def test_005_document_margins():
    src = """\n\n p | text  \n  \n  """
    out = """\n\n <p>text</p>\n\n"""
    assert out == ht.parse(src)         # no .strip()

def test_006_if():
    src = """
        if {False}:
            |Ala
        elif True * 5:
            div | Ola
    """
    out = """<div>Ola</div>"""
    assert out.strip() == ht.parse(src).strip()

def test_007_variables():
    src = """
        if True:
            $ x = 5
        else:
            $ x = 10
        | {x}
    """
    assert ht.parse(src).strip() == "5"

    src = """
        if False:
            $ x = 5
        else:
            $ x = 10
        | {x}
    """
    assert ht.parse(src).strip() == "10"

    src = """
        $ y = 0
        div : p
            $ y = 5
            | {y}
    """
    assert merge_spaces(ht.parse(src)) == "<div><p> 5 </p></div>"

def test_008_variables_err():
    with pytest.raises(Exception, match = 'referenced before assignment') as ex_info:
        ht.parse("""
            if False:
                $ x = 5
            else:
                $ y = 10
            | {x}
        """)
    with pytest.raises(Exception, match = 'not defined') as ex_info:
        ht.parse("""
            p
                $ y = 5
            | {y}
        """)
    

#####################################################################################################################################################
#####
#####  MAIN
#####

# print('file:', __file__)

if __name__ == '__main__':
    # unittest.main()
    pytest.main(['-vW ignore::DeprecationWarning', f'--rootdir={os.path.dirname(__file__)}', __file__])
    