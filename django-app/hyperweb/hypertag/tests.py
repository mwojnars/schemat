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

def test_004_layout():
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
    src = """
        div
        

        p
        
            i
    """
    out = """

        <div></div>


        <p>

            <i></i>
        </p>
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

    src = """
        $x = 0
        if False:
            $x = 1
        elif x > 0:
            $x = 2
        | $x
    """
    assert ht.parse(src).strip() == "0"

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
    
def test_009_collections():
    src = "| { () }"            # empty tuple
    assert merge_spaces(ht.parse(src)) == "()"
    src = "| { (1 , ) }"
    assert merge_spaces(ht.parse(src)) == "(1,)"
    src = "| { (1,2, 3) }"
    assert merge_spaces(ht.parse(src)) == "(1, 2, 3)"

    src = "| { [] }"
    assert merge_spaces(ht.parse(src)) == "[]"
    src = "| { [1 , ] }"
    assert merge_spaces(ht.parse(src)) == "[1]"
    src = "| { [1,2, 3] }"
    assert merge_spaces(ht.parse(src)) == "[1, 2, 3]"
    src = "| { [ 1 ,[2], (), (3,)] }"
    assert merge_spaces(ht.parse(src)) == "[1, [2], (), (3,)]"

    src = "| {{'set'}}"
    assert merge_spaces(ht.parse(src)) == "{'set'}"
    src = "| { { 'set' , } }"
    assert merge_spaces(ht.parse(src)) == "{'set'}"
    src = "| { {1, 1 ,1} }"
    assert merge_spaces(ht.parse(src)) == "{1}"

    src = "| { {} }"
    assert merge_spaces(ht.parse(src)) == "{}"
    src = "| { { } }"
    assert merge_spaces(ht.parse(src)) == "{}"
    src = "| { {1:1, 2 : 2 , 3 :3,3:4,} }"
    assert merge_spaces(ht.parse(src)) == "{1: 1, 2: 2, 3: 4}"
    src = "| {{ }}"
    assert merge_spaces(ht.parse(src)) == "{ }"         # this is NOT a dict! sequences {{ and }} represent { and } characters escaped

def test_010_for():
    src = """
        for i in [1,2,3]:
            p | $i
            | {i+10}
    """
    out = """
        <p>1</p>
        11
        <p>2</p>
        12
        <p>3</p>
        13
    """
    assert out.strip() == ht.parse(src).strip()
    src = """
        / pre
        for i in []:
            | $i
        ! post
    """
    out = """
        pre
        post
    """
    assert out.strip() == ht.parse(src).strip()
    src = """
        for i in [1,2]:
            p:
                $i = i + 5
                | $i in
            | $i out
    """
    out = """
        <p>
            6 in
        </p>
        1 out
        <p>
            7 in
        </p>
        2 out
    """
    assert out.strip() == ht.parse(src).strip()

def test_011_calls():
    src = """
        for i in range(3):
            | $i
    """
    out = """
        0
        1
        2
    """
    assert out.strip() == ht.parse(src).strip()
    src = """
        for i in range( 1 , 7 , 2 ,):
            | $i
    """
    out = """
        1
        3
        5
    """
    assert out.strip() == ht.parse(src).strip()
    src = """
        for pair in enumerate(range(3), start = 10):
            | $pair
    """
    out = """
        (10, 0)
        (11, 1)
        (12, 2)
    """
    assert out.strip() == ht.parse(src).strip()
    src = """
        for i, val in enumerate(range(3), start = 10):
            | $val at $i
    """
    out = """
        0 at 10
        1 at 11
        2 at 12
    """
    assert out.strip() == ht.parse(src).strip()
    src = """
        $k = 5
        for i, val in enumerate(range(k-2), start = k*2):
            $ i = i + 1
            | $val at $i
        | $i
    """
    out = """
        0 at 11
        1 at 12
        2 at 13
        13
    """
    assert out.strip() == ht.parse(src).strip()

    src = "| { {'a':'b'}.get('c', 123) }"
    assert merge_spaces(ht.parse(src)) == "123"
    src = "| { { 'a' : 'b' } . get ('c', 123) ' ' 'aaa' }"
    assert merge_spaces(ht.parse(src)) == "123 aaa"

def test_012_hypertags():
    src = """
        %H a b c:
            p | $a $b $c
        H 1 c=3 b=2
    """
    assert ht.parse(src).strip() == "<p>1 2 3</p>"
    src = """
        %H a b c
            p | $a $b $c
        H 1 c=3 b=2
    """
    assert ht.parse(src).strip() == "<p>1 2 3</p>"
    src = """
        %H a b=4 c='5':
            p | $a $b $c
        H 1 b=2
    """
    assert ht.parse(src).strip() == "<p>1 2 5</p>"
    src = """
        %H a b=4 c='5' | $a $b  $c
        H 1 b=2
    """
    assert ht.parse(src).strip() == "1 2  5"
    src = """
        %H  a  b = 4 c  ='5'|$a$b$c
        H 1 b=2
    """
    assert ht.parse(src).strip() == "125"
    src = """
        $b = 10
        %H a b=4 c={b+5} | $a $b $c
        H 1 b={b*2}
    """
    assert ht.parse(src).strip() == "1 20 15"


#####################################################################################################################################################
#####
#####  MAIN
#####

# print('file:', __file__)

if __name__ == '__main__':
    # unittest.main()
    pytest.main(['-vW ignore::DeprecationWarning', f'--rootdir={os.path.dirname(__file__)}', __file__])
    