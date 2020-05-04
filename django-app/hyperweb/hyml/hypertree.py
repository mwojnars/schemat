"""
Hypertags Markup Language (HyML Essential).
An indentation-based document description & templating language with modularity through inline function defitions.

***Names (?):  HyML, PyML, Sleek, HypeML
- tree of tags (TRoT, ToT, Treet) markup lang (TreML, TreeML, BranchML), HyTree

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

The Essential variant of HyML was inspired by indentation-based templating languages:
HAML, HamlPy, SHPAML (http://shpaml.com/), Slim, Plim.

Philosophy:
- Silent errors via fallback to default. Reasons:
    1. it is difficult to handle an error during markup rendering (shallow callers' stack where exception could be
       handled properly);
    2. output markup is designed for human visual consumption, so rendering errors are quickly visible,
       no need for advanced handling and reporting.
- Explicit is better than implicit (ref: python). For example, alternate() function (implemented as hidden variable
  in some other templating languages - django?).

SYNTAX

Types of body contents:
 !  verbatim:  raw text without expressions; passed untouched to output, no escaping
 |  normal:    normal text (without markup) with {...} and $... expressions; {{...}} expressions not allowed; is escaped into target markup during rendering
 /  markup:    markup text with embedded expressions; is NOT escaped during rendering;
               values of {...} and $... expressions within markup undergo escaping before they get embedded;
               values of {{...}} expressions get embedded without escaping
 $  eval:      like embedded expression $..., but may contain whitespace after $ sign (and within expression without collisions)
 :  tree       tags that create nodes; this can be used after control statements
 
Types of values:
 - node value:       any subtree in a document tree rooted in a particular node; requires rendering during document generation
   - named node:     hypertag or @... attribute of a hypertag; can be reused multiple times across the tree
   - unnamed node:   any "tag" block; is rendered exactly once in the place of its occurrence
 - text value:       any text contents (plain / verbatim / markup) of a node that occurs after |!/
 - simple value:     any Python value calculated inside {...} or $... expression; or value of a simple attribute (non-@)
 
Types of special "empty" values:
 - `null`:     simple value; may occur in expressions; rendered into empty string ''
   `undefined`  ??? name used in JS for undefined html attrs
 - `void`:     a node that doesn't output any contents; has no body content and no children nodes
 - `pass`:     a node that has no body contents by itself, but may have non-void children nodes

 
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

% NAME    -- definition of a new tag (node type, hypertag)
% hypertag attr1 attr2=default @header @body @footer > subtag > subtag ....
  tag1
  body                    -- node `body` (delayed rendering)
  footer x=10             -- node `footer` with appended value of `x` attr (overrides default value and/or any value assigned before `footer` was passed to hypertag)
  htag @sidebox=footer(x=10)   -- passing a hypertag `footer` as a value of another hypertag's attribute
  tag2
  / {{ body tag(...) }}
  % subtree | ...       -- local structural variable, for use as a node or inside markup {{...}} expressions

hypertag(attr1).subtree(attr2)    -- nested hypertags can be accessed from outside, even if they reference
                                     local vars or attrs from outer scope (?) ... hypertag is an equivalent
                                     of a function AND a class, at the same time (?)
                                     This is useful for grouping related sub-templates (sub-documents, sub-trees, sub-hypertags).

x = $expr       -- local variable for use in plain-text {...} expressions (also in control statements)

{...} and $...  -- plain-text expression; will undergo encoding during its evaluation (if inside markup block) or during rendering of the entire body
{{...}}         -- markup expression

# In control statements, colon ':' indicates the start of structural mode

if expr: tag1 > tag2
  BODY
elif expr:
  BODY
else:
  BODY

select nonempty      -- pick the 1st branch that yields a non-empty result (not null and not ''); pass if no such branch exists
- BODY1 ...
- BODY2 ...

select defined       -- pick the 1st branch whose ALL variables occuring inside expressions are defined (not-null)
- BODY1 ...
- BODY2 ...

select [strict=True] -- pick the 1st branch that yields a non-empty result AND all variables inside are defined;
- BODY1 ...             if strict=False, the LAST branch is selected if all branches fail; othwerwise <void> is returned
- BODY2 ...

for name in $expr:
  BODY
  
"pass" node: for internal use, to enclose body of a control statement where head (with tag) is missing.

-- comment line

[NAME:zone_class]           -- declaration of a "zone" for non-linear insertion of content (a la "goto")
[zone] << tag ...           -- non-linear insertion of content to a given "zone"; a given passage is
                               passed to Zone.add() method, which by default appends rendered passage to zone,
                               but only once (removal of duplicates); alternative operands:  <| </ <! <$
                               <$ passes to zone an original python object as returned by expression (NO rendering!)

"""
grammar = r"""

###
###  Before the grammar is applied, indentation in the input text must be translated into
###  "indent" and "dedent" special characters: INDENT_S/DEDENT_S for spaces, INDENT_T/DEDENT_T for tabs.
###  These characters must be unique and don't occur anywhere else in input text,
###  except for places where they get inserted during translation.
###

# Types of grammatic structures:
#  [ open ]  document
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
#  Open structure:    whitespace allowed at one (L/R) or both of the edges; can be empty ''
#
# Styles of body layout:
# - short tail (inline)
# - long tail (below header, but without the leading block symbol)
# - blocks
# - empty
# - short + blocks
# (long tail and blocks are mutually exclusive)

###  DOCUMENT

document         =  vs blocks_core?

blocks_core      =  blocks / block+
blocks           =  indent_s blocks_core dedent_s / indent_t blocks_core dedent_t
block            =  block_normal / block_markup / block_verbatim / block_control / block_comment / block_def / block_tags

###  BODY

body             =  ':'? nl blocks? / body_normal / body_markup / body_verbat

body_normal      =  mark_normal (nl tail_normal / ' '? line_normal nl blocks? / nl)
body_markup      =  mark_markup (nl tail_markup / ' '? line_markup nl blocks? / nl)
body_verbat      =  mark_verbat (nl tail_verbat / ' '? line_verbat nl blocks? / nl)

line_normal      =  (embedded_text / text)+                             # line of plain text with {...} or $... expressions; no markup; escaped during rendering
line_markup      =  (embedded_markup / embedded_text / text)+
line_verbat      =  verbatim ''

block_normal     =  mark_normal (' ' line_normal (nl tail2_normal)? / line_normal (nl tail_normal)?)
block_markup     =  mark_markup (' ' line_markup (nl tail2_markup)? / line_markup (nl tail_markup)?)
block_verbat     =  mark_verbat (' ' line_verbat (nl tail2_verbat)? / line_verbat (nl tail_verbat)?)

tail_normal      =  indent_s core_normal dedent_s
tail_markup      =  indent_s core_markup dedent_s
tail_verbat      =  indent_s core_verbat dedent_s

tail2_normal     =  indent_s indent_s core_normal dedent_s dedent_s         # like tail_normal, but with 2-space indentation
tail2_markup     =  indent_s indent_s core_markup dedent_s dedent_s         # like tail_markup, but with 2-space indentation
tail2_verbat     =  indent_s indent_s core_verbat dedent_s dedent_s         # like tail_verbat, but with 2-space indentation

core_normal      =  ((tail_normal / line_normal) nl)*
core_markup      =  ((tail_markup / line_markup) nl)*
core_verbat      =  ((tail_verbat / line_verbat) nl)*

mark_normal      =  '|'
mark_markup      =  '/'
mark_verbat      =  '!'


###  TAG BLOCKS

block_def        =  '%%' ws tag_def                             # double percent means single percent, only we need to escape for grammar string formatting
tag_def          =  name_code attrs_def

block_tags       =  tags_expand ws body
tags_expand      =  tag_expand (ws '>' ws tag_expand)*
tag_expand       =  name_code attrs_val?


###  SPECIAL BLOCKS

block_control    =  'TODO'
block_comment    =  'TODO'


###  EMBEDDINGS

embedded_text    =  embedded_braces / embedded_eval
embedded_markup  =  '{{' ws expr (space expr)* ws '}}'          # results of multiple space-separated expressions are space-concatenated: ' '.join()
embedded_braces  =  '{' ws expr (space expr)* ws '}'
embedded_eval    =  '$' expr

###  ATTRIBUTES of tags

# formal attributes as declared in hypertag definition; structural attributes @... must always go at the end
attrs_def        =  (space attr_named)* (space attr_body)*

# actual attributes as passed to a tag
attrs_val        =  (ws attr_short+ / space attr_val) (space (attr_short+ / attr_val))*
attr_val         =  attr_named / attr_unnamed

attr_body        =  '@' name_code
attr_short       =  ~"[\.#][a-z0-9_-]+"i                        # shorthands: .class for class="class", #id for id="id"
attr_named       =  name_xml (ws '=' ws value_named)?           # name OR name="value" OR name=value OR name=$(...)
attr_unnamed     =  value_unnamed ''

value_named      =  value_unnamed / str_unquoted
value_unnamed    =  embedded_text / number / string

name_code        =  !name_reserved ~"[a-z_][a-z0-9_]*"i
name_reserved    =  ~"(if|else|is|in|not|and|or)\\b"            # names with special meaning inside expressions, disallowed for hypertags & variables; \\b is a regex word boundary and is written with double backslash bcs single backslash-b is converted to a backspace by Python
name_xml         =  ~"[%(XML_StartChar)s][%(XML_Char)s]*"i      # names of tags and attributes used in XML, defined very liberally, with nearly all characters allowed, to match all valid HTML/XML identifiers, but not all of them can be used as hypertag/variable names


###  EXPRESSIONS

expr             =  ''

###  ARGUMENTS of functions

###  ATOMS

number_signed    =  ~"[+-]?" number
number           =  ~"((\.\d+)|(\d+(\.\d*)?))([eE][+-]?\d+)?"      # the leading +- is added during expression construction (<neg>)
string           =  ~"'[^']*'" / ~'"[^"]*"'         # '...' or "..." string; no escaping of ' and " inside!
str_unquoted     =  !'$' ~"[^\s\"'`=<>]+"           # in attributes only, for HTML compatibility; see https://html.spec.whatwg.org/multipage/syntax.html#syntax-attributes


###  BASIC TOKENS

verbatim    =  ~"[^%(INDENT_S)s%(DEDENT_S)s%(INDENT_T)s%(DEDENT_T)s\n]*"s     # 1 line of plain text, may include special symbols (left unparsed)
text        =  ~"[^%(INDENT_S)s%(DEDENT_S)s%(INDENT_T)s%(DEDENT_T)s\n{}]*"s   # 1 line of plain text, special symbols excluded: { }
texts       =  ~"[^%(INDENT_S)s%(DEDENT_S)s%(INDENT_T)s%(DEDENT_T)s{}]*"s     # lines of plain text, all at the same (baseline) indentation level

indent_s    = "%(INDENT_S)s"
dedent_s    = "%(DEDENT_S)s"
indent_t    = "%(INDENT_T)s"
dedent_t    = "%(DEDENT_T)s"

nl          =  ~"([ \t]*\n)+"                # obligatory vertical space = 1+ newlines, possibly with a leading horizontal space and/or empty lines in between
vs          =  ~"([ \t]*\n)*"                # optional vertical space = 0+ newlines

space       =  ~"[ \t]+"                     # obligatory whitespace, no newlines
ws          =  ~"[ \t]*"                     # optional whitespace, no newlines

###  SYMBOLS that mark TYPES of blocks or text spans



"""

