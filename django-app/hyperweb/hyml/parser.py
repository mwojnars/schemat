import sys, re
from collections import OrderedDict

from parsimonious.grammar import Grammar as Parsimonious
from six import reraise, string_types, text_type as unicode

from nifty.util import asnumber, escape as slash_escape, ObjDict
from nifty.text import html_escape
from nifty.parsing.parsing import ParsimoniousTree as BaseTree

from hyperweb.hyml.errors import NullValue, UndefinedTag, NotATag, DuplicateAttribute
from hyperweb.hyml.grammar import XML_StartChar, XML_Char, hyml_grammar
from hyperweb.hyml.structs import Context, Stack
from hyperweb.hyml.builtin_html import ExternalTag, BUILTIN_HTML

DEBUG = False


########################################################################################################################################################
#####
#####  UTILITIES
#####

def _add_indent(text, indent):
    """Append `indent` string at the beginning of each line of `text`, including the 1st line."""
    if not text: return text
    return indent + text.replace('\n', '\n' + indent)
    
def _del_indent(text, indent):
    """Remove `indent` string from the beginning of each line of `text`, if it's present; 1st line is left unmodified!"""
    if text.startswith(indent): text = text[len(indent):]
    return text.replace('\n' + indent, '\n')

    
#####################################################################################################################################################
#####
#####  HYML_GRAMMAR
#####

class HyML_Grammar(Parsimonious):
    
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
        
        grammar = hyml_grammar % placeholders
        # print('HyML_Grammar:')
        # print(grammar)
        
        super(HyML_Grammar, self).__init__(grammar)
    
    @staticmethod
    def get_parser(text):
        """
        Return HyML_Parser instance suitable for parsing a given `text`.
        The parser must be created with a proper choice of special characters,
        ones that don't collide with character set of `text`.
        """
        if not (set(HyML_Grammar.CHARS_DEFAULT) & set(text)):
            return HyML_Grammar.default

        chars = []
        
        # find 4 unicode characters that are not in `text`; start with CHARS_DEFAULT[0]
        code = ord(HyML_Grammar.CHARS_DEFAULT[0])
        for _ in range(4):
            while chr(code) in text:
                code += 1
            chars.append(chr(code))
            code += 1
            
        return HyML_Grammar(chars)
        
    
    def preprocess(self, text):
        """
        Preprocessing:
        - INDENT_* / DEDENT_* inserted in place of leading spaces/tabs
        - trailing whitespace removed
        - whitespace-only lines changed to empty lines (but \n preserved)
        - comment lines (--) removed
        """
        INDENT_S = self.symbols['INDENT_S']
        DEDENT_S = self.symbols['DEDENT_S']
        INDENT_T = self.symbols['INDENT_T']
        DEDENT_T = self.symbols['DEDENT_T']

        lines = []
        linenum = 0             # current line number in input script
        current = ''            # current indentation, as a string

        text = text.rstrip('\n')
        code = text.splitlines() + ['']             # empty line is appended to ensure equal no. of DEDENT as INDENT
        total = len(code) - 1
        
        for line in code:
            linenum += 1
            line = line.rstrip()                    # trailing whitespace removed
            tail = line.lstrip()
            indent = line[: len(line) - len(tail)]
            
            if not tail and linenum <= total:       # only whitespace in line? append empty line
                lines.append('')
                
            elif tail.startswith('--'):             # comment line, ignore
                pass
            
            else:                                   # code line, convert `indent` to INDENT_*/DEDENT_* characters and insert `tail`
                if indent == current:
                    pass

                elif indent.startswith(current):
                    increment = indent[len(current):]
                    symbols = [INDENT_S if char == ' ' else INDENT_T for char in increment]
                    tail = ''.join(symbols) + tail
                    current = indent

                elif current.startswith(indent):
                    decrement = current[len(indent):]
                    symbols = [DEDENT_S if char == ' ' else DEDENT_T for char in reversed(decrement)]
                    tail = ''.join(symbols) + tail
                    current = indent
                    
                else:
                    raise IndentationError(f'indentation on line {linenum} is incompatible with previous line')
                    
                lines.append(tail)
                
        assert current == '', f"'{current}'"
        
        output = '\n'.join(lines)
        # print("HyML_Grammar.preprocess() output:")
        # print(output)
        
        return output
        
        
HyML_Grammar.default = HyML_Grammar(special_chars = HyML_Grammar.CHARS_DEFAULT)

        
########################################################################################################################################################
#####
#####  NODES
#####

class NODES(object):
    "A lexical container for definitions of all HyML tree node classes."

    # modes of rendering & evaluation of subtrees
    MODE_STRICT = 1         # strict mode: requires that all variables in the subtree are defined (not MISSING), otherwise UndefinedValue exception is raised
    MODE_NORMAL = 2         # normal mode: None variables are

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
            
        def render(self, stack):
            """
            Node rendering. An equivalent of "expression evaluation" in programming languages.
            Every render() not only returns a string - a product of rendering - but also may have side effects:
            modification of the 'stack' if new variables/hypertags were defined during node rendering, at the node's top level.
            """
            if self.children:
                return u''.join(c.render(stack) for c in self.children)
            else:
                return self.text()

        def __str__(self): return "<%s>" % self.__class__.__name__  #object.__str__(self)


    class xdocument(node):
        
        def compactify(self, stack):
            # if DEBUG: print("compact", "DOC", stack)
            self.children = NODES._compactify_siblings_(self.children, stack)


    ###  BLOCKS & BODY  ###

    class block(node): pass
    class xblock_verbat(block): pass
    class xblock_normal(block): pass
    class xblock_markup(block): pass
        # TODO
    
    class xblock_tagged(block):
        tags = None         # non-empty chain of <tag_expand> nodes
        body = None         # <body_*> node
        
        def setup(self):
            # by grammar rules, all children should be of type 'tag_expand' except the last one which should be 'body_*'
            self.tags = self.children[:-1]
            self.body = self.children[-1]
            assert self.tags and all(tag.type == 'tag_expand' for tag in self.tags)
            assert self.body.type.startswith('body_')
            
        def render(self, stack, _re_space = re.compile(r'^\s*')):
            
            body = self.body.render(stack)
            stop = len(body.rstrip())               # position where actual body ends and trailing whitespace begins
            skip = body.count('\n', stop)           # no. of newlines to be inserted after the expanded block, >= 1
            body = body[:stop]
            assert skip >= 1
            
            if self.body.has_blocks():
                body += '\n'
                
            indent = stack.indentation
            output = _del_indent(body, indent)
            
            # expand the chain of tags that enclose `body`
            for tag in reversed(self.tags):
                output = tag.expand(output, stack)
                
            output = _add_indent(output, indent)
            return output + skip * '\n'

    class xblock_def(block): pass
    class xblock_for(block): pass
    class xblock_if (block): pass
    class xblock_assign(block): pass

    class body(node):
        def has_blocks(self):
            """Inline body (no blocks) is terminated with a newline <nl>, while blocks have dedent(s) at the end."""
            return self.children[-1].type != 'nl'

    class xbody_struct(body): pass
    class xbody_verbat(body): pass
    class xbody_normal(body): pass
    class xbody_markup(body): pass

    class line(node):
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
            markup = NODES.node.render(self, stack)         # call to super-method that renders embedded expressions, in addition to static text
            return markup

    
    ###  TAGS & HYPERTAGS  ###

    class xtag_expand(node):
        """Occurrence of a tag."""
        
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
            # NOTE #1: unnamed attrs can be *mixed* with named ones (unlike in python) -
            # during tag expansion all unnamed attrs are passed first to a tag, followed by all named (keyword-) ones
            # NOTE #2: same attr can appear more than once, in such case its string values are space-concatenated;
            # this is particularly useful for "class" attibute and its short form:  div .top.left.darkbg
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
            if self.tag is None: raise UndefinedTag(f"Undefined tag '{self.name}'", self)
            
        def expand(self, body, stack):
            
            # evaluate attributes to calculate actual values
            unnamed = [attr.evaluate(stack) for attr in self.unnamed]
            # named = {name: expr.evaluate(stack) for name, expr in self.named}      # here, OrderedDict is no longer needed, as order matters for evaluation only
            
            named = {}
            for name, expr in self.named:
                value = expr.evaluate(stack)
                if name in named:
                    named[name] = f'{named[name]} {value}'
                else:
                    named[name] = value
            
            if isinstance(self.tag, ExternalTag):
                return self.tag.expand(body, *unnamed, **named)
            else:
                raise NotATag(f"Name '{self.name}' is not a tag", self)
            
            
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
        

    ###  EXPRESSIONS  ###
    
    class expression(node):
        """Base class for all nodes that represent an expression, or its part (a subexpression)."""
        def evaluate(self, stack):
            raise NotImplementedError

    class expression_root(expression):
        """Base class for root nodes of all non-literal embedded expressions, either in markup or attribute/argument lists.
        """
        context = None      # copy of Context that has been passed to this node during analyse(); kept for re-use by render(),
                            # in case if the expression evaluates to yet another (dynamic) piece of HyML code
    
    class xexpr(expression_root): pass
    class xexpr_var(expression_root): pass
    class xexpr_augment(expression_root): pass
    
    class xfactor(expression): pass
    class xfactor_var(xfactor): pass


    ###  LITERALS  ###

    class literal(expression):
        isstatic = True
        ispure   = True
        value    = None
        def setup(self):            self.value = self.text()
        def analyse(self, ctx):     pass
        def evaluate(self, stack):  return self.value
    
    class xnumber(literal):
        def setup(self):
            self.value = asnumber(self.text())
    
    class xboolean(literal):
        def setup(self):
            self.value = (self.text() == 'True')

    class xstring(literal):
        def setup(self):
            self.value = self.text()[1:-1]              # remove surrounding quotes: '' or ""
    
    class xstr_unquoted(xstring): pass
    class xattr_short_lit(literal): pass
    class xnone(literal): pass


    
    ###  STATIC nodes  ###
    
    class static(node):
        "A node that represents static text and has self.value known already during parsing or analysis, before render() is called."
        isstatic = True
        ispure   = True
        value    = None
        
        def setup(self):
            self.value = self.text()
        def render(self, stack):
            return self.value
        def __str__(self):
            return self.value
        
    class xname_id(static): pass
    class xname_xml(static): pass
    class xtext(static): pass
    class xnl(static): pass

    class xescape(static):
        def setup(self):
            escape = self.text()
            assert len(escape) == 2 and escape[0] == escape[1]
            self.value = escape[0]                          # the duplicated char is dropped
    
    class xindent(static):
        whitechar = None
        def render(self, stack):
            stack.indent(self.whitechar)
            return ''

    class xdedent(static):
        whitechar = None
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
        ex = None           # if NullValue exception was caught during rendering, it's stored here as an (exception, traceback) pair
        
        def __init__(self, node, stack):
            self.tree = node.tree
            self.fulltext = node.fulltext
            self.pos = node.pos
            try:
                self.value = node.render(stack)
            except NullValue as ex:
                self.ex = (ex, sys.exc_info()[2])
                
        def merge(self, node, stack, sep):
            self.pos = (self.pos[0], node.pos[1])
            if self.ex: return                          # we already know that an exception will be raised upon self.render(), no need to append new nodes
            try:
                nodeValue = node.render(stack)
                self.value += sep + nodeValue
            except NullValue as ex:
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
#####  HYML_TREE
#####

class HyML_Tree(BaseTree):

    NODES = NODES                           # must tell the BaseTree's rewriting routine where node classes can be found
    _use_init = False

    ###  Configuration of rewriting process  ###
    
    # nodes that will be ignored during rewriting (pruned from the tree)
    _ignore_  = "ws space comma verbatim " \
                "mark_struct mark_verbat mark_normal mark_markup"
    
    # nodes that will be replaced with a list of their children
    _reduce_  = "target blocks_core blocks block block_control ws_body body " \
                "tags_expand attrs_val attr_named value_named value_unnamed value_of_attr kwarg " \
                "tail_verbat tail_normal tail2_verbat tail2_normal core_verbat core_normal " \
                "text_embedded embedded_braces embedded_eval " \
                "expr_root subexpr slice subscript trailer atom literal"
    
    # nodes that will be replaced with their child if there is exactly 1 child AFTER rewriting of all children;
    # they must have a corresponding x... node class, because pruning is done after rewriting, not before
    _compact_ = "factor factor_var pow_expr term arith_expr shift_expr and_expr xor_expr or_expr concat_expr " \
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
        
        self.parser = HyML_Grammar.get_parser(text)
        text = self.parser.preprocess(text)

        # parse input text to the 1st version of AST (self.ast) as returned by Parsimonious,
        # then rewrite it to custom NODES.* classes rooted at self.root
        super(HyML_Tree, self).__init__(text, stopAfter = stopAfter)
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
        
        # perform compactification; a part of it was already done during analysis, because every hypertag launches
        # compactification in its subtree on its own, during analysis; what's left is compactification
        # of the top-level document only
        if self.config['compact']: self.compactify()
        
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
    
    def render(self):
        return self.root.render(Stack())

    def __getitem__(self, tag_name):
        """Returns a top-level hypertag node wrapped up in Hypertag, for isolated rendering. Analysis must have been performed first."""
        return self.hypertags[tag_name]
        

#####################################################################################################################################################
#####
#####  HYML_PARSER
#####

class HyML:
    """
    HyML Parser.
    """
    def __init__(self, **config):
        self.config = config
        
    def parse(self, source):
        
        tree = HyML_Tree(source, **self.config)
        return tree.render()
    

########################################################################################################################################################
#####
#####  MAIN
#####

if __name__ == '__main__':
    
    DEBUG = True
    
    text = """
        h1 >a href="http://xxx.com"|This is <h1> title
            p  / And <a> paragraph.
        div
            | Ala
              kot.
            / i pies
        
        div#box.top.grey
        input enabled=True
        """
    
    tree = HyML_Tree(text, stopAfter = "rewrite")
    print()
    print("===== AST =====")
    print(tree.ast)
    print(type(tree.ast))
    print()
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
    