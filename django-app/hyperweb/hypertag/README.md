### Introduction

Why to use Hypertag:
- less typing; no need to remember about closing tags
- no errors related to incorrect closing tags or open-close tag mismatches
- unprecedented support for **modularity** and **code re-use**
- Object-Oriented Programming (**OOP**) inside markup,
  through native language structures (???)
- high performace in web applications achieved through caching of parsed AST,
  combined with their **compactification**: constant parts of the AST are
  pre-rendered and merged into single nodes, to avoid repeated rendering
  with every web page request.

### Syntax

#### Blocks

##### Text blocks

Normal, markup, verbatim:

    | normal block with {'embedded'} $expressions
    / markup <b>block</b>
    ! verbatim $block$ (expressions left unparsed)

Multiline block:

    |   text block
      may span
        multiple
      lines...


##### Tagged blocks

- tags chain (:)
- body: inline / outline / headline
- null tag (.) as a way to align contents of non-tagged vs. tagged blocks

      h1 | title
      .  | contents
  
- null tag (.) as a way to group nodes


##### Block "try"

Basic form:

    try ...
    or ...
    else ...

If used with a single tagged block, try block can be written in a shorter form:

    ?tag ...
    ? tag ...

This works with a default tag specification, as well:

    ? .some-class ...
    ? #some-id ...

##### Block "if"

##### Block "for"
    
- break & continue

##### Block "import"

- import NAME -- import from a global context
- from PATH import NAME -- import from a module denoted by PATH, which can be any string
  consisting of [...] characters that can be correctly interpreted by the currently used
  Environment subclass

#### Expressions

##### Literals

Integers, real numbers, strings, boolean literals (True, False), None.

    True, False, None

##### Collections

Lists, dicts ...

##### Operators

Hypertag implements majority of standard operators available in Python.

Arithmetic and binary operators:

    ** * / // %
    + - unary minus
    << >>
    & ^ |

Logical operators:

    == != >= <= < > in is "not in" "is not"
    not and or

A more general variant of the ternary "if-else" operator is available, 
with the "else" branch being optional, imputed with "else None" if missing:

    X if TEST else Y
    X if TEST

Tail operators:

    .     member access
    []    indexing
    ()    function call

Slice operator when used inside [...]:

    start : stop : step

Above these, Hypertag implements a non-standard binary **concatenation operator** (space),
as well as tail operators: **optional value** ("?") and **obligatory value** ("!").
They are described in next sections.


##### Concatenation operator

If multiple expressions are put one after another separated by 1+ whitespace:

    EXPR1 EXPR2 EXPR3 ...

their values are converted to strings and concatenated.
This is an extension of Python syntax for concatenating literal strings, like in:

       'Hypertag '  "is"   ' cool'

which is parsed by Python into a single string:

       'Hypertag is cool'

In Hypertag, concatenation using whitespace as an operator is performed on runtime,
hence all (possibly non-literal) expressions are supported as operands, not just literals;
and values of other types than `<str>` are automatically converted to strings 
before concatenation.

The programmer must guarantee that the values of all sub-expressions 
can be converted to `<str>` through the call: `str(value)`

##### Qualifiers: ? and !

? = _optional value_: fall back to an empty string if an error/None/False/0/... was returned

! = _obligatory value_: raise an exception if an empty value (None/False/0/''/...) was returned

A qualifier (? or !) can be appended at the end of an atomic expression (X?, X!)
to test against errors during evaluation, or emptiness (falseness) of the returned value.

With ? qualifier, if X evaluates to a false value or an exception was raised during evaluation,
empty string '' is returned instead. A value, X, is false, if bool(X) == False.
Empty string '', None, 0, False are examples of false values.

With ! qualifier, if X is false, MissingValue exception is raised. 
Typically, this exception is caught with a surrounding "optional value" qualifier:

    (... expr! ...)?

or with a "try" block higher in the script.

In any case (X? or X!), if X is true, the value of X is returned unchanged.

Examples:

    {(post.authors ', ')? post.title}  -- prints title only if "authors" field is missing in "post"
    

#### Name spaces

There are two separate name spaces:
1. Tags namespace
2. Variables namespace

The separation of these name spaces is justified by the fact that in the most
typical use case - HTML generation - there are several dozens of predefined tags,
all of which must be directly accessible. Some of these tags have short or common
names (i, b, p, code, form, head, body, ...), and without separation of name spaces,
name collissions between tags and local variables would be very frequent 
and would often lead to confusion.

As a consequence of name spaces separation, it is not possible to directly refer
to tag names inside expressions.


### DOM

DOM = Document Object Model

#### DOM classes

#### DOM manipulation

Selectors as methods of Sequence ...


### Script execution

Execution of a Hypertag script constists of 3 phases:
1. parsing (script > AST)
2. translation (AST > DOM)
3. rendering (DOM > markup)

Typically, the client code will call `Hypertag.render()` to perform all the above 
steps at once. In rare cases, the client may wish to obtain the structured representation
of the resulting document - the DOM (Document Object Model) - for example, to manipulate
the DOM tree before it gets rendered. In such case, the client should call 
`Hypertag.translate()` and then `render()` on the resulting DOM tree.


**Environment** ... **context** consisting of any python objects can be provided ...

### SDK ??

- class Tag, ExternalTag, MarkupTag -- for implementing custom tags
- class HNode
- class Sequence
- class Environment


