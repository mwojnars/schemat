"""
Grammar for a Parsimonious parser. See: https://github.com/erikrose/parsimonious

WARNING:
Parsimonious has a BUG that needs to be worked around in several places in grammar definition.
Namely, Pasimonious silently reduces (removes) non-terminals from AST which are equal (by definition)
to some nother non-terminal, like in expressions:   T = S

"""

from parsimonious.grammar import Grammar


########################################################################################################################################################
###
###  GRAMMAR
###

# Grammar for a Parsimonious parser. Actually a template that needs to be formatted with a few additional parameters (see below).

grammar_spec = r"""

# Tagged text is a flat sequence of markup (tags, variables/functions, variants) mixed with plain text.
# Full markup elements (open+close tag) and their nesting structure is reconstructed during semantic analysis,
# because proper (and error-resistant) pairing of start tags with their corresponding end tags can only be done at semantic level.

document    =  (markup / text)*

markup      =  noparse / noparse_hyml / comment / tag / variant / escape / value_in_markup
text        =  ~".[^<$[{]*"s                  # plain text is a 1+ sequence of any chars till the next special symbol '<$[{'. Can begin with a special symbol if no other rule can be matched

###  BASIC TOKENS

space       =  ~"\s+"                        # obligatory whitespace; can include newline
ws          =  space?                        # optional whitespace; can include newline

def         =  ':'                           # tag name prefix that starts hypertag definition
eval        =  '$'                           # special symbol denoting expression evaluation
lt          =  '<'                           # special symbols for tags ...
gt          =  '>'
slash       =  '/'
void        =  '~'                           # void marker in hypertag's opening tag, either ~ (tilde) or . (dot):  <:htag ~ ...>
lbrace      =  '{{'
rbrace      =  '}}'

ident       =  ~"[%s][%s]*"                      # [XML_StartChar][XML_Char]* -- names of tags and attributes as used in XML, defined very liberally, with nearly all characters allowed, to match all valid HTML/XML identifiers, but not all of them can be used as hypertag/variable names
var_id      =  !reserved ~"[a-z_][a-z0-9_]*"i    # names of variables/hypertags/attributes that can appear in expressions; a much more restricted set of names than 'ident', to enable proper parsing of operators and mapping of the names to external execution environment
reserved    =  ~"(if|else|is|in|not|and|or|__body__)\\b"    # names with special meaning inside expressions, can't be used for variables; \\b is a regex word boundary and is written with double backslash bcs single backslash-b is converted to a backspace by Python


###  EXPRESSIONS

# atoms: string, number, variable, sub-expression ...

str1         =  ~'"[^"]*"'                   # "string", may contain entities: &apos; &quot; &amp; (others left undecoded!)
str2         =  ~"'[^']*'"                   # 'string', may contain entities: &apos; &quot; &amp; (others left undecoded!)
str_unquoted =  !'$' ~"[^\s\"'`=<>]+"        # in attributes only, for HTML compatibility; see https://html.spec.whatwg.org/multipage/syntax.html#syntax-attributes
#string      =  regex.escaped_string

number       =  ~"((\.\d+)|(\d+(\.\d*)?))([eE][+-]?\d+)?"      # like nifty.text.regex.float regex pattern, only without leading +-
literal      =  number / str1 / str2

var          =  eval? (var_id / body_var)    # occurence (use) of a variable, which can be a body attribute .VAR (body_var)
subexpr      =  '(' ws expr ws ')'

# tail operators: negation, function call, collection indexing, member access ...

slice_value  =  ws (expr ws)?                # empty value '' serves as a placeholder, so that we know which part of *:*:* we're at
slice        =  slice_value ':' slice_value (':' slice_value)?
subscript    =  slice / (ws expr ws)

call         =  '(' ws (args ws)? ')'        # no leading space allowed before () [] . -- unlike in Python
index        =  '[' subscript ']'            # handles atomic indices [i] and all types of [*:*:*] slices
member       =  '.' var_id                   # no space after '.' allowed
trailer      =  call / index / member

# the expression...
# built bottom-up, starting with inner-most components built of high-priority operators (arithmetic)
# and proceeding outwards, to operators of lower and lower priority (logical);
# after parsing, the expression nodes with only 1 child are reduced (compactified),
# to avoid long (~10 nodes) branches in the syntax tree that don't perform any operations
# other than blindly propagating method calls down to the leaf node.

op_multiplic =  '*' / '//' / '/' / '%%'        # double percent means single percent, only we need to escape for grammar string formatting
op_additive  =  '+' / '-'
op_shift     =  '<<' / '>>'
neg          =  '-'                            # multiple negation, e.g., "---x", not allowed -- unlike in Python

atom         =  literal / var / subexpr
factor       =  atom trailer*                                 # operators: () [] .
term         =  factor (ws op_multiplic ws factor)*           # operators: * / // percent
arith_expr   =  neg? ws term (ws op_additive ws term)*        # operators: neg + -
concat_expr  =  arith_expr (space arith_expr)*                # string concatenation: space-delimited list of items
shift_expr   =  concat_expr (ws op_shift ws arith_expr)*
and_expr     =  shift_expr (ws '&' ws shift_expr)*
xor_expr     =  and_expr (ws '^' ws and_expr)*
or_expr      =  xor_expr (ws '|' ws xor_expr)*

op_comp      =  ~"==|!=|>=|<=|<|>|not\s+in|is\s+not|in|is"
not          =  'not'

comparison   =  or_expr (ws op_comp ws or_expr)*
not_test     =  (not space)* comparison                       # spaces are obligatory around: not, and, or, if, else,
and_test     =  not_test (space 'and' space not_test)*        # even if subexpressions are enclosed in (...) - unlike in Python
or_test      =  and_test (space 'or' space and_test)*
ifelse_test  =  or_test (space 'if' space or_test (space 'else' space ifelse_test)?)?

expr         =  ifelse_test

# the use of an expression within markup ...

expr_markup  =  (var / subexpr) trailer*
value1       =  eval expr_markup                              # $x, $x.y[z], $f(x), $(...), $(...).x[y](z)
value2       =  lbrace ws expr ws rbrace                      # {{ expression }}
value        =  value1 / value2

escape       =  eval ('$' / '<' / '>' / '[[' / '||' / ']]' / '[#' / '#]' / '[=' / '=]' / '{{' / '}}')


###  LISTS OF ARGUMENTS (in function calls) & ATTRIBUTES (in tags)

# arguments inside a function call: comma-separated, expressions in abstract form (no $), only regular names, names must have values assigned

kwarg       =  var_id ws '=' ws expr
arg         =  kwarg / expr
args        =  arg (ws ',' ws arg)*


# Here, like in HTML, tags can have attributes without values, equiv. to attr=""; on the other hand, strings must always be quoted (other types not).
# Additionally, unlike in HTML, values (unnamed) are allowed as arguments instead of attributes (named) - like in typical programming.

# attributes inside a tag: space-separated, embedded expressions ($...), any XML-compatible names, names can go without values

value_attr_common  =  literal / value
value_attr_named   =  value_attr_common / str_unquoted
value_attr_unnamed =  value_attr_common ''              # trailing '' to work around Parsimonious bug of reducing non-terminals equal to another non-terminal
value_in_markup    =  value ''                          # trailing '' to work around Parsimonious bug of reducing non-terminals equal to another non-terminal

kwattr      =  ident (ws '=' ws value_attr_named)?      # HTML syntax: name OR name="value" OR name=value ... HyperML syntax: name=$(...)
attr        =  value_attr_unnamed / kwattr              # 2nd and 3rd options are for unnamed attributes (HyperML syntax)
attrs       =  (space attr)+

body_attr   =  '.' var_id?
body_var    =  '.' var_id?

###  TAGS & ELEMENTS

tag_name_end   =  (def var_id) / ident
tag_name_start =  (var_id def) / tag_name_end

tag_name     =  (def var_id) / (var_id def) / ident
tag_core     =  attrs? (space body_attr)? ws
tag_namecore =  lt tag_name_start (ws void)? tag_core

start_tag    =  tag_namecore gt                       # opening (start) tag, regular or hypertag definition
empty_tag    =  tag_namecore slash gt                 # empty tag: no body, opening + closing in a single tag
end_tag      =  lt slash tag_name_end ws gt           # closing (end) tag, regular or hypertag definition
tag          =  start_tag / empty_tag / end_tag

# elements whose body should stay unparsed

#html_comment =  ~"<!--((?!-->).)*-->"s                # <!-- .. -->, with no '-->' inside
#noparse      =  html_comment / ...
noparse      =  %s                                    # list of alternatives (see noparse_joint in HyperParser), followed by all noparse_rules below
%s                                                    # noparse_rules will be included here

noparse_hyml =  ~"\[=((?!=\]).)*=\]"s                 # [= .. =] string with no '=]' inside; can't be nested
comment      =  ~"\[#((?!#\]).)*#\]"s                 # [# .. #] string with no '#]' inside; can't be nested


###  VARIANT ELEMENTS

# plain text inside variant elements: a 1+ sequence of any chars until the 1st '||', ']]' or a special symbol '<$['.
# Can begin with a special symbol if no other rule can be matched
# regex: 1 char that doesn't start || nor ]], followed by 0+ non-special chars that don't start || nor ]]
text_variant =  ~"(?!\|\|)(?!\]\]).((?!\|\|)(?!\]\])[^<$[])*"s

choice       =  (markup / text_variant)*
variant      =  '[[' choice ('||' choice)* ']]'

"""

########################################################################################################################################################
###
###  Regex patterns for character sets allowed in XML identifiers, to be put inside [...] in a regex.
###  XML identifiers differ substantially from typical name patterns in other computer languages. Main differences:
###   1) national Unicode characters are allowed, specified by ranges of unicode point values
###   2) special characters are allowed:  ':' (colon) '.' (dot) '-' (minus)
###      Colon is allowed as the 1st character according to XML syntax spec., although such a name may be treated as malformed during semantic analysis.
###      Others (dot, minus), are allowed on further positions in the string, after the 1st character.
###  Specification: http://www.w3.org/TR/REC-xml/#NT-NameStartChar
###

# human-readable:  [:_A-Za-z] | [\u00C0-\u00D6] | [\u00D8-\u00F6] | [\u00F8-\u02FF] | [\u0370-\u037D] | [\u037F-\u1FFF] | [\u200C-\u200D] | [\u2070-\u218F] | [\u2C00-\u2FEF] | [\u3001-\uD7FF] | [\uF900-\uFDCF] | [\uFDF0-\uFFFD] | [\U00010000-\U000EFFFF]
XML_StartChar  =  u":_A-Za-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD\U00010000-\U000EFFFF"

# human-readable:  XML_StartChar | [0-9.\u00B7-] | [\u0300-\u036F] | [\u203F-\u2040]
XML_Char       =  XML_StartChar + u"0-9\.\-\u00B7\u0300-\u036F\u203F-\u2040"

# Template of the no-parse rules to be injected into the grammar:
#                noparse_script =  ~"<script"i tag_core ~">((?!</script\s*>).)*</script\s*>"i
noparse_rule = r'noparse_%s     =  ~"<%s"i tag_core ~">((?!</%s\s*>).)*</%s\s*>"is'


########################################################################################################################################################
###
###  PARSER
###

class HyperParser(Grammar):
    """Parser of HyperML grammar. Produces the 1st version of AST composed of Parsimonious node classes,
    which undergo further rewriting to our custom NODES.x*** classes as the last stage of parsing,
    and then are passed to semantic analysis in HyperML class.
    """
    
    # The default list of markup elements that contain injected non-markup code and so their body should stay unparsed and rendered as-is.
    # Hypertags, expressions, variant blocks and HyperML comments are NOT resolved inside these elements. Names are treated case-insensitive.
    noparse = ["script", "style"]
    noparse_names = ['noparse_%s' % tag for tag in noparse]
    
    def __init__(self):
        noparse_rules = '\n'.join(noparse_rule % ((tag,) * 4) for tag in self.noparse)
        noparse_joint = ' / '.join(self.noparse_names)
        
        grammar = grammar_spec % (XML_StartChar, XML_Char, noparse_joint, noparse_rules)
        #print grammar
        super(HyperParser, self).__init__(grammar)


