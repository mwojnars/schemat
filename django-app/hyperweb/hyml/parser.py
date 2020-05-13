from parsimonious.grammar import Grammar as Parsimonious

from nifty.util import asnumber, ObjDict
from nifty.parsing.parsing import ParsimoniousTree as BaseTree, ParserError

from hyperweb.hyml.grammar import XML_StartChar, XML_Char, hyml_grammar


########################################################################################################################################################
###
###  UTILITIES
###

class HyMLError(ParserError):
    def make_msg(self, msg):
        if self.pos and self.node and self.node.tree.filename:
            return msg + " in '%s', line %s, column %s (%s)" % (self.node.tree.filename, self.line, self.column, self.text)
        if self.pos:
            return msg + " at line %s, column %s (%s)" % (self.line, self.column, self.text)

class UndefinedVariable(HyMLError):
    pass

class NullValue(HyMLError):
    """
    Null value was encountered during rendering of a node or evaluation of an expression.
    This exception is used to communicate null (None) values back to higher-level nodes during rendering
    and can be caught by xvariant node to choose the right variant from among multiple choices.
    Or, if raised by an expression, it can substitute TypeError for communicating a disallowed use
    of None value as an operand - in such, the exception can be passed all the way up to the client.
    """
    def __init__(self, msg = "Null value encountered during rendering of a node"):
        Exception.__init__(self, msg)
    

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
        - empty lines passed unmodified
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
        total = len(text.splitlines())
        text += '\n\n'          # a clear line (zero chars) is appended to ensure equal no. of DEDENT as INDENT
        
        for line in text.splitlines():
            linenum += 1
            tail = line.lstrip()
            indent = line[: len(line) - len(tail)]
            
            if not tail and linenum <= total:        # empty line, append without changes
                lines.append(line)
                
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
        print("HyML_Grammar.preprocess() output:")
        print(output)
        
        return output
        
        
HyML_Grammar.default = HyML_Grammar(special_chars = HyML_Grammar.CHARS_DEFAULT)

        
########################################################################################################################################################
###
###  NODES
###

class NODES(object):
    "A lexical container for definitions of all HyML tree node classes."

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
        
        # RAISE, MESSAGE, ORIGINAL = 1, 2, 3          # 'ifnull' special values, see _checkNull() for details
        
        def check_pure(self):
            """Calculate, set and return self.ispure on the basis of check_pure() of children nodes;
            or return self.ispure if it's already set.
            """
            if self.ispure is not None: return self.ispure
            npure = sum(n.check_pure() for n in self.children)      # sum up the no. of True values among children
            self.ispure = (npure == len(self.children))             # is pure only when all children have pure=True
            return self.ispure
        
        def compactify(self, stack, ifnull):
            """Replace pure nodes in the subtree rooted at 'self' with static string/value nodes containg pre-computed render() result
            of a given node, so that this pre-computed string/value is returned on all future render() calls on the new node.
            Compactification is a kind of pre-rendering: whatever can be rendered in the tree before runtime variable values are known,
            is rendered and stored in the tree as static values.
            'stack' is needed for render() calls because the subtree may need to push some local variables internally.
            """
            # push compactification down the tree
            for c in self.children: c.compactify(stack, ifnull)
            
        def compactify_self(self, stack, ifnull):
            "If 'self' is pure and not static, compactify it, otherwise try to compactify children. Return the new node or self."
            if self.isstatic: return self
            if self.check_pure(): return NODES.merged(self, stack, ifnull)
            self.compactify(stack, ifnull)
            return self
            
        def analyse(self, ctx):
            "'ctx' is a dict of name->node mapping."
            self.depth = ctx.depth
            for c in self.children: c.analyse(ctx)
            
        def render(self, stack, ifnull = ''):
            """
            Node rendering. An equivalent of "expression evaluation" in programming languages.
            Every render() not only returns a string - a product of rendering - but also may have side effects:
            modification of the 'stack' if new variables/hypertags were defined during node rendering, at the node's top level.
            'ifnull': what to do if a missing (null) element/value is encountered during rendering of this node
            (see _checkNull() for details).
            """
            return self.text()

        # def _checkNull(self, value, ifnull):
        #     """For use in subclasses in places where null values should be detected and either
        #     raised as an exception (ifnull = node.RAISE) or converted to another value (the value of 'ifnull', typically '').
        #     Other special values of 'ifnull', not used currently:
        #      - node.MESSAGE: replace the null value with an inline (in the document) error message, using the template configured in HyML settings
        #      - node.ORIGINAL: keep the original text of the expression, maybe it will undergo another pass of HyML parsing (e.g., on the client side)
        #                    and then the missing values will be filled out?
        #     """
        #     if value is not None: return value
        #     if ifnull == self.RAISE: raise NullValue()
        #     return ifnull
        #
        # def _convertIfNull(self, ifnull):
        #     """Convert 'ifnull' value from markup element representation (''/RAISE) to expression representation (''/None).
        #     Instead of raising an exception when None is encountered, expressions propagate None up the expression tree.
        #     """
        #     return None if ifnull is self.RAISE else ifnull

        def __str__(self): return "<%s>" % self.__class__.__name__  #object.__str__(self)


    class xdocument(node):
        
        def compactify(self, stack, ifnull):
            # if DEBUG: print("compact", "DOC", stack)
            self.children = NODES._compactify_siblings_(self.children, stack, ifnull)
            
        def render(self, stack, ifnull = ''):
            return u''.join(c.render(stack, ifnull) for c in self.children)


    ###  BLOCKS & BODY  ###

    class block(node): pass
    class xblock_verbat(block): pass
    class xblock_normal(block): pass
    class xblock_markup(block): pass
        # TODO
    
    class xblock_tagged(block): pass
    class xblock_def(block): pass
    class xblock_for(block): pass
    class xblock_if (block): pass
    class xblock_assign(block): pass

    class xtag_expand(node):
        """Occurrence of a tag."""

    class body(node): pass
    class xbody_struct(body): pass
    class xbody_verbat(body): pass
    class xbody_normal(body): pass
    class xbody_markup(body): pass
    
    # all intermediate non-terminals within "body" get reduced (flattened), down to these elements of a line:
    #    verbatim, text, text_embedded
    # also, the blocks that comprise a body get preserved; they always strictly follow the above atomic elements
    
    
    ###  ATTRIBUTES & ARGUMENTS  ###
    
    class xattrs_val(node):
        """List of attributes inside a tag occurrence (NOT in a definition)."""
    class xattrs_def(node):
        """List of attributes inside a tag definition (NOT in an occurrence)."""

    class xattr_val(node):
        """Attribute inside a tag occurrence OR tag definition:
            named / unnamed / short (only in tag occurence) / body (only in tag definition.
        """

    ###  EXPRESSIONS  ###
    
    class expression(node):
        """Base class for all nodes that represent an expression, or its part (a subexpression)."""
    
    class expression_root(expression):
        """Base class for root nodes of all embedded expressions, either in markup or attribute/argument lists.
        """
        context = None      # copy of Context that has been passed to this node during analyse(); kept for re-use by render(),
                            # in case if the expression evaluates to yet another (dynamic) piece of HyML code
    
    class xexpr(expression_root): pass
    class xexpr_var(expression_root): pass
    class xexpr_augment(expression_root): pass
    
    class xfactor(expression): pass
    class xfactor_var(xfactor): pass


    ###  EXPRESSIONS - LITERAL  ###

    class literal(expression):
        isstatic = True
        ispure   = True
        value    = None
        def analyse(self, ctx): pass
        def evaluate(self, stack, ifnull):
            return self.value
        
    class xnumber(literal):
        def init(self, tree, _):
            self.value = asnumber(self.text())
    
    class xstring(literal):
        def init(self, tree, _):
            self.value = self.text()[1:-1]              # remove surrounding quotes: '' or ""
    
    class xstr_unquoted(xstring):
        def init(self, tree, _):
            self.value = self.text()
    
    
    ###  STATIC nodes  ###
    
    class static(node):
        "A node that represents static text and has self.value known already during parsing or analysis, before render() is called."
        isstatic = True
        ispure   = True
        value    = None
        
        def init(self, tree, astnode):
            self.value = self.text()
        def render(self, stack, ifnull = ''):
            return self._checkNull(self.value, ifnull)
        def __str__(self):
            return self.value
        
    class xname_id(static): pass
    class xname_xml(static): pass
    class xtext(static): pass
    
    class xescape(static):
        def init(self, tree, astnode):
            escape = self.text()
            assert len(escape) == 2 and escape[0] == escape[1]
            self.value = escape[0]                          # the duplicated char is dropped
    
    class xindent_s(static): pass
    class xindent_t(static): pass
    class xdedent_s(static): pass
    class xdedent_t(static): pass


#####################################################################################################################################################
#####
#####  HYML_TREE
#####

class HyML_Tree(BaseTree):

    NODES   = NODES             # must tell the BaseTree's rewriting routine where node classes can be found

    ### Configuration of rewriting process (fixed)
    
    # nodes that will be ignored during rewriting (pruned from the tree)
    _ignore_  = "ws space comma nl vs " \
                "mark_struct mark_verbat mark_normal mark_markup"
    
    # nodes that will be replaced with a list of their children
    _reduce_  = "target blocks_core blocks block block_control body " \
                "tags_expand attr_named value_named value_unnamed kwarg " \
                "tail_verbat tail_normal tail2_verbat tail2_normal core_verbat core_normal line_verbat line_normal " \
                "text_embedded embedded_braces embedded_eval " \
                "expr_root subexpr slice subscript trailer atom literal"
    
    # nodes that will be replaced with their child if there is exactly 1 child AFTER rewriting of all children;
    # they must have a corresponding x... node class, because pruning is done after rewriting, not before
    _compact_ = "factor factor_var pow_expr term arith_expr shift_expr and_expr xor_expr or_expr concat_expr " \
                "comparison not_test and_test or_test ifelse_test expr_tuple"

    _reduce_anonym_ = True      # reduce all anonymous nodes, i.e., nodes generated by unnamed expressions, typically groupings (...)
    _reduce_string_ = True      # if a node to be reduced has no children but matched a non-empty part of the text, it shall be replaced with a 'string' node
    

    # instance-level attributes that hold partial results of parsing
    text    = None              # full text of the input string fed to the parser
    ast     = None              # raw AST generated by the parser; for read access
    root    = None              # root node of the final tree after rewriting
    
    
    def __init__(self, text, stopAfter = None):
        """
        :param text: input document to be parsed
        :param stopAfter: either None (full parsing), or "parse", "rewrite"
        """
        
        self.parser = HyML_Grammar.get_parser(text)
        text = self.parser.preprocess(text)

        # parse input text to the 1st version of AST (self.ast) as returned by Parsimonious,
        # then rewrite it to custom NODES.* classes rooted at self.root
        super(HyML_Tree, self).__init__(text, stopAfter = stopAfter)
        if self.root is None:                                   # workaround for Parsimonious bug in the special case when text="" (Parsimonious returns None instead of a tree root)
            self.root = NODES.xdocument(self, ObjDict(start=0, end=0, children=[], expr_name='document'))
        assert isinstance(self.root, NODES.xdocument)
        if stopAfter == "rewrite": return


#####################################################################################################################################################
#####
#####  HYML_PARSER
#####

class HyML_Parser:
    """
    """
    
########################################################################################################################################################
###
###  MAIN
###

if __name__ == '__main__':
    
    text = """
        h1 >a href="http://xxx.com"|This is <h1> title
            p  / And a paragraph.
        div
            | Ala
            |kot.
            / i pies
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
    