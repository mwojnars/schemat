"""
TDOM = Text Document Object Model = Document

Representations during parsing:
- AST:  expressions, variables, control statements, syntax structures ...
- TDOM: expressions evaluated, control statements executed; hypertags NOT expanded, selectors NOT resolved
- Elements (tree)
- plaintext snippets (list/stream) - ready for ''-concatenation
Transformations:
- parsing: converts AST to TDOM; evaluates expressions, executes control statements
- rendering: converts TDOM to plaintext snippets; expands hypertags, resolves selectors;
             goes top-down (in-order) through TDOM

AST > (parsing) > TDOM > (rendering) > snippets


Block  =  tag(s) + content  =  tag(s) + title + body

Title (inline) vs. Body (blocks)...

* Title only:
   div > span > a / Title <b>text</b>     >>     <div><span><a>Title <b>text</b></a></span></div>
* Body only:
   div > span > a                                <div>
      / Content <b>text</b>               >>     <span>
                                                 <a>
                                                    Content <b>text</b>
                                                 </a>
                                                 </span>
                                                 </div>
* Mixed Title+Body:

- title / head / inline
- body / feed / blocks

Issues:
- simplicity: hypertag functions may operate on entire content at once, like a string
- sections
- @body.title, @body.blocks
  @content.title, @content.body
- title inside INLINE expressions
- @body as a block

--------------
TREE ELEMENTS (NODES)

Node attributes:
- __indent__ (hidden) - indentation of the node (its tag) in source code, relative to its parent
- __inline__ (hidden) - True for the head (title) node of an element; False for outline body (tail blocks)

--------------
TREE FILTERS -- PIPELINE EXPRESSIONS

selectors:
- select node A (subtree)
- select list of nodes (subtrees)
- select Lowest Common Ancestor (LCA) of nodes A and B
- select
- select range of nodes from node A (inclusive) to node B (inclusive or exclusive)
- select union of lists of nodes (CSS ,)
- select intersection of lists of nodes (CSS )
- select negation of another selector

transformers:
- remove selected nodes = select complement = make a duplicate of root tree and remove selected nodes
- replace selected nodes with a transformation of each node

Manipulation functions (manipulators / filters):
1) selectors - perform reduction of input tree(s)
   - tagtype
   - .
2) constructors:
3) transformers:

foreach, select, map, reduce

--------------
Use case: HTML page with scripts in <head> section

def unique-lines @body      -- external hypertag that renders its @body and removes all duplicate lines
    @lines = @body.type(h1).class('').id().attr(name='val').render().split().combine(op1,op2)

def response @body
    def head_ @body
        ...
        @lines <= @body[ * tag(script) having(src) :attr unique-lines [:-1]]
    
    html
        head_
        body
            @body * del(tag(script) having(src))

def page:
    ....

response:
    page

--------------
Use case: document with ToC and Bibliography

%section1    -- combines <h1> header with section contents
%section2    -- combines <h2> header with section contents
%ref ...     -- reference to a bibliographical entry within a document
%biblio ...  -- bibliographical entry in the Bibliography list

def ToC @content:
    %toc1 @section:
        @section [h1 attr='xyz' .class #id ] {} (a + .b + #c) [parent] > biblio
        | .......
        @section.pagenumber-first
        @toc2: @section section2

    b: @content %title [0]           -- 1st <title> element
    toc1: @content %section1

%bibliography @content ...

%document @content
    @content > ToC
    ToC(...) of @content
    ToC(...) of each @content[h1]
    @content
    bibliography of @content

document
    ....

"""


#####################################################################################################################################################

class Element:
    """
    Element of a target document. There are 2 types of elements:
    - snippets - short inline strings intended for HORIZONTAL concatenation; no styling (paddings/margin) included
    - blocks - multiline strings intended for VERTICAL concatenation; may include styling:
               horizontal indentation and/or vertical leading/trailing margin (empty lines)
    Blocks, unlike snippets, may include nested blocks and be labelled with section names.
    """

#####################################################################################################################################################

class Block(Element):
    """
    Block of markup text to be rendered into a target document.
    May only be concatenated vertically with other blocks; it is disallowed to prepend/append to existing lines of a block.
    A block may be indented/dedented and its surrounding vertical space can be altered;
    other modifications (to the actual text inside block) are disallowed.
    Internally, a Block is represented as a list of sub-Blocks (ChainBlock), or a plain string (StringBlock).
    Indentation is stored separately and appended upon rendering.
    When nested blocks are being rendered, their indentations sum up.
    A block is ALWAYS rendered with a trailing '\n'. A block may render to None,
    in such case it is removed from the target document.
    """
    indent = None           # indentation of the entire block, to be prepended upon rendering
    section = None          # name of section this block belongs to; None means main section
    
    def render(self, base_indent = ''):
        raise NotImplementedError
    
class ChainBlock(Block):
    
    blocks = None           # list of sub-blocks as Block instances
    
    def render(self, base_indent = ''):
        indent = base_indent + self.indent
        blocks = [block.render(indent) for block in self.blocks]            # render sub-blocks
        blocks = [block for block in blocks if block is not None]           # drop blocks that render to None
        assert all(block and block[-1] == '\n' for block in blocks)
        return ''.join(blocks)
    
class TextBlock(Block):

    text = None
    
    def render(self, base_indent = ''):
        return
    
    
class SpaceBlock(Block):
    """1+ empty vertical lines."""
    
    height = None           # no. of empty lines to render
    
    def __init__(self, height):
        assert height >= 1
        self.height = height
        
    def render(self, base_indent = ''):
        return '\n' * self.height                   # empty lines do NOT have indentation

class EmptyBlock(Block):
    """Empty block to be ignored during rendering of the document."""
    
    def render(self, base_indent = ''):
        return None
    
class Inline(Element):
    """
    Inline element. Contrary to a Block, an Inline:
    - has no indentation
    - has no trailing newline \n
    - has no nested elements ??
    - has no label nor nested sections
    """
    
# class Feed / Stream / Sequence
class Content:
    """Combination of an Inline header and a list of Blocks that together constitute content of an element."""
    
    inline = None
    blocks = None
    

