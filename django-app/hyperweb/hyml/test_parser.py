# import unittest
import os, pytest

from hyperweb.hyml.parser import HyML
hyml = HyML()


#####################################################################################################################################################
#####
#####  TESTS
#####

# class TestParser(unittest.TestCase):
#
#     def test_001(self):
#         src = """
#             h1 >a href="http://xxx.com"|This is <h1> title
#                 p  / And <a> paragraph.
#             div
#                 | Ala
#                   kot.
#                 / i pies
#
#             div
#             """
#         out = """
#             <h1><a>This is &lt;h1&gt; title
#                 <p>And <a> paragraph.</p>
#             </a></h1>
#             <div>
#                 Ala
#                   kot.
#                 i pies
#             </div>
#
#             <div></div>
#         """
#         self.assertEqual(out, hyml.parse(src))
#
#
#     def test_002(self):
#         self.assertEqual(1, 2)


def test_001():
    src = """
        h1 >a href="http://xxx.com"|This is <h1> title
            p  / And <a> paragraph.
        div
            | Ala
              kot.
            / i pies
        
        div
        """
    out = """
        <h1><a>This is &lt;h1&gt; title
            <p>And <a> paragraph.</p>
        </a></h1>
        <div>
            Ala
              kot.
            i pies
        </div>

        <div></div>
    """
    assert out.strip() == hyml.parse(src).strip()


def test_002():
    assert 1 == 2


#####################################################################################################################################################
#####
#####  MAIN
#####

# print('file:', __file__)

if __name__ == '__main__':
    # unittest.main()
    pytest.main(['-v', f'--rootdir={os.path.dirname(__file__)}', __file__])
    