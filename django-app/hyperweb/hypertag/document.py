"""
TDOM = Text Document Object Model = Document

Representations during parsing:
- AST:  expressions, variables, control statements, syntax structures ...
- TDOM: expressions evaluated, leaf nodes converted to Blocks, control statements executed; hypertags NOT expanded, selectors NOT resolved
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

- title / head / headline / inline
- body / feed / blocks / tail

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

import re
from types import GeneratorType


########################################################################################################################################################
#####
#####  UTILITIES
#####

def add_indent(text, indent, re_start = re.compile(r'(?m)^(?=.)')):
    """
    Append `indent` string at the beginning of each line of `text`, including the 1st line.
    Empty lines (containing zero characters, not even a space) are left untouched!
    """
    if not indent: return text
    return re_start.sub(indent, text)
    # if not text: return text
    # return indent + text.replace('\n', '\n' + indent)
    
def del_indent(text, indent):
    """Remove `indent` string from the beginning of each line of `text`, wherever it is present as a line prefix."""
    if text.startswith(indent): text = text[len(indent):]
    return text.replace('\n' + indent, '\n')

def get_indent(text):
    """
    Retrieve the longest indentation string fully composed of whitespace
    that is shared by ALL non-empty lines in `text`, including the 1st line.
    """
    lines = text.split('\n')
    lines = list(filter(None, [l if l.strip() else '' for l in lines]))          # filter out empty lines
    if not lines: return ''

    for i, column in enumerate(zip(*lines)):        # zip() only eats up as many characters as the shortest line
        if not column[0].isspace() or min(column) != max(column):
            return lines[0][:i]
    else:
        size = min(map(len, lines))
        return lines[0][:size]                      # when all lines are prefixes of each other take the shortest one
    

########################################################################################################################################################
#####
#####  SEQUENCE OF NODES
#####

class Sequence:
    """
    List of HNodes that comprise (a part of) a body of an HNode, or was produced as an intermediate
    collection of nodes during nodes filtering.
    Provides methods for traversing a Hypertag tree and filtering of nodes,
    as well as flattening and cleaning up the list during node construction.
    """
    nodes = None
    
    def __init__(self, *nodes):
        self.nodes = self._flatten(nodes)
    
    def __bool__(self):             return bool(self.nodes)
    def __len__(self):              return len(self.nodes)
    def __iter__(self):             return iter(self.nodes)
    def __getitem__(self, pos):     return self.nodes[pos]
    
    @staticmethod
    def _flatten(nodes):
        """Flatten nested lists of nodes by concatenating them into the top-level list; drop None's."""
        result = []
        for n in nodes:
            if isinstance(n, (list, Sequence, GeneratorType)):
                result += Sequence._flatten(n)
            elif n is not None:
                result.append(n)
        return result
        

########################################################################################################################################################
#####
#####  DOCUMENT OBJECT MODEL
#####

class HNode:
    """"""
    
    tag     = None      # Tag instance whose expand() will be called to post-process the body, in a non-terminal node
    attrs   = None      # list of unnamed attributes to be passed to tag.expand() during rendering
    kwattrs = None      # dict of named attributes to be passed to tag.expand()
    
    body = None         # Sequence of child nodes, in a non-terminal node
    text = None         # headline of this node (if `body` is present), or full text (if `body` is None)
    
    margin = None       # top margin: no. of empty lines to prepend in text output of this node during rendering
    indent = None       # indentation string of this block: absolute (when starts with \n) or relative
                        # to its parent (otherwise); None means this is an inline (headline) block, no indentation

    def __init__(self, body = None, indent = None, **params):
        
        # assign secondary parameters
        for name, value in params.items():
            setattr(self, name, value)
            
        # assign a list of body nodes, with flattening of nested lists and filtering of None's
        self.body = Sequence(body)
        
        # assign indentation, with proper handling of absolute (in parent) vs. relative (in children) indentations
        self.set_indent(indent)
        
    def set_indent(self, indent):
        """
        Sets absolute indentation on self. This calls relative_indent() on all children
        to make their indentations relative to the parent's.
        """
        self.indent = indent
        if self.indent:
            for child in self.body or []:
                child.relative_indent(self.indent)
            
    def relative_indent(self, parent_indent):
        """
        Convert self.indent from absolute to relative by subtracting `parent_indent`.
        If this node is inline (indent=None), the method is called recursively on child nodes.
        """
        if self.indent is None:
            for child in self.body or []: child.relative_indent(parent_indent)
        else:
            assert self.indent.startswith(parent_indent)
            self.indent = self.indent[len(parent_indent):]
        
        # assert self.indabs.startswith(parent_indent)
        # self.indent = self.indabs[len(parent_indent):]
        
    def render(self, indent = ''):
        
        if self.indent:
            assert self.indent[:1] != '\n'      # self.indent must have been converted already to relative
            indent += (self.indent or '')
            
        body = ''.join(node.render(indent) for node in self.body or [])
        text = (self.text or '') + body

        if self.tag:
            text = self.tag.expand(text, *(self.attrs or ()), **(self.kwattrs or {}))
        if self.margin:
            text = self.margin * '\n' + text
        if self.indent:
            text = add_indent(text, self.indent)

        return text
        
        
class HRoot(HNode):
    """Root node of a Hypertag DOM tree."""
    
class HText(HNode):
    """A leaf node containing plain text."""
    
    text = None         # text of this node, either plain text or markup; consists of two parts:
                        #  1) headline (head) - 1st line of `text`, without trailing newline
                        #  2) tailtext (tail) - all lines after the 1st one including the leading newline (!);
                        #     tailtext may contain trailing newline(s), but this is not obligatory
    
    @property
    def headtail(self):
        split = self.text.find('\n')
        if split < 0: split = len(self.text)
        return self.text[:split], self.text[split:]
    
    @property
    def head(self): return self.headtail[0]
    
    @property
    def tail(self): return self.headtail[1]
    
    def __init__(self, text = '', **kwargs):
        super(HText, self).__init__(text = text, **kwargs)
    
    def __str__(self):
        return self.text
        
    def indent(self, spaces = 1, gap = 0, re_lines = re.compile(r'^(\s*\n)+|\s+$')):
        """
        Like self.text, but with leading/trailing empty lines removed and indentation fixed at a given number of `spaces`.
        Optionally, a fixed number (`gap`) of empty lines are added at the beginning.
        """
        text = self.text
        text = re_lines.sub('', text)           # strip leading and trailing empty lines
        
        # replace current indentation with a `spaces` number of spaces; existing tabs treated like a single space
        lines  = text.splitlines()
        indent = ' ' * spaces
        offset = min(len(line) - len(line.lstrip()) for line in lines if line.strip())
        text   = '\n'.join(indent + line[offset:] for line in lines)
        return gap * '\n' + text
    
    
    
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
    

