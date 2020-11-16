# -*- coding: utf-8 -*-
"""
@author:  Marcin Wojnarski
"""

import sys, re, operator
from collections import OrderedDict

from parsimonious.grammar import Grammar as Parsimonious
from six import reraise, string_types, text_type as STR

from nifty.util import asnumber, escape as slash_escape, ObjDict
from nifty.text import html_escape
from nifty.parsing.parsing import ParsimoniousTree as BaseTree

from hyperweb.hypertag.errors import HError, MissingValueEx, UndefinedTagEx, NotATagEx
from hyperweb.hypertag.grammar import XML_StartChar, XML_Char, grammar
from hyperweb.hypertag.structs import Context, Stack
from hyperweb.hypertag.builtin_html import ExternalTag, BUILTIN_HTML
from hyperweb.hypertag.document import add_indent, del_indent, get_indent, Sequence, HText, HNode, HRoot

DEBUG = False


#####################################################################################################################################################
#####
#####  HYPERTAG GRAMMAR & SCRIPT PREPROCESSING
#####

class Grammar(Parsimonious):
    
    default = None      # class-level default instance of HyML_Parser, the one with standard indentation chars;
                        # can be used for parsing of a given text only if the text doesn't contain any of
                        # special characters that are used in the parser for indent / dedent
    
    SPECIAL_SYMBOLS = ['INDENT_S', 'DEDENT_S', 'INDENT_T', 'DEDENT_T']
    CHARS_DEFAULT   = ['\u2768', '\u2769', '\u276A', '\u276B']              # indent/dedent special chars to be used in `default` parser
    
    symbols = None      # dict of special symbols: {symbol_name: character}
    
    def __init__(self, special_chars):
        
        assert len(special_chars) == len(self.SPECIAL_SYMBOLS)
        self.symbols = dict(zip(self.SPECIAL_SYMBOLS, special_chars))
        
        placeholders = self.symbols.copy()
        placeholders.update({'XML_StartChar': XML_StartChar, 'XML_Char': XML_Char})
        
        gram = grammar % placeholders
        # print('Hypertag grammar:')
        # print(gram)
        
        super(Grammar, self).__init__(gram)
    
    @staticmethod
    def get_parser(text):
        """
        Return instance of Grammar class suitable for parsing of a given `text`.
        The grammar must be created with a proper choice of special characters,
        ones that don't collide with character set of `text`.
        """
        if not (set(Grammar.CHARS_DEFAULT) & set(text)):
            return Grammar.default

        chars = []
        
        # find 4 unicode characters that are not in `text`; start with CHARS_DEFAULT[0]
        code = ord(Grammar.CHARS_DEFAULT[0])
        for _ in range(4):
            while chr(code) in text:
                code += 1
            chars.append(chr(code))
            code += 1
            
        return Grammar(chars)
        
    
    def preprocess(self, text):
        """
        Preprocessing:
        - INDENT_* / DEDENT_* inserted in place of leading spaces/tabs
        - trailing whitespace removed in each line
        - comment lines (-- or #) removed
        - whitespace-only lines replaced with empty lines (\n) and insert *after* any neighboring DEDENT_*,
          so that DEDENT's always preceed empty lines and the latter can be interpreted as a top margin
          of the following block (rather than a bottom margin of the preceeding block, which would cause
          issues with proper indentation etc.)
        """
        INDENT_S = self.symbols['INDENT_S']
        DEDENT_S = self.symbols['DEDENT_S']
        INDENT_T = self.symbols['INDENT_T']
        DEDENT_T = self.symbols['DEDENT_T']

        lines = ['']            # output lines after preprocessing; empty line prepended for correct parsing of the 1st block;
        linenum = 0             # current line number in input script
        current = ''            # current indentation, as a string
        margin  = 0             # current no. of empty lines that preceed the next block
        
        # text = text.rstrip('\n')
        script = text.splitlines() + ['']           # empty line appended to ensure equal no. of DEDENT as INDENT
        total  = len(script) - 1
        
        for line in script:
            linenum += 1
            line = line.rstrip()                    # trailing whitespace removed
            tail = line.lstrip()
            indent = line[: len(line) - len(tail)]
            
            if not tail and linenum <= total:       # only whitespace in line? add to the `margin`
                margin += 1
                # lines.append('')
                
            elif tail.startswith('--') or tail.startswith('#'):             # comment line, ignore
                pass
            
            else:                                   # code line, convert `indent` to INDENT_*/DEDENT_* characters and insert `tail`
                if indent == current:
                    pass

                elif indent.startswith(current):
                    increment = indent[len(current):]
                    current = indent
                    symbols = ''.join(INDENT_S if char == ' ' else INDENT_T for char in increment)
                    lines[-1] += symbols
                    tail    = margin * '\n' + tail
                    margin  = 0

                elif current.startswith(indent):
                    decrement = current[len(indent):]
                    current = indent
                    symbols = ''.join(DEDENT_S if char == ' ' else DEDENT_T for char in reversed(decrement))
                    lines[-1] += symbols
                    tail    = margin * '\n' + tail
                    margin  = 0
                    
                else:
                    raise IndentationError(f'indentation on line {linenum} is incompatible with previous line')
                    
                lines.append(tail)
                
        assert current == '', f"'{current}'"

        # append remaining empty lines
        output = '\n'.join(lines) + margin * '\n'
        
        # drop terminal empty line that was added initially before the loop start
        assert output[-1] == '\n'
        output = output[:-1]
        
        print("HyML_Grammar.preprocess() output:")
        print('-----')
        print(output)
        print('-----')

        return output
        
        
Grammar.default = Grammar(special_chars = Grammar.CHARS_DEFAULT)

        
########################################################################################################################################################
#####
#####  NODES
#####

class NODES(object):
    """A lexical container for definitions of all HyML tree node classes."""

    # # modes of rendering & evaluation of subtrees
    # MODE_STRICT = 1         # strict mode: requires that all variables in the subtree are defined (not MISSING), otherwise UndefinedValue exception is raised
    # MODE_NORMAL = 2         # normal mode: None variables are


    ###  BASE NODES  ###

    class node(BaseTree.node):
        isstatic     = False        # True in <static>, <literal> and their subclasses
        isexpression = False        # True in <expression> and subclasses - nodes that implement evaluate() method
        #iselement    = False        # True in <xelement>, <xhypertag> and other xelement subclasses
        #ishypertag   = None         # HypertagSpec object in all hypertags: <xhypertag> nodes and external hypertag objects/functions
        #isspecial    = False        # True in <special> and subclasses - nodes that mix element/hypertag functionality
        
        ispure       = None         # True if this node's render() is a pure constant function: will always return the exact same value
                                    # regardless of the context of execution and without side effects.
                                    # Is set in analyse() or compactify(), not __init__()!
        
        depth        = None         # no. of nested hypertag definitions that surround this node; set and used only in a part of node classes
        
        def check_pure(self):
            """Calculate, set and return self.ispure on the basis of check_pure() of children nodes;
            or return self.ispure if it's already set.
            """
            if self.ispure is not None: return self.ispure
            npure = sum(n.check_pure() for n in self.children)      # sum up the no. of True values among children
            self.ispure = (npure == len(self.children))             # is pure only when all children have pure=True
            return self.ispure
        
        def compactify(self, stack):
            """Replace pure nodes in the subtree rooted at 'self' with static string/value nodes containg pre-computed render() result
            of a given node, so that this pre-computed string/value is returned on all future render() calls on the new node.
            Compactification is a kind of pre-rendering: whatever can be rendered in the tree before runtime variable values are known,
            is rendered and stored in the tree as static values.
            'stack' is needed for render() calls because the subtree may need to push some local variables internally.
            """
            # push compactification down the tree
            for c in self.children: c.compactify(stack)
            
        def compactify_self(self, stack):
            "If 'self' is pure and not static, compactify it, otherwise try to compactify children. Return the new node or self."
            if self.isstatic: return self
            if self.check_pure(): return NODES.merged(self, stack)
            self.compactify(stack)
            return self
            
        def analyse(self, ctx):
            """
            `ctx` is an instance of Context. For read access, it can be used like a dict of current name->node mappings.
            """
            self.depth = ctx.depth
            for c in self.children: c.analyse(ctx)

        def _render_children(self, stack):
            """Render all child nodes and return concatenation of result strings."""
            return u''.join(c.render(stack) for c in self.children)
            
        def _translate_children(self, stack):
            """Translate all children and return as a Sequence."""
            return Sequence(c.translate(stack) for c in self.children)
            
        def _translate_all(self, nodes, stack):
            return Sequence(n.translate(stack) for n in nodes)

        # def render(self, stack):
        #     """
        #     Convert this AST to its textual representation in target markup language.
        #     render() may have side effects: modification of the `stack`.
        #     """
        #     if self.children:
        #         return u''.join(c.render(stack) for c in self.children)
        #     else:
        #         return self.text()

        def __str__(self): return "<%s>" % self.__class__.__name__  #object.__str__(self)

    class bnode(node):
        """A "block" type of node. Returns a Block during rendering."""
    class inode(node):
        """An "inline" type of node. Returns a plain (inline) string during rendering."""

    class xdocument(node):
        
        def translate(self, stack):
            nodes = [c.translate(stack) for c in self.children]
            hroot = HRoot(body = nodes, indent = '\n')
            hroot.indent = ''       # fix indent to '' instead of '\n' after all child indents have been relativized
            return hroot

        # def compactify(self, stack):
        #     # if DEBUG: print("compact", "DOC", stack)
        #     self.children = NODES._compactify_siblings_(self.children, stack)

    class static(node):
        """A node that represents static text: its self.value is already known during parsing or analysis, before render() is called."""
        isstatic = True
        ispure   = True
        value    = None
        
        def setup(self):            self.value = self.text()
        def translate(self, stack): return Sequence(HText(self.value))
        def render(self, stack):    return self.value
        def __str__(self):          return self.value
        

    ###  BLOCKS  ###

    class block(node):
        """Base class for all types of blocks providing common methods."""
        
        @staticmethod
        def _apply_tags(tags, body, stack):
            """Wrap up `body` in subsequent tags processed in reverse order."""
            if not tags: return body
            for tag in reversed(tags):
                body = tag.translate(body, stack)
            assert len(body) == 1
            body[0].set_indent(stack.indentation)
            return body
        
        @staticmethod
        def _render_text(children, stack):
            """Render a list of `children` nodes and wrap up in a single HText node, with proper indentation of lines."""
            
            # temporarily reset indentation to zero for rendering of children; this will be reverted later on
            indent = stack.indentation
            stack.indentation = ''
            
            # leading space is put in place of a marker character /|! in the headline
            output = ' ' + u''.join(c.render(stack) for c in children)
            stack.indentation = indent

            sub_indent = get_indent(output)
            sub_indent = sub_indent[:2]         # max 2 initial spaces/tabs are dropped; remaining sub-indentation is preserved in `output`
            # print(f'sub_indent: "{sub_indent}"')
            return del_indent(output, sub_indent)
        
    class block_text(block):

        def translate(self, stack):
            return Sequence(HText(self.render(stack), indent = stack.indentation))
            
        def render(self, stack):
            return self._render_text(self.children, stack)

            # # temporarily reset indentation to zero for rendering of children; this will be reverted at the end
            # base_indent = stack.indentation
            # stack.indentation = ''
            #
            # # leading space is put in place of a marker character /|! in the headline
            # output = ' ' + u''.join(c.render(stack) for c in self.children)
            #
            # sub_indent = get_indent(output)
            # sub_indent = sub_indent[:2]         # max 2 initial spaces/tabs are dropped; remaining sub-indentation is preserved in `output`
            # # print(f'sub_indent: "{sub_indent}"')
            #
            # output = del_indent(output, sub_indent)
            # # output = add_indent(output, base_indent)
            #
            # stack.indentation = base_indent
            #
            # return output

    class xblock(node):
        """Wrapper around all specific types of blocks that adds top margin to the first returned HNode."""
        def translate(self, stack):
            assert len(self.children) == 2 and self.children[0].type == 'margin'
            margin = self.children[0].get_margin()
            feed   = self.children[1].translate(stack)
            
            if feed:                    # add top margin to the 1st node
                first = feed[0]
                first.margin = (first.margin or 0) + margin
            return feed

    class xblock_text(block):
        """Wrapper around all text blocks that applies tags to the plain text rendered by the inner block."""
        tags  = None        # optional <tags_expand> node
        block = None        # inner text block: block_verbatim, block_normal, or block_markup
        
        def setup(self):
            assert 1 <= len(self.children) <= 2
            self.block = self.children[-1]
            if len(self.children) > 1:
                self.tags  = self.children[0]
                assert self.tags.type == 'tags_expand'
            assert self.block.type in ('block_verbatim', 'block_normal', 'block_markup')
            
        def translate(self, stack):
            body = self.block.translate(stack)
            return self.tags.apply(body, stack) if self.tags else body
        
    class xblock_verbat(block_text): pass
    class xblock_normal(block_text): pass
    class xblock_markup(block_text): pass
    
    class xblock_struct(block):
        tags = None         # obligatory <tags_expand> node
        body = None         # list of nested nodes
        
        def setup(self):
            self.tags = self.children[0]
            self.body = self.children[1:]
            assert self.tags.type == 'tags_expand'
            
        def translate(self, stack):
            # body = self.body.translate(stack) if self.body else []
            body = self._translate_all(self.body, stack)
            return self.tags.apply(body, stack)

    class xblock_assign(block): pass
    class xblock_def(block): pass
    class xblock_try(block): pass
    class xblock_for(block): pass
    
    class xblock_if (block):
        clauses  = None         # list of 1+ <clause_if> nodes
        elsebody = None         # optional <body_*> node for the "else" branch
        
        def setup(self):
            if self.children and self.children[-1].type.startswith('body_'):
                self.clauses = self.children[:-1]
                self.elsebody = self.children[-1]
            else:
                self.clauses = self.children

        def translate(self, stack):
            feed = self._select_clause(stack)
            
            # reduce indentation of nodes in `feed` to match the current stack.indentation
            # (i.e., ignore sub-indent of a clause block)
            assert len(set(n.indent for n in feed)) <= 1, "Unequal indentations of child nodes inside an 'if...' block?"
            for n in feed:
                assert n.indent is None or n.indent[0] == '\n'      # child indentations are still absolute ones, not relative
                n.indent = stack.indentation
                
            return feed
        
        def _select_clause(self, stack):
            for clause in self.clauses:
                if clause.test.evaluate(stack):
                    return clause.translate(stack)
            if self.elsebody:
                return self.elsebody.translate(stack)
            return Sequence()
        
    class xclause_if(node):
        test = None             # <expression> node containing a test to be performed
        body = None             # <body> to be rendered if the clause is positive
        def setup(self):
            assert len(self.children) == 2
            self.test, self.body = self.children
        def translate(self, stack):
            return self.body.translate(stack)
        def render(self, stack):
            return self.body.render(stack)
        
        
    ###  BODY & LINES  ###

    class xbody_struct(node):
        def translate(self, stack):
            return self._translate_children(stack)

    # class xbody_struct(body): pass
    # class xbody_verbat(body): pass
    # class xbody_normal(body): pass
    # class xbody_markup(body): pass

    class line(node):
        def translate(self, stack):
            return Sequence(HText(self.render_inline(stack)))
        def render(self, stack):
            return stack.indentation + self.render_inline(stack)
        def render_inline(self, stack):
            """Render contents of the line, i.e., everything except indentation. Implemented by subclasses."""
            raise NotImplementedError

    class xline_verbat(line):
        def render_inline(self, _):
            return self.text()

    class xline_normal(line):
        def render_inline(self, stack):
            assert len(self.children) == 1
            child = self.children[0]
            assert child.type == 'line_markup'
            text = child.render_inline(stack)               # this calls xline_markup.render_inline()
            escape = self.tree.config['escape_function']
            return escape(text)

    class xline_markup(line):
        def render_inline(self, stack):
            # markup = NODES.node.render(self, stack)         # call to super-method that renders embedded expressions, in addition to static text
            markup = self._render_children(stack)           # renders embedded expressions, in addition to static text
            return markup

    
    ###  TAGS & HYPERTAGS  ###

    class xtags_expand(node):
        """List of tag_expand nodes."""
        def apply(self, body, stack):
            """Wrap up `body` in subsequent tags processed in reverse order."""
            for tag in reversed(self.children):
                assert tag.type == 'tag_expand'
                body = tag.translate(body, stack)
            assert len(body) == 1
            body[0].set_indent(stack.indentation)
            return body
        
    class xtag_expand(node):
        """
        Occurrence of a tag.
        NOTE #1: unnamed attrs can be *mixed* with named ones (unlike in python) -
                 during tag expansion all unnamed attrs are passed first to a tag, followed by all named (keyword-) ones
        NOTE #2: same attr can appear more than once, in such case its values (must be strings!) get space-concatenated;
                 this is particularly useful for "class" attibute and its short form:  div .top.left.darkbg
        """
        
        DEFAULT = "div"     # default `name` when no tag name was provided (a shortcut was used: .xyz or #xyz)
        name  = None        # tag name: a, A, h1, div ...
        tag   = None        # resolved definition of this tag, either as <tag_def>, or Hypertag instance
        attrs = None        # 0+ list of <attr_short> and <attr_val> nodes
        unnamed = None      # list of <expression> nodes of unnamed attributes from `attrs`
        named   = None      # OrderedDict of {name: <expression>} of named attributes from `attrs`
        
        def setup(self):
            
            # retrieve `name` of this tag
            head = self.children[0]
            if head.type == 'name_id':
                self.name = head.value
                self.attrs = self.children[1:]
            else:
                self.name = self.DEFAULT
                self.attrs = self.children
                
            self.unnamed = []
            self.named = [] #OrderedDict()
            
            # collect attributes: their names (optional) and expressions (obligatory);
            for attr in self.attrs:
                name = attr.name
                expr = attr.expr
                if name is None:
                    self.unnamed.append(expr)
                else:
                    self.named.append((name, expr))
                    # if name in self.named: raise DuplicateAttribute(f"Attribute '{name}' appears twice on attributes list of tag '{self.name}'", attr)
                    # self.named[name] = expr
                
        def analyse(self, ctx):
            
            self.depth = ctx.depth
            for c in self.attrs: c.analyse(ctx)
            
            self.tag = ctx.get(self.name)
            print('self.tag:', self.tag)
            if self.tag is None: raise UndefinedTagEx(f"Undefined tag '{self.name}'", self)
            
        def translate(self, body, stack):
    
            # evaluate attributes to calculate their actual values
            attrs, kwattrs = self._eval_attrs(stack)
            
            if isinstance(self.tag, ExternalTag):
                return Sequence(HNode(body, tag = self.tag, attrs = attrs, kwattrs = kwattrs))
            else:
                raise NotATagEx(f"Not a tag: '{self.name}' ({self.tag.__class__})", self)
            
        def _eval_attrs(self, stack):
            unnamed = [attr.evaluate(stack) for attr in self.unnamed]
            
            named = {}
            for name, expr in self.named:
                value = expr.evaluate(stack)
                if name in named:
                    named[name] += ' ' + value       # = f'{named[name]} {value}'
                else:
                    named[name] = value
                    
            return unnamed, named
            
    class xtag_def(node):
        """Definition of a tag (hypertag)."""


    ###  ATTRIBUTES & ARGUMENTS  ###
    
    class xattrs_def(node):
        """List of attributes inside a tag definition (NOT in an occurrence)."""
        
        
    class attr(node):
        """Attribute inside a tag occurrence OR tag definition:
            unnamed / named / short (only in tag occurence) / body (only in tag definition).
        """
        name = None         # [str] name of this attribute; or None if unnamed
        expr = None         # <expression> node of this attribute; or None if no expression present (for attr definition without default)

    class xattr_val(attr):
        def setup(self):
            assert 1 <= len(self.children) <= 2
            if len(self.children) == 2:
                self.name = self.children[0].value
            self.expr = self.children[-1]
            
    class xattr_short(attr):
        def setup(self):
            symbol = self.fulltext[self.pos[0]]
            assert symbol in '.#'
            self.name = 'class' if symbol == '.' else 'id'
            assert len(self.children) == 1
            self.expr = self.children[-1]
        

    ###  EXPRESSIONS - ROOT NODES  ###
    
    class expression(node):
        """Base class for all nodes that represent an expression, or its part (a subexpression)."""
        
        qualifier = None            # optional qualifier: ? or ! ... used only in a few node types
        
        def evaluate(self, stack):
            raise NotImplementedError

        def evaluate_with_qualifier(self, stack):
            """Special variant of evaluate() to be used in these expression nodes that may have a not-None qualifier.
               They should call this method in evaluate() and implement _eval_inner_qualified().
            """
            try:
                val = self._eval_inner_qualified(stack)
            except Exception as ex:
                if self.qualifier == '?': return ''
                else: raise
            
            if val: return val
            
            # `val` is false ... check qualifiers to undertake appropriate action
            if self.qualifier == '?': return ''
            if self.qualifier == '!': raise MissingValueEx("Obligatory expression has a false or empty value", self)
            return val

        def _eval_inner_qualified(self, stack):
            raise NotImplementedError


    class expression_root(expression):
        """Base class for root nodes of all non-literal embedded expressions, either in markup or attribute/argument lists.
        """
        qualifier = None        # optional qualifier: ? or !
        context   = None        # copy of Context that has been passed to this node during analyse(); kept for re-use by render(),
                                # in case if the expression evaluates to yet another (dynamic) piece of HyML code
        def setup(self):
            # see if there is a qualifier added as a sibling of this node
            if self.sibling_next and self.sibling_next.type == 'qualifier':
                self.qualifier = self.sibling_next.text()
        
        def render(self, stack):
            """Rendering is invoked only for a root node of an expression embedded in xline_* node of text."""
            return STR(self.evaluate(stack))
        
        def evaluate(self, stack):
            return self.evaluate_with_qualifier(stack)
        
        def _eval_inner_qualified(self, stack):
            assert len(self.children) == 1
            return self.children[0].evaluate(stack)

    class xexpr(expression_root): pass
    class xexpr_var(expression_root): pass
    class xexpr_augment(expression_root): pass
    

    ###  EXPRESSIONS - TAIL OPERATORS  ###
    
    class tail(node):
        """Tail operators implement apply() instead of evaluate()."""
        def apply(self, obj, stack):
            raise NotImplementedError

    class xcall(tail):
        title = 'function call (...)'                   # for error messaging
        
        def compactify(self, stack):
            assert len(self.children) <= 1
            if len(self.children) == 1:
                assert self.children[0].type == 'args'
            self.children = [n.compactify(stack) for n in self.children]
            return self
        
        def apply(self, obj, stack):
            if self.children:                           # any parameters for this call?
                args, kwargs = self.children[0].evaluate(stack)
            else:
                args, kwargs = (), {}

            # # calling a native hypertag like a function? pass the stack to support inner hypertags
            # if getattr(obj, 'ishypertag', False) and isinstance(obj, Closure):
            #     return obj.expand(args, kwargs, caller = self)
            
            return obj(*args, **kwargs)
            
    class xslice_value(expression):
        def evaluate(self, stack):
            assert len(self.children) <= 1
            if self.children: return self.children[0].evaluate(stack)
            return None                                 # None indicates an empty index, like in 1:, in the slice(...) object
            
    class xindex(tail):
        """Element access: [...], with any type of subscript: [i], [i:j], [i:j:k], [::] etc.
        Children after reduction are either a single <xexpr> node (no slicing),
        or a list of 2-3 <xslice_value> nodes in case of a slice.
        """
        title = 'sequence index [...]'

        def compactify(self, stack):
            assert 1 <= len(self.children) <= 3
            self.children = [n.compactify(stack) for n in self.children]
            return self

        def apply(self, obj, stack):
            # simple index: [i]
            if len(self.children) == 1:
                index = self.children[0].evaluate(stack)
                return obj[index]
            
            # 2- or 3-element slice index:  i:j[:k]
            values = [n.evaluate(stack) for n in self.children]
            return obj[slice(*values)]
        
    class xmember(tail):
        title = 'member access "."'
        def compactify(self, stack):
            return self                                 # no compactification, it's only 1 child: a static identifier
        def apply(self, obj, stack):
            assert self.children[0].type == "var_id"
            member = self.children[0].value
            return getattr(obj, member)
    
    class xqualifier(static):
        def setup(self): self.value = ''

    class xfactor(expression):
        """A chain of tail operators: () [] . with optional trailing qualifier ? or ! """
        atom      = None
        tail      = None        # optional chain of tail operators: call / index / member
        qualifier = None        # optional qualifier: ? or !
        
        def setup(self):
            self.atom = self.children[0]
            self.tail = self.children[1:]
            if self.tail and self.tail[-1].type == 'qualifier':
                qualifier_node = self.tail.pop()
                self.qualifier = qualifier_node.text()
            
        def evaluate(self, stack):
            return self.evaluate_with_qualifier(stack)
        
        def _eval_inner_qualified(self, stack):
            val = self.atom.evaluate(stack)
            for op in self.tail:
                assert isinstance(op, NODES.tail)
                val = op.apply(val, stack)
            return val
    
    class xfactor_var(xfactor): pass
    
    
    ###  EXPRESSIONS - OPERATORS (BINARY / TERNARY)  ###

    class static_operator(static):
        name  = None        # textual representation of the operator, for possible rendering back into the document
        apply = None        # corresponding function from 'operator' module
        
        ops = ['+ add', '- sub', '** pow', '* mul', '// floordiv', '% mod', '<< lshift', '>> rshift', '& and_', '| or_', '^ xor',
               '< lt', '> gt', '== eq', '>= ge', '<= le', '!= ne', 'is is_', 'is not is_not']
        ops = [m.rsplit(' ', 1) for m in ops]
        ops = {op: getattr(operator, fun) for op, fun in ops}
        
        # '/' must be added separately, because it has different names (and behavior) in Python 2 vs. 3
        ops['/'] = getattr(operator, 'div', None) or operator.truediv
        
        # extra operators, implemented by ourselves
        ops['in'] = lambda x, d: x in d                         # operator.contains() is not suitable bcs it takes operands in reversed order
        ops['not in'] = lambda x, d: x not in d
        ops[''] = ops['+']                                      # missing operator mapped to '+' (implicit +)
        
        def setup(self):
            self.name = self.text()
            self.name = ' '.join(self.name.split())             # to replace multiple whitespaces in "not in", "is not"
            self.apply = self.ops[self.name]
            
    class xop_multiplic(static_operator): pass
    class xop_additive(static_operator): pass
    class xop_power(static_operator): pass
    class xop_shift(static_operator): pass
    class xop_comp(static_operator): pass
    class xneg(static): pass                            # negation is implemented inside <xarith_expr>
    class xnot(static): pass
    
    class chain_expression(expression):
        """A chain of different binary operators, all having the same priority: x1 OP1 x2 OP2 x3 ..."""

        def evaluate(self, stack):
            head, tail = self._prepare(stack)
            ops = tail[0::2]                            # items 0,2,4,... are operators
            exprs = tail[1::2]                          # items 1,3,5,... are subsequent expressions, after the initial one
            assert len(exprs) == len(ops)
            
            res = head
            for op, expr in zip(ops, exprs):                # adding terms one by one to 'res'
                val = expr.evaluate(stack)
                res = op.apply(res, val)                    # calulate: <res> = <res> op <val>
            
            return res
        
        def _prepare(self, stack):
            """Pre-processesing of the 1st item of the chain for evaluate(). Returns the chain as (head, tail) for actual evaluation.
            Override in subclasses if the 1st item is treated differently then the others."""
            head = self.children[0].evaluate(stack)
            tail = self.children[1:]
            return head, tail
    
    class xpow_expr(chain_expression):
        """chain of power operators: ** """
    class xterm(chain_expression):
        """chain of multiplicative operators: * / // %"""
    class xshift_expr(chain_expression):
        """chain of shift operators: << >>"""
    class xarith_expr(chain_expression):
        """chain of additive operators: neg + -"""
        def _prepare(self, stack):
            if self.children[0].type == 'neg':
                head = self.children[1].evaluate(stack)
                if head is not None:
                    head = -head
                tail = self.children[2:]
            else:
                head = self.children[0].evaluate(stack)
                tail = self.children[1:]
            return head, tail
    
    class xconcat_expr(expression):
        """
        Chain of concatenation operators: x1 x2 x3 ... (space-separated expressions).
        Values of subexpressions are converted to strings and concatenated WITHOUT space.
        This is an extension of the Python syntax of concatenating literal strings, like in:
               'Python' " is "  'cool'
        """
        def evaluate(self, stack):
            return ''.join(STR(expr.evaluate(stack)) for expr in self.children)
            # items = (STR(expr.evaluate(stack)) for expr in self.children)
            # return ' '.join(item for item in items if item != '')     # empty strings '' silently removed from concatenation
        
    class simple_chain_expression(expression):
        """A chain built from the same binary operator: x OP y OP z OP ..."""
        oper = None                 # the operator function to be applied
        def evaluate(self, stack):
            res = self.children[0].evaluate(stack)
            for expr in self.children[1:]:
                val = expr.evaluate(stack)
                res = self.oper(res, val)
            return res
    
    class xand_expr(simple_chain_expression):
        "chain of bitwise-and operators: &"
        oper = operator.and_
        name = '&'
    class xxor_expr(simple_chain_expression):
        "chain of bitwise-xor operators: ^"
        oper = operator.xor
        name = '^'
    class xor_expr(simple_chain_expression):
        "chain of bitwise-or (filtering) operators: |"
        name = '|'
        @staticmethod
        def oper(x, y):
            "x | y. If 'y' is a function or method, returns y(x) (filter application), else calculates x | y in a standard way."
            #if isfunction(y): return y(x)
            return x | y                            # here, 'y' can be a Filter instance
            
    class xcomparison(chain_expression):
        "chain of comparison operators: < > == >= <= != in is, not in, is not"
        raise_null = False
        
    class xnot_test(expression):
        """not not not ..."""
        def evaluate(self, stack):
            assert len(self.children) >= 2 and self.children[-1].isexpression
            neg = not (len(self.children) % 2)              # check parity of 'children' to see if negation appears even or odd no. of times
            val = self.children[-1].evaluate(stack)
            return not val if neg else val
    
    class xand_test(simple_chain_expression):
        "chain of logical 'and' operators. Lazy evaluation: if false item is encountered, it's returned without evaluation of subsequent items"
        name = 'and'
        def evaluate(self, stack):
            res = self.children[0].evaluate(stack)
            for expr in self.children[1:]:
                if not res: return res
                res = res and expr.evaluate(stack)
            return res
    class xor_test(simple_chain_expression):
        "chain of logical 'or' operators. Lazy evaluation: if true item is encountered, it's returned without evaluation of subsequent items"
        name = 'or'
        def evaluate(self, stack):
            res = self.children[0].evaluate(stack)
            for expr in self.children[1:]:
                if res: return res
                res = res or expr.evaluate(stack)
            return res
    
    class xifelse_test(expression):
        """
        ... if ... else ... Lazy evaluation of arguments: only the true branch of the condition undergoes evaluation.
        "else" branch is optional, "else None" is assumed if "else" is missing.
        """
        def evaluate(self, stack):
            assert len(self.children) in (2, 3)             # the expression is compactified, that's why a single child is not possible here
            if self.children[1].evaluate(stack):
                return self.children[0].evaluate(stack)
            if len(self.children) == 3:
                return self.children[2].evaluate(stack)
            return None                                     # default None when "else..." branch is missing
    
    # class xempty_test(expression):
    #     """
    #     Test for emptiness: X OP [TEST]
    #     If the 1st operand (X) evaluates to false, a predefined default value is returned:
    #     - '' if operator OP is ?
    #     - None if operator OP is !
    #     Otherwise, X is returned unmodified. If an optional 2nd operand (TEST) is present and evaluates to false,
    #     the default ('' or None) is returned regardless of the value of X.
    #     Additionally, if OP = ?, any exceptions raised during evaluation of X are caught and
    #     treated the same as if X was false.
    #     """
    

    ###  EXPRESSIONS - LITERALS  ###

    class literal(expression):
        isstatic = True
        ispure   = True
        value    = None
        def setup(self):            self.value = self.text()
        def analyse(self, ctx):     pass
        def evaluate(self, stack):  return self.value
    
    class xnumber(literal):
        def setup(self):
            s = self.text()
            try:
                self.value = int(s)
                return
            except: pass
            self.value = float(s)
    
    class xboolean(literal):
        def setup(self):
            self.value = (self.text() == 'True')

    class xstring(literal):
        def setup(self):
            self.value = self.text()[1:-1]              # remove surrounding quotes: '' or ""
    
    #class xstr_unquoted(literal): pass
    class xattr_short_lit(literal): pass
    class xnone(literal): pass


    ###  STATIC nodes  ###
    
    class xname_id(static): pass
    class xname_xml(static): pass
    class xtext(static): pass
    class xnl(static): pass
    
    class xmargin(static):
        def get_margin(self):
            # assert self.value == '\n' * len(self.value)
            return len(self.value)

    class xescape(static):
        def setup(self):
            escape = self.text()
            assert len(escape) == 2 and escape[0] == escape[1]
            self.value = escape[0]                          # the duplicated char is dropped
    
    class xup_indent(static):
        """Marks occurrence of an extra 1-space indentation in a title line. Renders to empty string."""
        def render(self, stack):
            return ''
    
    class xindent(node):
        whitechar = None
        def translate(self, stack):
            """Called when INDENT/DEDENT surround a block."""
            stack.indent(self.whitechar)
            return None
        def render(self, stack):
            """Called when INDENT/DEDENT surround a line within a text block."""
            stack.indent(self.whitechar)
            return ''

    class xdedent(node):
        whitechar = None
        def translate(self, stack):
            stack.dedent(self.whitechar)
            return None
        def render(self, stack):
            stack.dedent(self.whitechar)
            return ''

    class xindent_s(xindent):
        whitechar = ' '
    class xindent_t(xindent):
        whitechar = '\t'
    class xdedent_s(xdedent):
        whitechar = ' '
    class xdedent_t(xdedent):
        whitechar = '\t'


    ###  SYNTHETIC nodes  ###
    
    class merged(static):
        """
        An artificial node created during compactification by merging several sibling nodes that are all pure (or static, in particular).
        Values of the original nodes (strings to be concatenated) are retrieved from their render().
        """
        value = None        # pre-rendered output of the compactified nodes
        ex = None           # if MissingValueEx exception was caught during rendering, it's stored here as an (exception, traceback) pair
        
        def __init__(self, node, stack):
            self.tree = node.tree
            self.fulltext = node.fulltext
            self.pos = node.pos
            try:
                self.value = node.render(stack)
            except MissingValueEx as ex:
                self.ex = (ex, sys.exc_info()[2])
                
        def merge(self, node, stack, sep):
            self.pos = (self.pos[0], node.pos[1])
            if self.ex: return                          # we already know that an exception will be raised upon self.render(), no need to append new nodes
            try:
                nodeValue = node.render(stack)
                self.value += sep + nodeValue
            except MissingValueEx as ex:
                self.ex = (ex, sys.exc_info()[2])
    
        def render(self, stack):
            if self.ex: reraise(None, self.ex[0], self.ex[1])
            return self.value
        
        def info(self):
            return "%s at position %s rendering: %s" % (self.infoName(), self.pos, slash_escape(str(self.value)))
    
    
    ###  UTILITY METHODS  ###

    @staticmethod
    def _compactify_siblings_(nodes, stack, sep = u''):
        "Compactify a list of sibling nodes, by compactifying each one separately when possible and then merging neighboring static nodes."
        out = []
        last = None         # the current last <merged> node; can be expanded if the subsequent node is also pure
        
        for node in nodes:
            #print(' ', node, node.check_pure())
            if node.check_pure():                               # a pure node that can be reduced into a <merged> node?
                if last: last.merge(node, stack, sep)
                else:
                    last = NODES.merged(node, stack)
                    out.append(last)
            else:                                               # non-pure node? let's compactify recursively its subtree and append
                node.compactify(stack)
                out.append(node)
                last = None
        
        return out
    

#####################################################################################################################################################
#####
#####  HypertagAST
#####

class HypertagAST(BaseTree):

    NODES  = NODES              # must tell the BaseTree's rewriting routine where node classes can be found
    parser = None               # instance of Grammar to be used by super class __init__() and parse() to convert input text to AST
    _use_init = False

    ###  Configuration of rewriting process  ###
    
    # nodes that will be ignored during rewriting (pruned from the tree)
    _ignore_  = "nl ws space gap comma verbatim comment " \
                "mark_struct mark_verbat mark_normal mark_markup"
    
    # nodes that will be replaced with a list of their children
    _reduce_  = "block_control target core_blocks tail_blocks headline body body_text " \
                "head_verbat head_normal head_markup " \
                "attrs_val attr_named value_named value_unnamed value_of_attr kwarg " \
                "tail_verbat tail_normal tail_markup core_verbat core_normal core_markup " \
                "embedding embedding_braces embedding_eval " \
                "expr_root subexpr slice subscript trailer atom literal"
    
    # nodes that will be replaced with their child if there is exactly 1 child AFTER rewriting of all children;
    # they must have a corresponding x... node class, because pruning is done after rewriting, not before
    _compact_ = "factor_var factor pow_expr term arith_expr shift_expr and_expr xor_expr or_expr concat_expr " \
                "comparison not_test and_test or_test ifelse_test expr_tuple"

    _reduce_anonym_ = True      # reduce all anonymous nodes, i.e., nodes generated by unnamed expressions, typically groupings (...)
    _reduce_string_ = True      # if a node to be reduced has no children but matched a non-empty part of text, it shall be replaced with a 'string' node
    

    ###  Dependencies & semantic analysis  ###

    # a Loader instance that was used to load this HyML source file and should be used for loading related files;
    # can perform caching and dependencies tracking; see loaders.Loader
    loader = None
    
    filename = None             # name of the file or resource where this document comes from; for debug messages and dependencies tracking
    dependencies = None         # files included/imported by self, as a set of canonical names; for caching and dep. tracking
    # init_params = None          # dict of initialization parameters, for passing to a child document in load()
    
    
    ###  Run-time parameters of parsing process  ###
    
    config_default = {
        'target_language':      "HTML",             # target language; currently only "HTML" is supported
        'escape_function':      html_escape,        # plaintext-to-markup conversion (escaping) function
        'compact':              True,               # if True, compactification is performed after analysis: pure (static, constant) nodes are replaced with their pre-computed render() values,
                                                    # which are returned on all subsequent render() requests; this improves performance when
                                                    # a document contains many static parts and variables occur rarely
    }
    config = None

    # dict of external global hypertags/vars to be created on parsing start-up after built-in symbols; set in __init__ through a `context` argument
    globals = {}

    
    ###  Output of parsing and analysis  ###

    text    = None              # full text of the input string fed to the parser
    ast     = None              # raw AST generated by the parser; for read access
    root    = None              # root node of the final tree after rewriting

    symbols   = None            # after _pull(), dict of all top-level symbols as name->node pairs
    hypertags = None            # after _pull(), dict of top-level hypertags indexed by name, for use by the client as hypertag functions;
                                # includes imported hypertags (!), but not external ones, only the native ones defined in HyML

    
    def __init__(self, text, context = {}, stopAfter = None, **config):
        """
        :param text: input document to be parsed
        :param stopAfter: either None (full parsing), or "parse", "rewrite"
        """
        self.globals = context.copy()
        
        self.config = self.config_default.copy()
        self.config.update(**config)
        
        self.parser = Grammar.get_parser(text)
        text = self.parser.preprocess(text)

        # parse input text to the 1st version of AST (self.ast) as returned by Parsimonious,
        # then rewrite it to custom NODES.* classes rooted at self.root
        super(HypertagAST, self).__init__(text, stopAfter = stopAfter)
        
        if self.root is None:                                   # workaround for Parsimonious bug in the special case when text="" (Parsimonious returns None instead of a tree root)
            self.root = NODES.xdocument(self, ObjDict(start = 0, end = 0, children = [], expr_name = 'document'))
        assert isinstance(self.root, NODES.xdocument)
        if stopAfter == "rewrite": return

        self.analyse()
        if stopAfter == "analyse": return


    def analyse(self):
        "Link occurences of variables and hypertags with their definition nodes, collect all symbols defined in the document."
        
        if self.loader:                 # only upon analyse() we start tracking dependencies, extracted from <include> nodes;
            self.dependencies = set()   # before analysis, dependencies are not known and must not be relied upon (equal None)
        
        # for name in self.globals:       # make sure that global symbols use correct names: only regular identifiers, and not reserved
        #     self._check_name(name, None, "Error in global symbols. ")
        
        # ctx = ctx.copy() if ctx else Context()
        ctx = Context()
        
        assert self.config['target_language'] == 'HTML'
        ctx.pushall(BUILTIN_HTML)       # seed the context with built-in symbols
        # ctx.pushall(FILTERS)          # ...and standard filters
        
        ctx.pushall(self.globals)       # seed the context with initial global symbols configured by the user
        state = ctx.getstate()          # keep the state, so that after analysis we can retrieve newly defined symbols alone
        
        if DEBUG:
            global _debug_ctx_start
            _debug_ctx_start = state
        
        self.root.analyse(ctx)          # now we have all top-level symbols in 'ctx'
        
        # pull top-level symbols & hypertags from the tree
        self.symbols = ctx.asdict(state)
        self.hypertags = {name: obj for name, obj in self.symbols.items() if isinstance(obj, NODES.xtag_def)}
        
        # # perform compactification; a part of it was already done during analysis, because every hypertag launches
        # # compactification in its subtree on its own, during analysis; what's left is compactification
        # # of the top-level document only
        # if self.config['compact']: self.compactify()
        
    def compactify(self):
        """
        Replace pure nodes in the document tree with static string/value nodes containg pre-computed render() result
        of a given node, so that this pre-computed string/value is returned on all future render() calls on the new node.
        
        The document node doesn't take any arguments, so its render() is often a pure function, if only there are no non-pure
        external references to variables/functions inside. So yes, the document can in many cases be replaced with a static string.
        Although we lose access to the original tree (except the access via self.symbols and self.hypertags),
        this access is normally not needed anymore. If it is, you should disable compactification in parser settings.
        """
        self.root.compactify(Stack())
    
    def translate(self):
        dom = self.root.translate(Stack())
        assert isinstance(dom, HRoot)
        return dom

    def render(self):
        dom = self.translate()
        output = dom.render()
        assert output[0] == '\n'        # extra empty line was prepended by Grammar.preprocess() and must be removed now
        return output[1:]

    def __getitem__(self, tag_name):
        """Returns a top-level hypertag node wrapped up in Hypertag, for isolated rendering. Analysis must have been performed first."""
        return self.hypertags[tag_name]
        

#####################################################################################################################################################
#####
#####  HYPERTAG PARSER
#####

class HypertagParser:
    """
    Hypertag parser.
    """
    def __init__(self, **config):
        self.config = config
        
    def parse(self, source):
        
        ast = HypertagAST(source, **self.config)
        return ast.render()
    

########################################################################################################################################################
#####
#####  MAIN
#####

if __name__ == '__main__':
    
    DEBUG = True
    
    text = """
        h1 : a href="http://xxx.com" : b | This is <h1> title
            p / And <a> paragraph.
            p | tail text
              |    tail text
              | tail text
        """
        # """
        # div
        #     | Ala
        #       kot { 'Mru' "czek" 123 } {0}? {456}!
        #         Ola
        #     /     i pies
        #           Azor
        #
        # if False:
        #     div#box.top.grey
        # elif True:
        #     div #box class="bottom"
        # else
        #     input enabled=True
        # """

    text = """
        | Ala ma
          kota
        p | Ala ma
            kota
        p
          | tail text
              tail text

             xxx
    """
    
    # text = """
    #     if {False}:
    #         |Ala
    #     elif True * 5:
    #         div | Ola
    #     / kot
    # """
    
    # text = """
    # h1
    #     p : b | Ala
    #     p
    #         |     Ola
    #             i kot
    #
    # """
    
    tree = HypertagAST(text, stopAfter ="rewrite")
    
    # print()
    # print("===== AST =====")
    # print(tree.ast)
    # print(type(tree.ast))
    # print()
    print("===== After rewriting =====")
    print(tree)
    print()
    

    print("===== After semantic analysis =====")
    tree.analyse()
    # print()
    # print(tree)
    print()
    
    print("===== After rendering =====")
    print(tree.render())
    # print(tree.A())
    print()
    