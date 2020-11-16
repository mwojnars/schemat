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
    

#### Expressions

##### Qualifiers: ? and !

A qualifier (? or !) can be appended at the end of an atomic expression (X?, X!)
to test against emptiness (falseness) of its returned value.

With ? qualifier, if X evaluates to a false value or an exception was raised during evaluation, 
empty string '' is returned instead. A value, X, is false, if bool(X) == False.
Empty string '', None, 0, False are examples of false values.

With ! qualifier, if X is false, MissingValue exception is raised. 
Typically, this exception is caught at an upper level in the code using a "try" block.

In both cases (? and !), if X is true, the value of X is returned unmodified.

Examples:

    ...
    ...
    

##### Concatenation Operator

If multiple expressions are put one after another and separated by whitespace, like here:

    EXPR1 EXPR2 EXPR3 ...

their values will be space-concatenated using a `' '.join(...)` type of call.
Empty strings will be filtered out before concatenation.
The programmer must guarantee that all sub-expressions evaluate to strings,
otherwise an exception may be raised by `join()`.

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


