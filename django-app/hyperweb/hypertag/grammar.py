"""
Hypertags Markup Language (HyML Essential).
An indentation-based document description & templating language with modularity through inline function definitions.

***Names (?):
- HyML, PyML, Sleek, HypeML, OneML, HDML, Coco, BlueText, DeepText, HyperMark, WideMark, RichMark, Hypertags
  Limerick, Limeri, verse, well-versed, verses, Versus, strophe, sonnet, Lyric
  Elm Tree (wiąz) linden (lipa) oak (dąb) fig (figa) lemon plum cone (szyszka) tulip, OakDoc FigTree
  lapis lazuli, wenge, violet purple lime lilac, iris amber jet lava sea steel, aqua, string stringer stringl
  DotTag BigTag SoTag GoTag PurpleTag LimeTag BlueTag GreenTag DynaTag SuperTag HighTag HiTag FlexTag SharpTag
- tree of tags (TRoT, ToT, Treet) markup lang (TreML, TreeML, BranchML), HyTree
- document model/tree manipulation & markup language (DoMoMaMaLa, DoMMaL, DMML, DoTML, DTML)
- tree: Text Document Object Model (TDOM)
- same names on Github:
  - Hypertag: only abandonded/small projects (https://github.com/AndreasPizsa/hypertag, https://github.com/domalgebra/hypertag)
              2 small companies on LinkedIn (https://www.linkedin.com/search/results/companies/?keywords=hypertag&origin=SWITCH_SEARCH_VERTICAL)
              - IT company in Bangladesh (https://hypertagsolutions.com/), na twitterze <100 obserwujących
              - ad-tech company (https://en.wikipedia.org/wiki/Hypertag), website inactive!, https://www.linkedin.com/company/hypertag-ltd/about/
  - Limerick: one project quite popular (https://github.com/kalimu/LimeRick)
  - Versus: no projects
- domeny wolne:
  - hypertag.io (135 zł/rok), hypertag.one (36), .pro (62) .network (64) .link (36) .software (104) .zone (104);
    zajęte hypertag.net, hypertag.dev
  - limerick.tech (160 zł/rok) limerick.one (36) .pro;
    zajęte limerick.io, limerick.net, limerick.dev (na sprzedaż 1000 zł)
- PyPi:
  - 0 projektów z "hypertag" w nazwie
  - 0 projektów z "limerick" w nazwie
  
LIMERICK is a computer language for writing structured documents. Main features:
- Can output HTML/XML, as well as any other markup language.
- Can render to text or to a custom DOM tree that can be further manipulated.
- Nesting structure is defined through INDENTATION rather than closing tags, to simplify programming and improve readability.
- Python-like EXPRESSIONS and CONTROL STATEMENTS (if-else, for, while...), as well as
  custom statements (try-else), are supported natively, without the need to use embedded templating code
- Custom tags (HYPERTAGS) can be defined: either as external functions or as pieces of (parameterized) Limerick code
  directly in a document.
- Tree structure can be MANIPULATED and ANNOTATED (??) during document creation, or later,
  through the use of native SELECTORS and FILTERS (??).
  In this way, parts of a tree can be utilized as a store of data and parameters to control rendering of other parts of the tree.
PR:
- Let the code read like a poem... Code reads like a poem... Shall code read like a poem
- $ lim, LimNode, LimTree


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
% hypertag attr1 attr2=default @header @body @footer ....
  tag1
  body                    -- node `body` (delayed rendering)
  footer x=10             -- node `footer` with appended value of `x` attr (overrides default value and/or any value assigned before `footer` was passed to hypertag)
  htag @sidebox=footer(x=10)   -- passing a hypertag `footer` as a value of another hypertag's attribute
  tag2
  / {{ body tag(...) }}
  % subtree | ...       -- local structural variable, for use as a node or inside markup {{...}} expressions
  [section1]            -- sections returned as
    tag...
  [section2]
    ...

% hypertag @blocks attr1 attr2=default +inline
    | {inline}
    blocks
    blocks.section

def hypertag +self attr1 attr2=defult
def hypertag @self attr1 attr2=defult

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

select nonempty      -- pick the 1st branch whose all embedded expressions ({..} or $..) evaluate to not-None and don't raise exceptions; pass if no such branch exists
- BODY1 ...
- BODY2 ...
select defined       -- pick the 1st branch whose ALL variables occuring inside expressions are not-None
- BODY1 ...
- BODY2 ...

try                  -- pick the 1st branch that doesn't raise an exception (embedding None inside text block raises NoneExpression)
  BODY1 ...             if "else" branch is present, it is selected if all previous branches fail; othwerwise <void> is returned
or                   -- behaves similar to python's "except Exception ..."; allows another "or..." branch(es) to be appended
  BODY2 ...             and executed if the current branch fails, as well
else
  BODY3

? BLOCK              -- optional tag-block; equivalent to:       try:
                                                                    BLOCK
  
for name in $expr:
  BODY
  
"pass" node: for internal use, to enclose body of a control statement where head (with tag) is missing.

-- comment line
--
# another comment line
# comments can be put after block header, on the same line, unless the block contains inline text;
# be careful not to put literal # or -- at the beginning of a subsequent line within a text block, as the line would get removed;
# if you need to start a text line with # or --, prepend it with ! or | or /, or print it as an expression {'--'}

SELECTORS

Syntax:
    .       child nodes
    ..      descendant nodes
    []      indexing nodes or attributes
or
    :     children
    ::    descendants
    TAG   hypertag object/function from current scope; filtering by tag identity not name

@body..meta-styles(.[0:3])        - [number] indexes nodes
@body..meta-styles[attr1]      - [name] indexes attributes of a node
@body [0:3] meta-styles
@body [meta-styles] [0:3] [class=xyz]

@feed : TAG -contains('kot')
@feed : -contains('kot')
@feed :: -TAG

@body [:3]          - nodes #0,1,2 from sequence "body"
@body :TAG          - seq. of nodes in "body" tagged by TAG (next filter applied to each node separately)
@body [TAG]         - list of nodes in "body" tagged by TAG (next filter applied to entire list at once)
@body .head         - (problems: (a) head is symbole or keyword? if symbol, it clashes with html's <head>)
@body .tail
@body TAG [arg]     - list of values of argument `arg`
@body TAG [arg=123] - list of TAG nodes whose argument value arg=123

$ self.all(name=123)    self.descendants()
$ self / TAG
$ self // TAG
$ x + y*z
$ var = 'ala' + ' ma ' + 10
$ nodes = self[TAG]

$var = 'ala' + ' ma ' + 10
@nodes = @body[TAG]

clause / zone / section / block / paragraph / area / body / branch

special tags:
    return
    break
    continue
    pass
    void / noop / -           a tag that performs no processing, only used for grouping elements

CLASSES

%% sidemenu @body width=100
    $height = width * 2                     -- public "property"
    %cell @text :  ... {width-20} ...       -- public "method"

    [doc.head]
        style | ...
    [doc.tail]
        script async=True ! ...
    div ... {width+10} ...                  -- result produced (box+meta)
        @body
    
(sidemenu) 150
    .cell | item 1
    .cell | item 2
    | outer box height is {.height}
    (sidemenu) 50
        .cell  | subitem 1
        ..cell | upper-level cell ??
        if {.height < 100}:
            p | pathA
        else:
            div | pathB
        | inner box height is {.height}

"""

#####################################################################################################################################################

"""
title
    | {fulltitle or (title " | Paperity")}
    
<title>[[$fulltitle||$title | Paperity]]</title>

%Breadcrumb items widgets
    try | $widgets

<:Breadcrumb bodyitems items widgets>
    [[$widgets]]

?Breadcrumb items=$breadcrumb
[[<Breadcrumb items=$breadcrumb />]]

% _date sep:
    if showDate and paper.birth:
        span .bib-date | {paper.birth|strftime('%b %Y')}
        select         / $sep
        or             / <br/>

    <:_date ~ sep>
        <if $(showDate and paper.birth)><span class="bib-date">$(paper.birth|strftime('%b %Y'))</span> [[$sep || <br/>]] </if>
    </:_date>

if paper.title_snippet  / $paper.title_snippet
else                    | {paper.title | striptags}

try    / $paper.title_snippet
else   | {paper.title | striptags}

         [[<if $paper.title_snippet>
              $(paper.title_snippet|HTML)
            </if>
          ||  $(paper.title|striptags)
         ]]

if paper.snippet                         / $paper.snippet
elif paper.grey == 0 and paper.abstract  | {paper.abstract | striptags | truncate(385, ellipsis="...")}

      [[<if $paper.snippet> $(paper.snippet|HTML) </if>
      ||<if $(paper.grey == 0 and paper.abstract)> $(paper.abstract|striptags|truncate(385, ellipsis="...")) </if>
      ]]
      
%Pagination pageurl start end current total
	-- pageurl: a 1-arg function/hypertag that renders URL of a subpage given its number
	ul .pagination .text-center
		if current > 1
		    li > a href=$pageurl(1)   / &laquo;
		else
		    liDisabled                / &laquo;

		for page in range(start, end+1)
			if page == current:   li .active > a href="javascript:void(0);"  / $page
			else:                 li         > a href=$pageurl(page)         / $page

		if current < total
		    li > a href=$pageurl(total)   / &raquo;
		else:
		    liDisabled                    / &raquo;

<:Pagination ~ pageurl start end current total>
	[# pageurl: a 1-arg function/hypertag that renders URL of a subpage given its number #]
	<ul class="pagination text-center">
		[[<if $(current > 1)> <li><a href=$pageurl(1)>&laquo;</a></li> </if>
		||<liDisabled>&laquo;</liDisabled>
		]]
		<for page=$range(start, end+1)>
			[[<if $(page != current)> <li><a href=$pageurl(page)>$page</a></li> </if>
			||<li class="active"><a href="javascript:void(0);">$page</a></li>
			]]
		</for>
		[[<if $(current < total)> <li><a href=$pageurl(total)>&raquo;</a></li> </if>
		||<liDisabled>&raquo;</liDisabled>
		]]
	</ul>
	
	
% extra_head paper journal:
    ? meta name="citation_journal_title" content={journal.title|striptags}
    if paper.date:
        meta name="citation_date" content={paper.date|strftime('%Y/%m/%d')}
        meta name="citation_publication_date" content={paper.date|strftime('%Y/%m/%d')}
    else:
        meta name="citation_date" content=$paper.year

    for author in paper.authors[:100]
        meta name="citation_author" content=$author
        
    meta name="citation_pdf_url" content=$paper.url_pdf
    
    [[meta name="citation_journal_title" content={journal.title|striptags} ]]
    [[<meta name="citation_publisher" content=$journal.publisher >]]
    [[<meta name="citation_title" content=$(paper.title|striptags) >]]
    [[<meta name="citation_year" content=$paper.year >]]
    [[<if $paper.date><meta name="citation_date" content=$(paper.date|strftime('%Y/%m/%d')) >
                      <meta name="citation_publication_date" content=$(paper.date|strftime('%Y/%m/%d')) >
             </if> || <meta name="citation_date" content=$paper.year > ]]
    [[<meta name="citation_issue" content=$paper.issue >]]


if isAndroid or (isMac and isSafari):
    Google_Viewer paper
    rawtext paper hidden=ON
else:
    -- default native PDF viewer on all other devices
    pdfObject paper
        pdfAlert paper
        rawtext paper

		[[
		<if $(isAndroid or (isMac and isSafari)) >          [# fallback PDF viewer (Google Docs) on Android and Safari/Mac #]
            <Google_Viewer $paper />
            <rawtext $paper hidden=$true />
		</if>
		||
		<pdfObject $paper>                                  [# default native PDF viewer on all other devices #]
	    	<pdfAlert $paper />
	        <rawtext $paper />
		</pdfObject>
        ]]

if paper.abstract:
    div .row
        div .col-lg-3 .col-md-3 .col-xs-12
            p .hidden-md .hidden-lg .author-names style="margin-top:0"
                | {paper.authors|et_al(10, '<em>et al.</em>')|authorlink|join(', ')}
            div .hidden-xs .hidden-sm .lead .author-names .text-right
                / {paper.authors|et_al(10, '<em>et al.</em>')|authorlink|join('<div class="author-break"></div>')}
        div .col-lg-9 .col-md-9 .col-xs-12
            blockquote | {paper.abstract|pstriptags}
else:
    p .author-names | {paper.authors|et_al(10, '<em>et al.</em>')|authorlink|join(', ')}

           [[ <if $paper.abstract>
            <div class="row">
                <div class="col-lg-3 col-md-3 col-xs-12">
            		<p class="hidden-md hidden-lg author-names" style="margin-top:0">$(paper.authors|et_al(10, '<em>et al.</em>')|authorlink|join(', '))</p>
                    <div class="hidden-xs hidden-sm lead author-names text-right">
                        $HTML(paper.authors|et_al(10, '<em>et al.</em>')|authorlink|join('<div class="author-break"></div>'))
                    </div>
                </div>
                <div class="col-lg-9 col-md-9 col-xs-12">
                    <blockquote>$(paper.abstract|pstriptags)</blockquote>
                </div>
            </div>
            </if>
            || <p class="author-names">$(paper.authors|et_al(10, '<em>et al.</em>')|authorlink|join(', '))</p>
            ]]
            
? i | {paper.title|striptags},
try | {journal.title|striptags},
try | $paper.year,
try | pp. $paper.pages,
try | $paper.issue,
try | DOI: $paper.doi
            
            [[<i>$(paper.title|striptags)</i>,]]
            [[$(journal.title|striptags),]]
            [[$paper.year,]] [[pp. $paper.pages,]] [[$paper.issue,]] [[DOI: $paper.doi]]
            
try | Search... ({paperCount|comma000} papers from {journalCount|comma000} journals)
            
            [$("Search... (" (paperCount|comma000) " papers from " (journalCount|comma000) " journals)")]
            
div class="panel panel-body panel-sidebar" class=$color class=$class class=$extra style=$style
div class="panel panel-body panel-sidebar" class={' '.join([color, class, extra])} style=$style
div class="panel panel-body panel-sidebar" class={color class extra} style=$style

            <div class=$("panel panel-body panel-sidebar " color " " class " " extra) style=$style>
            
div class="panel-sidebar-container col col-sm-3" class={"col-xs-3" if not compactOnSmall}!

            <div class=$("panel-sidebar-container col col-sm-3" (" col-xs-3" if not compactOnSmall))>
"""


########################################################################################################################################################
grammar = r"""

###  Before the grammar is applied, indentation in the input text must be translated into
###  "indent" and "dedent" special characters: INDENT_S/DEDENT_S for spaces, INDENT_T/DEDENT_T for tabs.
###  These characters must be unique and don't occur anywhere else in input text,
###  except for places where they get inserted during translation.

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

document         =  core_blocks margin?

tail_blocks      =  (indent_s core_blocks dedent_s) / (indent_t core_blocks dedent_t)
core_blocks      =  tail_blocks / block+

block            =  margin (block_text / block_control / block_def / block_struct)

###  CONTROL BLOCKS

block_control    =  block_assign / block_if / block_try / block_for

block_assign     =  mark_expr ws targets ws '=' ws (embedding / expr_augment)
block_try        =  ('try' body (nl 'or' body)* (nl 'else' body)?) / try_short
block_for        =  'for' space targets space 'in' space (embedding / expr_augment) body_struct
block_if         =  'if' clause_if (nl 'elif' clause_if)* (nl 'else' body)?

try_short        =  '?' ws (block_text / block_struct)          # short version of "try" block:  ?tag ... or ?|...
clause_if        =  space (embedding / expr) body_struct        # (embedding body) / ...  -- inline syntax could be handled in the future, but only when a test expression is enclosed in {..}, NO qualifier (collisions with operators |/ and qualifier !)

targets          =  target (comma target)* (ws ',')?            # result object must be unpacked whenever at least one ',' was parsed
target           =  ('(' ws targets ws ')') / var_def           # left side of assignment: a variable, or a tuple of variables/sub-tuples
var_def          =  name_id ''                                  # definition (assignment) of a variable

body_struct      =  (ws mark_struct comment?)? tail_blocks

###  DEFINITION BLOCK

block_def        =  mark_def ws tag_def
tag_def          =  name_id (attrs_def / ('(' attrs_def ')'))

###  STRUCTURED BLOCK

# block_struct     =  tags_expand body?                         # structured block requires min. 1 tag, but body is not obligatory
block_struct     =  tags_expand (ws mark_struct)? (ws headline)? tail_blocks?

tags_expand      =  tag_expand (ws mark_struct ws tag_expand)*
tag_expand       =  name_id attrs_val?
#tag_expand       =  (name_id / attr_short) attrs_val?           # if name is missing (only `attr_short` present), "div" is assumed

###  HEAD, TAIL, BODY

headline         =  head_verbat / head_normal / head_markup

head_verbat      =  mark_verbat gap? line_verbat?
head_normal      =  mark_normal gap? line_normal?
head_markup      =  mark_markup gap? line_markup?

body             =  body_text / body_struct
body_text        =  ws (block_verbat / block_normal / block_markup)

###  TEXT BLOCKS & LINES

block_text       =  (tags_expand ws)? (block_verbat / block_normal / block_markup)

block_verbat     =  mark_verbat line_verbat? tail_verbat?
block_normal     =  mark_normal line_normal? tail_normal?
block_markup     =  mark_markup line_markup? tail_markup?

tail_verbat      =  (indent_s core_verbat dedent_s) / (indent_t core_verbat dedent_t)
tail_normal      =  (indent_s core_normal dedent_s) / (indent_t core_normal dedent_t)
tail_markup      =  (indent_s core_markup dedent_s) / (indent_t core_markup dedent_t)

core_verbat      =  (tail_verbat / (margin line_verbat))+
core_normal      =  (tail_normal / (margin line_normal))+
core_markup      =  (tail_markup / (margin line_markup))+

line_verbat      =  verbatim ''
line_normal      =  line_markup ''                              # same as line_markup during parsing, but renders differently (performs HTML-escaping)
line_markup      =  (escape / embedding / text)+                # line of plain text with {...} or $... expressions; no HTML-escaping during rendering

mark_struct      =  ':'
mark_verbat      =  '!'
mark_normal      =  '|'
mark_markup      =  '/'

mark_expr        =  '$'
mark_def         =  '%%'                                        # double percent means single percent, only we need to escape for grammar string formatting

gap              =  ~"[ \t]"                                    # 1-space leading gap before a headline, ignored during rendering
comment          =  ~"--|#" verbatim?                           # inline (end-line) comment; full-line comments are parsed at preprocessing stage


###  EMBEDDINGS

# below, results of multiple space-separated expressions are ''-concatenated,
# while results of ','-separated expressions (a tuple) are  ' '-concatenated

embedding        =  embedding_braces / embedding_eval
embedding_braces =  '{' ws expr_augment ws '}' qualifier?
embedding_eval   =  '$' expr_var


###  ATTRIBUTES of tags

# formal attributes as declared in hypertag definition; body attribute @... must go first if present
attrs_def        =  (space attr_body)? (space attr_named)*

# actual attributes as passed to a tag
attrs_val        =  (space (attr_val / attr_short))+       #/ ws '(' attr_val (',' ws attr_val)* ')'
attr_val         =  attr_named / attr_unnamed

attr_body        =  '@' name_id
attr_short       =  ('.' / '#') (attr_short_lit / embedding)        # shorthands: .class for class="class", #id for id="id" ... or #{var} or #$var
attr_short_lit   =  ~"[a-z0-9_-]+"i                                 # shorthand literal value MAY contain "-", unlike python identifiers!
attr_named       =  name_xml ws '=' ws value_of_attr                # name="value" OR name=value OR name=$(...)
attr_unnamed     =  value_of_attr ''
value_of_attr    =  embedding / literal

#value_named      =  value_unnamed / str_unquoted
#value_unnamed    =  embedding / literal

###  ARGUMENTS of functions

args             =  arg (comma arg)* (ws ',')?
arg              =  kwarg / expr
kwarg            =  name_id ws '=' ws expr

###  EXPRESSIONS

# the expression...
# built bottom-up, starting with inner-most components built of high-priority operators (arithmetic)
# and proceeding outwards, to operators of lower and lower priority (logical);
# after parsing, the expression nodes with only 1 child are reduced (compactified),
# to avoid long (~10 nodes) branches in the syntax tree that don't perform any operations
# other than blindly propagating method calls down to the leaf node.

expr         =  expr_root ''                # basic (standard) form of an expression
expr_var     =  factor_var ''               # reduced form of an expression: a variable, with optional trailer; used for inline $... embedding (embedding_eval) only
expr_augment =  expr_root / expr_tuple      # augmented form of an expression: includes unbounded tuples (no parentheses); used in augmented assignments

expr_tuple   =  expr ws ',' (ws expr ws ',')* (ws expr)?      # unbounded tuple, without parentheses ( ); used in selected grammar structures only
subexpr      =  '(' ws expr ws ')'

var_use      =  name_id ''                                    # occurrence (use) of a variable
tuple        =  '(' ws ((expr comma)+ (expr ws)?)? ')'
list         =  '[' ws (expr comma)* (expr ws)? ']'
set          =  '{' ws expr (comma expr)* ws (',' ws)? '}'    # obligatory min. 1 element in a set
dict         =  '{' ws (dict_pair comma)* (dict_pair ws)? '}'
dict_pair    =  expr ws ':' ws expr

atom         =  literal / var_use / subexpr / tuple / list / dict / set
factor_var   =  var_use (ws trailer)* qualifier?              # reduced form of `factor` for use in expr_var
factor       =  atom (ws trailer)* qualifier?                 # operators: () [] .
pow_expr     =  factor (ws op_power ws factor)*
term         =  pow_expr (ws op_multiplic ws pow_expr)*       # operators: * / // percent
arith_expr   =  neg? ws term (ws op_additive ws term)*        # operators: neg + -
shift_expr   =  arith_expr (ws op_shift ws arith_expr)*
and_expr     =  shift_expr (ws '&' ws shift_expr)*
xor_expr     =  and_expr (ws '^' ws and_expr)*
or_expr      =  xor_expr (ws '|' ws xor_expr)*
concat_expr  =  or_expr (space or_expr)*                      # string concatenation: space-delimited list of items

comparison   =  concat_expr (ws op_comp ws concat_expr)*
not_test     =  (not space)* comparison                       # spaces are obligatory around: not, and, or, if, else,
and_test     =  not_test (space 'and' space not_test)*        # even if subexpressions are enclosed in (...) - unlike in Python
or_test      =  and_test (space 'or' space and_test)*
ifelse_test  =  or_test (space 'if' space or_test (space 'else' space ifelse_test)?)?       # "else" branch is optional, defaults to None

#empty_test  =  ifelse_test op_empty (ifelse_test)?           # test for emptiness (falseness) of 1st operand: if empty, it's replaced with either '' or None, depending on operator: ? or !

expr_root    =  ifelse_test ''


###  TAIL OPERATORS:  call, slice, member access, qualifier ...

slice_value  =  ws (expr ws)?                # empty value '' serves as a placeholder, so that we know which part of *:*:* we're at
slice        =  slice_value ':' slice_value (':' slice_value)?
subscript    =  slice / (ws expr_augment ws)

call         =  '(' ws (args ws)? ')'
index        =  '[' subscript ']'            # handles atomic indices [i] and all types of [*:*:*] slices
member       =  '.' ws name_id
trailer      =  call / index / member

qualifier    =  ~"[\?!]"                      # ? means that None/empty(false)/exceptions shall be converted to '' ... ! means that empty (false) value triggers exception
# obligatory   =  '!'
# optional     =  '?'


###  SIMPLE OPERATORS

op_power     =  '**'
neg          =  '-'                            # multiple negation, e.g., "---x", not allowed -- unlike in Python
op_multiplic =  '*' / '//' / '/' / '%%'        # double percent means single percent, only we need to escape for grammar string formatting
op_additive  =  '+' / '-'
op_shift     =  '<<' / '>>'
op_empty     =  '?' / '!'

not          =  'not'
op_comp      =  ~"==|!=|>=|<=|<|>|not\s+in|is\s+not|in|is"

###  IDENTIFIERS

name_id          =  !name_reserved ~"[a-z_][a-z0-9_]*"i
name_reserved    =  ~"(if|else|elif|for|while|is|in|not|and|or)\\b"     # names with special meaning inside expressions, disallowed for hypertags & variables; \\b is a regex word boundary and is written with double backslash bcs single backslash-b is converted to a backspace by Python
name_xml         =  ~"[%(XML_StartChar)s][%(XML_Char)s]*"i      # names of tags and attributes used in XML, defined very liberally, with nearly all characters allowed, to match all valid HTML/XML identifiers, but not all of them can be used as hypertag/variable names


###  ATOMS

literal          =  number / string / boolean / none

number_signed    =  ~"[+-]?" number
number           =  ~"((\.\d+)|(\d+(\.\d*)?))([eE][+-]?\d+)?"      # the leading +- is added during expression construction (<neg>)
string           =  ~"'[^']*'" / ~'"[^"]*"'         # '...' or "..." string; no escaping of ' and " inside!
#str_unquoted    =  !'$' ~"[^\s\"'`=<>]+"           # in attributes only, for HTML compatibility; see https://html.spec.whatwg.org/multipage/syntax.html#syntax-attributes
boolean          =  'True' / 'False'
none             =  'None'


###  BASIC TOKENS

escape      =  '$$' / '{{' / '}}'

verbatim    =  ~"[^%(INDENT_S)s%(DEDENT_S)s%(INDENT_T)s%(DEDENT_T)s\n]+"su      # 1 line of plain text, may include special symbols (left unparsed)
text        =  ~"[^%(INDENT_S)s%(DEDENT_S)s%(INDENT_T)s%(DEDENT_T)s\n${}]+"su   # 1 line of plain text, special symbols excluded: $ { }

indent_s    = "%(INDENT_S)s"
dedent_s    = "%(DEDENT_S)s"
indent_t    = "%(INDENT_T)s"
dedent_t    = "%(DEDENT_T)s"

margin      =  nl ''                         # top margin of a block; same as `nl` in grammar, but treated differently during analysis (`nl` is ignored)
nl          =  ~"\n+"                        # vertical space = 1+ newlines

comma       =  ws ',' ws
space       =  ~"[ \t]+"                     # obligatory whitespace, no newlines
ws          =  ~"[ \t]*"                     # optional whitespace, no newlines

###  SYMBOLS that mark TYPES of blocks or text spans

"""
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
XML_Char       =  XML_StartChar + r"0-9\.\-" + u"\u00B7\u0300-\u036F\u203F-\u2040"


