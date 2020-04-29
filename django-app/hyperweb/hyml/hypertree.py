"""
HyperTree Markup Language (HyML variant B).
An indentation-based document description & templating language with modularity through inline function defitions.

***Names (?):  HyML, PyML, Sleek,

Key features:
 1. Tree structure. Document is written as a hierarchy of nested nodes, with INDENTATION indicating nesting level, like in Python.
    Typically, nodes correspond to HTML/XML elements, that is, to pairs of start-end tags, but without the need
    to explicitly write end tags, which substantially simplifies coding, improves readability of code
    and makes introducing changes easier.
 2. Modularity. Selected nodes in the document tree may introduce new TYPES of nodes ("hypernodes")
    which can be re-used (expanded) later on inside the document, possibly multiple times, without code duplication.
    New types of nodes can be parameterized, like functions in Python.
 3. Templates. Document can contain references to VARIABLES defined either outside (global context),
    or inside the document (local variables).
 4. VARIANTS.

Every HyML document can be rendered into plain HTML document.

HyperTree Markup Language was inspired by indentation-based templating languages:
HAML, HamlPy, SHPAML (http://shpaml.com/), Slim, Plim.

SYNTAX

Types of body contents:
 !  verbatim:  raw text without expressions; passed untouched to output, no escaping
 |  normal:    normal text (without markup) with {...} and $... expressions; {{...}} expressions not allowed; is escaped into target markup during rendering
 /  markup:    markup text with embedded expressions; is NOT escaped during rendering;
               values of {...} and $... expressions within markup undergo escaping before they get embedded;
               values of {{...}} expressions get embedded without escaping
 $  expr:      like embedded expression $..., but may contain whitespace after $ sign and within expression
 
 
| text node ...
  ....
| text with expression block { var.field.call(attr) + 5 } and expression value $var.data['attr']
/ target <a>markup</a> with entities &amp; will not undergo encoding

NODE attrs... | text inlined
NODE attrs... |
  text block
NODE attrs...
  | text block
    ...
  OTHER-NODE
  | text block
NODE attrs :
  text node

NODE /   -- creates a void tag <.../> (body is None, not empty '')
%NAME    -- definition of a new node type
var X    -- local variable

{...} and $...  -- plain-text expression; will undergo encoding during its evaluation (if inside markup block) or during rendering of the entire body
{{...}}         -- markup expression

# In control statements, below, colons can be replaced with |, and/or dropped entirely

if expr:
  BODY
elif expr:
  BODY
else:
  BODY

either
  BODY1 ...
or
  BODY2 ...

for name in $expr:
  BODY
  
"pass" node: for internal use, to enclose body of a control statement, where head (with tag) is missing.

-- comment line


"""

"""
/
|
!
"""

grammar = r"""

###
###  Before the grammar is applied, indentation in the input text must be translated into
###  "indent" and "dedent" special characters: INDENT_S/DEDENT_S for spaces, INDENT_T/DEDENT_T for tabs.
###  These characters must be unique and don't occur anywhere else in input text,
###  except for places where they get inserted during translation.
###

###  DOCUMENT

document         =  body_blocks
body_blocks      =  vs (body_ind / block (nl block)*) vs
body_ind         =  indent_s body_blocks dedent_s / indent_t body_blocks dedent_t
block            =  block_normal / block_markup / block_verbatim / block_control / block_comment / block_def / block_tag

###  BODY

# Types of grammatic structures:
#  [open-r]  block  = head + body, terminated with <nl>; indentation-agnostic (start and end positioned at the same indentation level)
#  [closed]  head   = specification of type and parameters of a block
#  [closed]  body   = contents of a node, as "short tail" (inline text next to header), "long tail" (below header), and/or sequence of blocks
#  [closed]  blocks = sequence of blocks of any type
#  [closed]  tail   = 1-space indentation with a core inside
#  [closed]  tail2  = 2-space indentation with a core inside
#  [open-r]  core   = sequence of lines
#  [ open ]  line   = part of body contents that fits on a single line, either at the end of a header line, or within a block
#
#  Closed structure:  no whitespace allowed at the edges (1st & last characters are non-whitespace); non-empty (min. 1 character)
#  Open structure:    whitespace allowed at one or both of the edges; can be empty ''
#
# Styles of body layout:
# - short tail (inline)
# - long tail (below header, but without block header)
# - blocks
# - empty
# - short + long tail
# - short + blocks
# (long tail and blocks are mutually exclusive)

body             =  body_inline? (nl body_ind)?
body_inline      =  sign_normal ' '? (line_normal nl tail_normal?)? / sign_markup ' '? line_markup? / sign_verbatim ' '? line_verbatim?

body             =  (body_normal / body_markup / body_verbat)

body_normal      =  sign_normal ' '? line_normal? (nl tail_normal / blocks)?
body_markup      =  sign_markup ' '? line_markup? (nl tail_markup / blocks)?
body_verbat      =  sign_verbat ' '? line_verbat? (nl tail_verbat / blocks)?

blocks           =  indent_s block+ dedent_s / indent_t block+ dedent_t

line_normal      =  (embedded_text / text)+                             # line of plain text with {...} or $... expressions; no markup; escaped during rendering
line_markup      =  (embedded_markup / embedded_text / text)+
line_verbat      =  text ''

block_normal     =  sign_normal (' ' line_normal (nl tail2_normal)? / line_normal (nl tail_normal)?)
tail_normal      =  indent_s core_normal dedent_s
tail2_normal     =  indent_s indent_s core_normal dedent_s dedent_s         # like tail_normal, but with 2-space indentation

core_normal      =  ((tail_normal / line_normal) nl)*

sign_normal      =  '|'
sign_markup      =  '/'
sign_verbat      =  '!'

###  BLOCKS

verbatim         =  (texts / verbatim_ind)*
verbatim_ind     =  indent_s verbatim dedent_s / indent_t verbatim dedent_t

block_def        =  def head_tag ws tail_tag

block_tag        =  head_tag ws tail_tag
head_tag         =  tag (ws '>' ws tag)*
tail_tag         =  ':' nl verbatim / text_line? (nl body_ind)?
tag              =  tag_name attrs?

###  BASIC TOKENS

# markup      = text ''
# markups     = texts ''

text        =  ~"[^%(INDENT_S)s%(DEDENT_S)s%(INDENT_T)s%(DEDENT_T)s\n]*"s     # single line of plain text
texts       =  ~"[^%(INDENT_S)s%(DEDENT_S)s%(INDENT_T)s%(DEDENT_T)s]*"s       # lines of plain text, all at the same (baseline) indentation level

indent_s    = "%(INDENT_S)s"
dedent_s    = "%(DEDENT_S)s"
indent_t    = "%(INDENT_T)s"
dedent_t    = "%(DEDENT_T)s"

nl          =  ~"([ \t]*\n)+"                # obligatory vertical space = 1+ newlines, possibly with a leading horizontal space and/or empty lines in between
vs          =  ~"([ \t]*\n)*"                # optional vertical space = 0+ newlines

space       =  ~"[ \t]+"                     # obligatory whitespace, no newlines
ws          =  ~"[ \t]*"                     # optional whitespace, no newlines


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

str1         =  ~"'[^']*'"                   # 'string', may contain entities: &apos; &quot; &amp; (others left undecoded!)
str2         =  ~'"[^"]*"'                   # "string", may contain entities: &apos; &quot; &amp; (others left undecoded!)
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

kwattr      =  ident (ws '=' ws value_attr_named)?      # HTML syntax: name OR name="value" OR name=value ... HyML syntax: name=$(...)
attr        =  value_attr_unnamed / kwattr              # 2nd and 3rd options are for unnamed attributes (HyML syntax)
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
