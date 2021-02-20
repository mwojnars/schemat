"""
Classes that represent Hypertag's native DOM tree (Document Object Model).

@author:  Marcin Wojnarski
"""

import re
from types import GeneratorType

from hypertag.core.errors import VoidTagEx, TypeErrorEx


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
    
def del_indent(text, indent = None):
    """
    Remove `indent` string from the beginning of each line of `text`, wherever it is present as a line prefix.
    If indent=None, maximum common indentation (get_indent()) is truncated.
    """
    if indent is None: indent = get_indent(text)
    if text.startswith(indent): text = text[len(indent):]
    return text.replace('\n' + indent, '\n')

def get_indent(text):
    """
    Retrieve the longest indentation string fully composed of whitespace
    that is shared by ALL non-empty lines in `text`, including the 1st line (if it contains a non-whitespace).
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
    
    def __init__(self, *nodes, _strict = True):
        self.nodes = self._flatten(nodes) if _strict else list(nodes)
        
    def __bool__(self):             return bool(self.nodes)
    def __len__(self):              return len(self.nodes)
    def __iter__(self):             return iter(self.nodes)
    def __getitem__(self, pos):
        if isinstance(pos, slice):
            return Sequence(self.nodes[pos], _strict = False)
        return self.nodes[pos]
    
    @staticmethod
    def _flatten(nodes):
        """Flatten nested lists of nodes by concatenating them into the top-level list; drop None's."""
        result = []
        for n in nodes:
            if n is None: continue
            if isinstance(n, (list, Sequence, GeneratorType)):
                result += Sequence._flatten(n)
            elif isinstance(n, HNode):
                result.append(n)
            else:
                raise TypeErrorEx(f"found {type(n)} instead of an HNode as an element of DOM")
        return result
        
    def set_indent(self, indent):
        for n in self.nodes:
            n.set_indent(indent)
            
    def render(self):
        return ''.join(node.render() for node in self.nodes)

    ### SELECTORS API
    
    def select(self, tag = None, id = None, class_ = None, **attrs):
        """
        Select all nodes (including descendants) that match given search criteria.
        :param tag: desired tag name (<str>) or Tag instance that should be present in a matching node
        :param id: desired value of "id" attribute (<str>)
        :param class_: desired class name to be present inside the "class" attribute (<str>), possibly among other names
        """


########################################################################################################################################################
#####
#####  DOCUMENT OBJECT MODEL
#####

class HNode:
    """"""
    
    tag     = None      # Tag instance whose expand() will be called to post-process the body, in a non-terminal node
    attrs   = None      # list of unnamed attributes to be passed to tag.expand() during rendering
    kwattrs = None      # dict of named attributes to be passed to tag.expand()
    
    body    = None      # Sequence (possibly empty) of all child nodes, in a non-terminal node; None in HText
    
    outline = False     # True/False denotes an "outline" block or an "inline" node; adds a leading newline during rendering if True
    indent  = None      # indentation string of this block: absolute (when starts with \n) or relative
                        # to its parent (otherwise); None means this is an inline (headline) block, no indentation

    # @property
    # def headtail(self):
    #     return self.head, self.tail
    #
    # @property
    # def head(self):
    #     if self.body and self.body[0].is_headline():
    #         return self.body[0]
    #
    # @property
    # def tail(self):
    #     if self.body and self.body[0].is_headline():
    #         return self.body[1:]
    #     else:
    #         return self.body

    def __init__(self, body = None, indent = None, **params):
        
        # assign secondary parameters
        for name, value in params.items():
            setattr(self, name, value)
            
        # assign a list of body nodes, with flattening of nested lists and filtering of None's
        self.body = Sequence(body)
        
        # assign indentation, with proper handling of absolute (in parent) vs. relative (in children) indentations
        self.set_indent(indent)
        
        # assert not self.tag or isinstance(self.tag, Tag)
        
    def set_outline(self):
        self.outline = True

    def set_indent(self, indent):
        """
        Sets absolute indentation on self. This calls relative_indent() on all children
        to make their indentations relative to the parent's.
        """
        self.indent = indent
        if self.indent:
            for child in self.body:
                child.relative_indent(self.indent)

    def relative_indent(self, parent_indent):
        """
        Convert self.indent from absolute to relative by subtracting `parent_indent`.
        If this node is inline (indent=None), the method is called recursively on child nodes.
        """
        if self.indent is None:
            for child in self.body: child.relative_indent(parent_indent)
        elif self.indent[:1] == '\n':
            assert self.indent.startswith(parent_indent)
            self.indent = self.indent[len(parent_indent):]
        else:
            pass        # self.indent is relative already
            
    def render(self):
        
        text = self.outline * '\n' + self._render_body()
        
        if self.outline and self.indent:
            assert self.indent[:1] != '\n'      # self.indent must have been converted already to relative
            text = add_indent(text, self.indent)

        return text
    
    def _render_body(self):
        if not self.tag:
            return self.body.render()
        
        if self.tag.void:
            if self.body: raise VoidTagEx(f"body must be empty for a void tag {self.tag}")
            body = None
        elif self.tag.text:
            body = self.body.render()
        else:
            body = self.body
            
        return self.tag.expand(body, *(self.attrs or ()), **(self.kwattrs or {}))
        
class HRoot(HNode):
    """Root node of a Hypertag DOM tree."""

    def render(self, drop_line = True):
        """
        If this HRoot represents an entire translated document that was originally fed to a Hypertag parser,
        an extra empty line have been prepended by the parser in Grammar.preprocess() and should be removed now
        - set drop_line=True (default) to perform this correction or drop_line=False to skip it.
        """
        output = super(HRoot, self).render()
        return output[1:] if drop_line and output.startswith('\n') else output
        # if not output or not drop_line: return output
        # assert output[0] == '\n'
        # return output[1:]
        

class HText(HNode):
    """A leaf node containing plain text."""
    
    text = None         # text of this node, either plain text or markup after preprocessing; consists of two parts:
                        #  1) headline (head) - 1st line of `text`, without trailing newline
                        #  2) tailtext (tail) - all lines after the 1st one including the leading newline (!);
                        #     tailtext may contain trailing newline(s), but this is not obligatory
    
    # @property
    # def headtail(self):
    #     assert not self.body
    #     split = self.text.find('\n')
    #     if split < 0: split = len(self.text)
    #     return self.text[:split], self.text[split:]
    #
    # @property
    # def head(self): return self.headtail[0]
    #
    # @property
    # def tail(self): return self.headtail[1]

    
    def __init__(self, text = '', **kwargs):
        super(HText, self).__init__(text = text, **kwargs)
    
    def __str__(self):
        return self.text
        
    def set_indent(self, indent):
        self.indent = indent

    def _render_body(self):
        return self.text

    # def indent(self, spaces = 1, gap = 0, re_lines = re.compile(r'^(\s*\n)+|\s+$')):
    #     """
    #     Like self.text, but with leading/trailing empty lines removed and indentation fixed at a given number of `spaces`.
    #     Optionally, a fixed number (`gap`) of empty lines are added at the beginning.
    #     """
    #     text = self.text
    #     text = re_lines.sub('', text)           # strip leading and trailing empty lines
    #
    #     # replace current indentation with a `spaces` number of spaces; existing tabs treated like a single space
    #     lines  = text.splitlines()
    #     indent = ' ' * spaces
    #     offset = min(len(line) - len(line.lstrip()) for line in lines if line.strip())
    #     text   = '\n'.join(indent + line[offset:] for line in lines)
    #     return gap * '\n' + text
    
    
