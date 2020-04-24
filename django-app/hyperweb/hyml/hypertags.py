# -*- coding: utf-8 -*-
"""
HyperML is a higher-level markup language that extends (X)HTML/XML with the ability to define and use **"hypertags"**:
custom tags created right in the document to factor out recurring code patterns 
and allow easy code re-use in multiple places around the document.
Hypertags can be viewed as markup analogs of **functions** present in all programming languages.
Hypertags can be parameterized, embedded in other hypertags, imported to other documents and
exported to application code where they can be used like regular functions.
Whenever a client requests a document (typically a web page), hypertags are expanded and replaced with their contents
in the original language - typically (X)HTML/XML, but any target language can be used, in general.
HyperML provides also many features beyond hypertags: variant blocks [[...]], embedded compound expressions $(...), 
references to external objects - all of those greatly simplifying web programming and improving interoperability 
between the application's logic and presentational code.

We paid close attention to provide full compatibility of HyperML with (X)HTML/XML.
HyperML can be viewed as an extension of HTML and XML that - for the first time! - adds native server-side modularity to these languages,
enables code reuse and de-duplication, and provides full interoperatibility with the application's computational code.

HyperML facilitates the use of best programming practices in web development and finally brings DRY principle to (X)HTML/XML programming.
It helps break away from the flawed principle of MVC (Model-View-Controller) design, where all application code was modularized around
technical features of the code and its language of implementation, rather than around functionalities
(SQL models separated from HTML views, separated from php/py/ruby/java controllers, even if implementing the same feature)
- this enforced a break-up of each functionality into numerous pieces, scattered all over the application code base.
By introducing deep interoperability between computational and presentational code, HyperML enables flexible modularization of the project,
with heterogenous multi-language modules combining code of different types and thus preserving integrity of each functionality 
within the entire project.

HyperML can be also viewed as an advanced templating language, whose syntax - unlike this of existing template languages -
is tightly integrated with the native syntax of markup documents.
HyperML parses all tags and markup elements of the document, thus it fully understands the document's structure and contents,
and can provide full two-way interoperability between the document and the applicaton:
not only some application objects can be injected into the document in predefined locations, as it is done in (one-way) templating languages,
but also native elements of the document - the hypertags and their markup contents - can be extracted and used 
both in the application and in other places around the same document. This is a unique feature of hypertags and HyperML, 
one that incredibly simplifies the development of large web applications.

Rendering of HyperML documents is extremely fast thanks to in-memory caching of parsed documents and hypertags,
as well as compactification of static blocks of markup and pre-computation of pure expressions.

Strictly speaking, HyperML is a transformation language, like, for example, XSLT: 
a document written in HyperML is typically not intended for consumption by the end user, 
rather it must be parsed and rendered to its final form of the target language, with all hypertags resolved, 
before it is handed over to the user. 

However, it is possible that in the future, web browsers will accept HyperML documents and perform 
hypertag rendering on their own, on the client side. This would have many benefits:
* semantic information for crawlers and search engines,
* smaller web traffic: thanks to de-duplication, HyperML performs implicit compression of markup documents as a side effect
* lower load on the server
* ability to use hypertags defined on the client side


=====================================================================================================================================================

CHEATSHEET of HYPERML
---------------------

<:H>This is a hypertag.</:H>                     -- Basic hypertag definition.
<:Message>Press <b>OK</b> to accept.</:Message>     Body of a hypertag may contain any markup, including other hypertags.

<:bullet>
  <img src="bullet.png" height="16" width="16">
</:bullet>                                                    


<H></H>                                          -- Basic hypertag usage.
<H />                                               Hypertags are used in a similar way as regular tags. Their occurences
                                                    are replaced with hypertag's definition body; recursively, if a hypertag
<:bullet>                                           is used inside another hypertag.
  <img src="bullet.png" height="16" width="16">
</:bullet>                                                    
                                                    >>> render("<:H>This is a hypertag.</:H> - <H></H> - <H />")
                                                    ' - This is a hypertag. - This is a hypertag.'
                                                    
                                                    >>> hyml = '''
                                                    ...           <:Message>Press <b>OK</b> to accept.</:Message>
                                                    ...           <Message /> | Page content..... | <Message />
                                                    ...        '''
                                                    >>> render(hyml).strip()
                                                    'Press <b>OK</b> to accept. | Page content..... | Press <b>OK</b> to accept.'

<H ~ ></:H>

--------------------
Parsing and rendering HyperML documents.
                                                    
HyperML("....")
HyperML("....").render()
render("....")

                                                    
=====================================================================================================================================================

OTHER REMARKS...

SYNTAX
- undefined tags: if a given tag is undefined, it's left in the source as it is (obviously that's necessary, 
  as hypertags are only and addition to regular tags)
- undefined variables: in strict mode, exception is raised; otherwise left in the source in their $NAME form
- nested hypertag definitions: you can define a hypertag inside a definition of another hypertag, 
  just like in Python function definitions can be nested in each other.
  Inner hypertag definition can make use of the attributes of the outer hypertag, which will be replaced with their actual values 
  upon hypertag expansion.
- hypertags passed as attributes/arguments, just like atomic values 
- NO recursion. Recursion is syntactically impossible, because every hypertag can only use hypertags defined earlier 
  in the source document and also it cannot use itself.
  Besides, recursion is not needed, because the language would become recursive then and it would belong to a higher class of languages
  than the class of context-sensitive languages (https://en.wikipedia.org/wiki/Recursive_language) and most likely it would become 
  recursively enumerable (Turing machine), because it will have conditional operations and has parameter passing.
- Names.
  All valid XML identifiers can be used as names of tags and attributes in HyperML, including the ones that contain
  Unicode characters or special characters allowed by XML: colon (':'), dot ('.') and minus ('-').
  Detailed specification of characters allowed can be found at: http://www.w3.org/TR/REC-xml/#NT-NameStartChar
  (NameStartChar, NameChar, Name productions).
  However, for hypertag definitions, only *regular* identifiers can be used as the name or attributes of the hypertag
  (further in the hypertag body all identifiers are allowed again).
  Regular identifiers are the ones built in a similar way as in most programming languages: 
  the name must being with an ASCII letter or underscore [a-zA-Z_], and then it can be followed by
  a mix of ASCII letters, digits and underscores: [a-zA-Z0-9_]*.
  
SEMANTICS
- Attribute minimization.
  For compatibility with HTML, HyperML allows attribute minimization, where a tag contains attribute name without a value, for example: 
     <textarea readonly>
  In such case, HyperML assumes empty string '' as the attribute value, which is one of valid ways in HTML to interpret minimized attributes
  (another way is: attr="attr"). For details of HTML specification, see: http://www.w3.org/TR/html5/infrastructure.html#boolean-attributes

Other details:
- the same hypertag can be redefined multiple times
- [# .. #] comments cannot be nested
- unquoted attr values must not start with $ (permitted in HTML) to avoid ambiguity with embedded expressions; 
  although $ is allowed further in the value string
- unary minus '-x' operator: in Python, it has the highest priority, higher than that of multiplicative * / % // and exponent **.
  In HyperML, it has low priority, the same as binary + and -.
- spaces are obligatory around: not, and, or, if, else - even if subexpressions are enclosed in (...). This is unlike in Python,
  where "(True)or(False)" is a correct expression.
- <> operator, which exists in Python 2 but is removed in Python 3, is not supported in HyperML. Use != for inequalities.
- other missing operators: ** (exponent), lambda, unary +, *args **kwargs, collections: [...] (...) {...} 
  
------------------------
IMPLEMENTATION

Name resolution consists of linking each occurence of a name (variable or hypertag) with the corresponding definition node in the syntax tree.
This is done in the analyse() method. For variables (xvar class), a position in the stack frame (xvar.offset) and the nestedness level (xvar.nested)
are calculated additionally.

Calling convention...
During runtime, hypertag expansion is similar to execution of a function in programming languages.
The key data structure is the *stack* that is passed down to the hypertag definition node (callee) upon expansion
and contains a sequence of *frames* of all outer hypertag expansions (calls). Each frame contains the actual values 
of attributes of a given hypertag, together with hidden attributes ($body), possibly some local variables (in the future)
and an *access link* that points to the activation frame of the immediate lexical encapsulating hypertag of the callee
(which in case of nested hypertag definitions is different than the all-document initial frame).

Frame layout (in the order of pushing):
- $body
- actual values of attributes of the hypertag
? frame pointer - position in the stack from before attributes; likely unnecessary (each attribute occupies 1 slot and we know the no. of attrs)
? local hypertag definitions - necessary ; no local variables, because variables can only be defined as hypertag attributes
- access link -- position in the stack of the TOP of the frame of the hypertag's immediated lexical encapsulating hypertag
The frame is pushed and popped entirely by the caller.


- wartość prosta: string, liczba, ...
- wartość tagowa: węzeł xhypertag, funkcja hipertagowa, ...
- linkowanie <A>,$x,... do węzła w drzewie (:A, x=, ...)
  - $x zmienna - linkowana do atrybutu x= (pozycja w stosie) lub hipertaga <:x>
  - <A> tag - nielinkowany (tag statyczny) lub linkowany do hipertaga <:A> (tag własny, link do węzła) lub do atrybutu A= (tag dynamiczny, pozycja w stosie) 
- linkowanie <A>,$x,... do pozycji w stosie wartości; bez nazw, 
  - pozycja atrybutu = offset ujemny wzgl. końca ramki hipertaga definiującego dany atrybut, ramka w aktualnym stosie
  - pozycja ramki = offset ujemny
- OrderedMultiDict for context repr. (push/pop/key)

------------------------
TODO: 
- $escape()/e() builtin for HTML-escaping of strings produced by expressions and embedded in the output markup (e = Escape/Embed/Expression)

DRAFT
Semantics of null value inside expressions - what should it be like?
- null concatenation in [[ ]]
- null in | operator
- null in other operators



=====================================================================================================================================================

UNIT TESTS


*** General markup & HTML/XML compatibility.

>>> render("")
''

HTML comments ARE parsed and transformed like normal text.
>>> render("<!-- ala <ma/> <:kota burek> $burek </:kota> \\n -->")
'<!-- ala <ma />  \\n -->'

Elements whose body should stay unparsed: script, style.
>>> render("<SCRIPT attr=''> $x $y $z <aTag> \\n </SCRIPT  >   <style type='css' > p {color: #001122} $x <ola-ma-psa> </style>")
"<SCRIPT attr=''> $x $y $z <aTag> \\n </SCRIPT  >   <style type='css' > p {color: #001122} $x <ola-ma-psa> </style>"

Void and non-self-closing elements don't need end tags and are parsed without exception.
>>> render("<img \\n src='/images/img.jpg \\n ' \\n >")
'<img src="/images/img.jpg &#10; ">'

XML names for tags and attributes, with characters from a broader set than recognized by HyperML.
>>> render(u"<sp:tag.x-y.\\uF900 attr-a:b.c-\\uf900 = ''/>")
"<sp:tag.x-y.豈 attr-a:b.c-豈 = ''/>"

Suppressing errors.
>>> render("<p>abc</p></p>", ignore_unpaired_endtags = True)
'<p>abc</p></p>'

Attribute name without a value.
>>> render("<:h body style><div disabled style=$style></div></:h> <h style='color:black' /> <h 'color:white' />")
' <div disabled style="color:black"></div> <div disabled style="color:white"></div>'


*** Hypertags.

Basic hypertag definition & usage.
>>> render("<:A ~ x>$x</:A><A x='Ala'></A>")
'Ala'
>>> render("<:A body x>$x</:A><A x='Ala'></A>")
'Ala'
>>> render("<:A x>$x</:A><A x='Ala'></A>", explicit_body_var = False)
'Ala'
>>> render("<:A x>$x</:A><A x='Ala'></A>")
Traceback (most recent call last):
    ...
HypertagsError: Can't assign explicitly to the body attribute 'x' of a non-void hypertag 'A' at line 1, column 14 (<A x='Ala'></A>)

# >>> render("<:A x>$x</:A><A x='Ala & Ola'/>")
# 'Ala &amp; Ola'
# >>> render("<:A x>$x</:A><A 'Ala & Ola'/>")
# 'Ala &amp; Ola'

Unsupported syntax def:...
> > > render("<def:A body x>$x</def:A><A x='Ala'></A>")
'Ala'

Empty tag used for hypertag definition.
>>> render("<:A body/><A>body</A>")
''

Isolated rendering of an arbitrary top-level hypertag.
>>> doc = HyperML("<:A body x \\n y z>$body $x $y $z</:A> <:B><A>inside B</A></:B> <A>not rendered</A>")
>>> doc.A("body", "x", z=5)
'body x  5'
>>> doc.B()
'inside B   '

Nested hypertag definitions.
>>> render("<:A ~ x><:B ~ y=$x>$x$y</:B> <B 'y'></B> <B></B> </:A> <A x='x'></A>")
'  xy xx '
>>> render("<:A x><:B y=$x>$x$y</:B> <:C>$x$body<B 'z'></B></:C> [[ $null || <C><B 'y'></B></C> || $x ]] </:A> <A x='x'></A>", explicit_body_var=0)
'    xxyxz  '
>>> render("<:A ~ x><:B ~ y=$x>$x$y</:B> <:C body>$x$body<B 'z'></B></:C> [[ $null || <C><B 'y'></B></C> || $x ]] </:A> <A x='x'></A>")
'    xxyxz  '
>>> render("<:A ~ x><:B ~ y=$x>$y</:B> <B 'y'></B> <B></B> </:A> <A x='x'></A>")
'  y x '

Hypertag definition inside occurence.
>>> render("<:A x>$x$body</:A> <A x='x'><:B y>$y</:B> <B 'y'></B></A>", explicit_body_var=0)
' x y'
>>> render("<:A body x>$x$body</:A> <A x='x'><:B ~ y>$y</:B> <B 'y'></B></A>")
' x y'

Redefinition of a hypertag.
>>> render("<:A body x>$x$body</:A> <:B>first</:B> <A x='x'><:B>second</:B> <B></B></A> <B></B>")
'  x second first'


*** Attributes.

Null (missing value) printed as attribute value.
>>> render("<:A x><div style=$x /></:A><A/>")
'<div style="" />'

Number printed as attribute value.
>>> HyperML("<:A x><div style=$x /></:A>").A(5)
'<div style="5" />'

Number value parsed as number object, not string, from attributes list.
>>> render("<:A ~ x>$(x+1)</:A> <A 3/>")
' 4'

Passing arguments from one hypertag to another.
>>> render("<:A ~ x>$x</:A> <:B ~ y><A x=$y></A></:B> <B y='Ala'></B>")
'  Ala'
>>> render("<:A x y z>$z $y $x</:A> <:B t><A y=$t \\n x='x' z='z'></A></:B> <B t='Ala'></B>", explicit_body_var=0)
'  z Ala x'
>>> render("<:A ~ x y z>$z $y $x</:A> <:B body t><A y=$t \\n x='x' z='z'></A></:B> <B t='Ala'></B>")
'  z Ala x'

Special attribute $body.
>>> render("<:A body a>$a $body</:A> <A a='Ala'><i>Ola</i></A>")
' Ala <i>Ola</i>'
>>> render("<:A text a>$a $text</:A> <A a='Ala'><i>Ola</i></A>")
' Ala <i>Ola</i>'
>>> render("<:A bodyA a>$a $bodyA</:A> <:B bodyB b><A a=$b><i>Ola</i> $bodyB</A></:B> <B b='Ala'><A a='Ela'></A></B>")
'  Ala <i>Ola</i> Ela '

Default values of attributes.
>>> render("<:A a='A' b c=''>$a$(b)$c;D</:A><A></A>", explicit_body_var=0)
'A;D'
>>> render("<:A ~ a='A' b c=''>$a$(b)$c;D</:A><A></A>")
'A;D'
>>> render("<:A body='disallowed' a='A' b c=''>$a$(b)$c;D</:A><A></A>")
Traceback (most recent call last):
    ...
HypertagsError: The body attribute 'body' must not have any default value at line 1, column 1 (<:A body='disallowed...)

When null value is passed explicitly, the default is still used, unlike in Python.
Semantics of $null is exactly that of a "missing" value, and the missingness propagates down the call chain.
>>> render("<:A ~ x='X'>$x</:A> <:B ~ x><A x=$x></A></:B> <A></A>,<B></B>,<B $null></B>,<B x=$null></B>,$B(),$B(null)")
'  X,X,X,X,X,X'

Encoding of expression values inside tags (value representation vs. rendering).
>>> render("<:A ~ url><img src=$url/> $url</:A><A url='http://abc.com/path\\\\file' />")
'<img src="http://abc.com/path\\\\file" /> http://abc.com/path\\\\file'

Variable attribute list.
> > > render("<:A ~ x y z>$x$y$z</:A><:B ~ *attrs><A></A></:B> <B/>")


*** Expressions.

Escape characters for special symbols.
>>> render("<p>$23.99 $<$> $$24.50 = $$price</p>")
'<p>$23.99 <> $24.50 = $price</p>'

Literals of different types.
>>> render("$(12) $(1.) $(.12) $(3.14) $('a \\n string') $('')")
'12 1.0 0.12 3.14 a \\n string '

Leading $ before variables can be nested inside $(...), for convenience and to avoid parsing errors, but doesn't have to.
>>> render("<:A ~ x> $(x) $($x) </:A> <A 3 /> $strip($str(5)) $strip(str(5))")
'  3 3  5 5'

Sequence indexes & slices.
>>> HyperML("<:A list>$list[3] $list[:] $list[:2] $list[3:] $list[::3] $list[ : 3 : ] $list[ -3: $null : (2-1) ]</:A>").A(list(range(5)))
'3 [0, 1, 2, 3, 4] [0, 1] [3, 4] [0, 3] [0, 1, 2] [2, 3, 4]'

Operators: additive, multiplicative.
>>> render("$(-12 + 1.-.12 +3.1) $(\\n 'string' + ' of text' )")
'-8.02 string of text'
>>> render("$(5//2) $(- 5 % (-2)) $(- 12 * 1./.12 +3.14*2*(3//2+5))")
'2 1 -62.32'

Operators: implicit + when no operator given.
>>> render("<:A name>$('my' (' friend ' $name) ' is great ' 123)</:A><A>Bobby</A>")
'my friend Bobby is great 123'

Operators: shifts, bitwise.
>>> expr = r"3 << 6 >> 4 & 123 | 321 ^ 555 << (1 | 23 >> 1+2*3)"
>>> render("$(%s)" % expr), eval(expr)
('1311', 1311)

Conditional operators.
>>> render("$(3 and 4 or 5 and not 6) $(3 if true else 9) $(1 if (3.0 and '') else 2 if 0.0 else 7) $(3 < 5 < 7 != 8 > 0 != $null)")
'4 3 7 True'
>>> render("$('a' in 'ala') $('ola' not in 'ola') $(true is true and false is not true)")
'True False True'
>>> render("$(5 if true) $len('ala' if false) $('/' 'ola' if false)")
'5 0 '

Lazy evaluation of conditional operators.
>>> def f0(): print('f0'); return 0
>>> def f1(): print('f1'); return 1
>>> g = {'f0': f0, 'f1': f1}
>>> render("$(f0() and f0())", globals = g)
f0
'0'
>>> render("$(f1() or f1())", globals = g)
f1
'1'
>>> render("$(f1() if false else f1())", globals = g)
f1
'1'


*** Escaping & filters.

HTML escaping.
>>> HyperML("<:A body x>$body $x.strip(' ') $(x[2])</:A>").A(body = "<b>ala &amp; ola</b>", x = "  ala <>& ")
'<b>ala &amp; ola</b> ala &lt;&gt;&amp; a'

Filters.
>>> filt = Filter(lambda s, param = None: "__filtered(%s)__%s__" % (param, s))
>>> render("$('ala' | filt) $('ola' | filt(5))", globals = {'filt':filt})
'__filtered(None)__ala__ __filtered(5)__ola__'

Any 1-arg function can be used as a filter without decorating.
>>> def quoted(s): return "`%s`" % s
>>> render("$('ala'|quoted)", globals = {'quoted':quoted})
'`ala`'


*** Built-in variables & filters.

Basic.
>>> render("$str(3.14) $len('ala'+'ola') $newline")
'3.14 6 \\n'
>>> render("<strip>  ala ma $strip(' kota \\n ') i psa  </strip>")
'ala ma kota i psa'

Null values rendered as empty strings by default.
>>> render("-$null-")
'--'


*** Built-in hypertags.

Import.
>>> render("<import 'xml.sax' names='parse xmlreader'> $parse.__name__ <import 'xml.sax'> [[$xml.sax.parse $null]] <import 'xml'>")
' parse   '

Include.
>>> from loaders import DictLoader
>>> loader = DictLoader(myfile = u"<:doc text title> <h1>$title</h1> <p>$text</p> \u017c\u017a\u0142\u015b\u0119\u0107 \\u0250 \\u0390 \\u1300</:doc>")
>>> HyperML("<include 'myfile' /> <doc 'My Title'>This is a story about...</doc>", loader = loader).render()
'  <h1>My Title</h1> <p>This is a story about...</p> \u017c\u017a\u0142\u015b\u0119\u0107 \u0250 \u0390 \\u1300'

Loops <for>.
>>> HyperML("<:A items><for item=$items> * $item</for></:A>").A(range(5))
' * 0\\n * 1\\n * 2\\n * 3\\n * 4'
>>> HyperML("<:A ~ items><for item=$items> * $item</for></:A>").A(range(0))
''
>>> HyperML("<:row x> * $x</:row> <:A items><for $items print=$row/></:A>").A(range(5))
' * 0\\n * 1\\n * 2\\n * 3\\n * 4'

Local assignments <with>.
>>> render("<with s='ala' n=3> $s $n $(s*n) </with>")
' ala 3 alaalaala '
>>> render("<with s='ala' n=5><with n=2> $s $n $(s*n) </with></with>")
' ala 2 alaala '

HTML.
>>> render("$HTML('<p>&</p>') $('<p>&</p>'|HTML) $str('<p>&</p>')")
'<p>&</p> <p>&</p> &lt;p&gt;&amp;&lt;/p&gt;'

Unescaping HTML to plain text when inserting in an attribute.
>>> render("<:A text><a t=$text/></:A> <A>ala &amp; ola</A> <A>ala & ola</A>")
' <a t="ala &amp; ola" /> <a t="ala &amp; ola" />'
>>> render("<:A text><a t=$text/></:A> <A>ala &amp; &quot; ola</A>")
' <a t=\\'ala &amp; " ola\\' />'

join() filter, <join> hypertag, joinlines().
>>> HyperML("<:A ~ l>$(l|join(cast=str))</:A>").A([1,2,3])
'123'
>>> HyperML("<:A text>$(text|join(' '))</:A>").A(HTML("<i>ala</i>\\nma\\nkota"))
'<i>ala</i> ma kota'
>>> render("<:A text><join ' '>$text</join></:A> <A><i>ala</i>\\nma\\nkota</A>")
' <i>ala</i> ma kota'


*** Using hypertags like variables.

>>> render("<:A>$null</:A> $A.definition()")
' <:A>$null</:A>'

>>> render("<:A ~ x><:B ~ y>$x$y</:B> $B('y') </:A><A 'x'/>")
' xy '

Hypertag's output passed as an attribute.
>>> doc = HyperML("<:A>in A</:A> <:B>&amp; <i>B</i></:B> <:C ~ x y>$x $y</:C> <C x=$A() y=$B()></C>")
>>> doc.render()
'   in A &amp; <i>B</i>'
>>> doc.C(doc.A(), doc.B())
'in A &amp; <i>B</i>'

Hypertag itself passed as an attribute.
>>> doc = HyperML("<:A>in A</:A> <:B>&amp; <i>B</i></:B> <:C ~ x y>$x() $y()</:C> <C x=$A y=$B></C>")
>>> doc.render()
'   in A &amp; <i>B</i>'
>>> doc.C(doc.A, doc.B)
'in A &amp; <i>B</i>'

Inner hypertag called like a function. This can be done inside HyperML doc, because due to HyperML syntax, 
the hypertag can only be passed downwards through the tree, never upwards, so all the necessary frames 
are still on the stack when the hypertag is to be expanded.
>>> render("<:A ~ x><:B ~ y>$x$y</:B><:C ~ h>$h('-in-C')</:C> <B 'y'/> $B('y') <C h=$B/> </:A> <A 'x'/>", compact = True)
'  xy xy x-in-C '

Inner hypertag passed as an argument and expanded in a different context, at a lower depth
- stack branching (StackBranch + Closure classes) is necessary to handle this correctly.
>>> render("<:A ~ f>$f()</:A> <:B x> <:H>$x</:H><A $H/> </:B> <B>ala</B>")
'   ala '

Recursion becomes possible when hypertags are being passed as values. 
>>> render("<:A ~ h>$h(h)</:A> <A $A/>")   # doctest: +IGNORE_EXCEPTION_DETAIL
Traceback (most recent call last):
    ...
HypertagsError: Can't evaluate expression at line 1, column 10 (h(h)) because of RuntimeError: maximum recursion depth exceeded


*** Special elements: no-parse blocks, escape strings.

HyperML comments and escape strings.
>>> render("[# inside comment #] $[# outside comment $#] $< $> $$ $[[ $|| $]] $[= $=]")
' [# outside comment #] < > $ [[ || ]] [= =]'

HyperML no-parse blocks.
>>> render("one [= two =] three")
'one  two  three'
>>> render("one [= [[<if $false>unparsed</if>||two]] =] three")
'one  [[<if $false>unparsed</if>||two]]  three'
>>> render("one [[<if $false>unparsed</if>||two]] three")
'one two three'


*** Variant & conditional elements.

Simple variants.
>>> render("[[ala ma $$ $[[ $|| <$| <kota/>]] [[||]]")
'ala ma $ [[ || <$| <kota /> '
>>> render("<:A ~ x y>[[ $x || $y ]]</:A> <A y='y'/>")
'  y '

Variant inside hypertag definition.
>>> render("<:A ~ x>[[ala ma $|| <$| <kota/>]] [[||]]</:A> <A/>")
' ala ma || <$| <kota /> '
>>> doc = HyperML("<:A ~ x y>[[ $x || $y ]]</:A>  <:user ~ name surname>[[ $surname[[, $name]] || $name || <i>anonymous</i> ]]</:user>")
>>> doc.A(x = ''), doc.A(y = 'y')
('  ', ' y ')
>>> doc.user(name = "John"), doc.user(surname = "Smith")
(' John ', ' Smith ')
>>> doc.user(name = "John", surname = "Smith"), doc.user()
(' Smith, John ', ' <i>anonymous</i> ')

Hypertag occurence inside variant block.
Null values must not appear in the literal occurence of a hypertag (in occurence body or on attributes list),
but they can still appear in hypertag definition body.
>>> render("<:user name surname>$surname, $name</:user>[[<user 'John' />]]", explicit_body_var=0)
', John'
>>> render("<:user ~ name surname>$surname, $name</:user>[[<user 'John' />]]")
', John'
>>> render("<:user ~ name surname>$surname, $name</:user>[[<user 'John' $null />]]")
''
>>> render("<:H ~ x>x=$x</:H> <:A ~ x> [[ x is missing: <H x=$x /> || second]] </:A> <A/>")
'    second '

Hypertag definition inside variant block. Behaves exactly the same as if it were located outside the block:
null values are allowed within the definition body and don't affect rendering of the block.
>>> render("[[<:user ~ name surname>$surname, $name</:user><user 'John' 'Smith' />]]")
'Smith, John'
>>> render("[[<:user ~ name surname>$surname, $name, $null</:user><user 'John' />]]")
', John, '

TODO: if a hypertag definition located in a variant block references a variable from outside the block
and this variable is null in a given expansion, such a definition might possibly expand to invalid markup (raise NullValue).
However, this is not that important, let's leave it for deeper investigation in the future.
>>> render("<:A x>[[<:user ~ name>$name, $x</:user><user 'John' /> || hypertag not defined]]</:A> <A/>")
' John,  '

If-then-ELSE using <if> inside [[...]]
>>> doc = HyperML("<:A x>[[<if $x> first </if>|| second ]]</:A>")
>>> doc.A(x = 'true')
' first '
>>> doc.A(x = '')
' second '

Variant containing <for> with null argument. -- CHANGED semantics. Now this example raises an exception, instead of returning: u'  pass '
>>> render("<:A ~ items>[[ <for x=$items[:3]>item</for> || pass ]]</:A> <A/>", compact = False)
Traceback (most recent call last):
    ...
HypertagsError: Can't evaluate attribute at line 1, column 21 (x=$items[:3]) because of TypeError: 'NoneType' object is not subscriptable

Null value.
Explicit $null inside variant block behaves like every other null value: invalidates a given choice.
>>> render("$null <a href=$null/> [[ $null || <b val=$null/> || last]]")
' <a href="" />  last'

Explicit $null used inside variant block: 
if inside an expression that returns a non-null value/contents overall, the branch can still be rendered.
>>> render("[[ $(null is null) <if $(null is null)> first </if> || second ]]")
' True  first  '
>>> render("[[ <if $true else=$null> first </if> || second ]]")
' second '
>>> render("[[ <if $true> first </if> || second ]]")
'  first  '

(NOT TRUE). In expressions inside [[...]], null value propagates up the tree through all operators 
where null doesn't make sense and would raise an exception otherwise.
> > > render("[[$('/' + null) $(null * 5) $(-null | split)]]")
''
> > > render("[[ $(null[3](3).three * 3 / 3 // 3 % 3 + 3 - 3 '3' >> 3 << 3 & 3 ^ 3 | 3) ]]")
''

Conditional hypertags.
>>> render("<if $null else='else'>then</if> <ifnull $null>yes-null</ifnull> <ifnull '' else=$('not-null') />")
'else yes-null not-null'
>>> doc = HyperML("<:A seq><ifnot $seq else=$str(seq)> sequence is empty </ifnot></:A>")
>>> doc.A([])
' sequence is empty '
>>> doc.A([3,4,5])
'[3, 4, 5]'
>>> doc = HyperML("<:A seq><if $seq else='sequence is empty'> $seq </if></:A>")
>>> doc.A([])
'sequence is empty'
>>> doc.A([3,4,5])
' [3, 4, 5] '

Lazy evaluation of conditional hypertags.
>>> def f(): print('f')
>>> render("<if $false>$f()</if>", globals = {'f': f})
''
>>> render("<ifnot $true>$f()</ifnot>", globals = {'f': f})
''
>>> render("<ifnull 'ala'>$f()</ifnull>", globals = {'f': f})
''


*** Null value in expressions

Null value outside variant blocks behaves like '' in concatenation operator, but is evaluated normally (like Python's None) with other operators.
>>> render("$('/' null '/')")
'//'
>>> render("$(null + 5)")
Traceback (most recent call last):
    ...
HypertagsError: Can't evaluate expression at line 1, column 3 (null + 5) because of TypeError: unsupported operand type(s) for +: 'NoneType' and 'int'

Null in concatenation raises NullValue (terminates all node rendering) if inside a variant block, also when inside a function.
-- CHANGED SEMANTICS. Now, null propagates through expressions, as a valid argument of functions and operators; in concatenation behaves like "".
   Nullity inside [[...]] is checked only at the end, for the entire expression. 
>>> def quoted(s): return "`%s`" % s
>>> render("$quoted('ala' 'ma' 'kota')", globals = {'quoted':quoted})
'`alamakota`'
>>> render("$quoted('ala' 'ma' x)", globals = {'quoted':quoted, 'x':None})
'`alama`'
>>> render("[[$quoted('ala' 'ma' x)]]", globals = {'quoted':quoted, 'x':None})
'`alama`'
>>> render("$quoted(x)", globals = {'quoted':quoted, 'x':None})
'`None`'
>>> render("[[$quoted(x)]]", globals = {'quoted':quoted, 'x':None})
'`None`'

Filter functions marked explicitly as @Filter propagate null values automatically, without explicit handling in the function code.
The propagated null result can influence rendering of neighboring elements if inside a variant block.
>>> quoted = Filter(lambda s, rep=1 : ("`"*rep + "%s" + "`"*rep) % s)
>>> render("$('ala' | quoted) $('ola' | quoted(3))", globals = {'quoted':quoted})
'`ala` ```ola```'
>>> render("$(null | quoted) kot $(null | quoted(3))", globals = {'quoted':quoted})
' kot '
>>> render("[[$(null | quoted) kot $(null | quoted(3))]]", globals = {'quoted':quoted})
''

Plain function in a filter operator receives and processes null values normally, like every other value, unless inside a variant block.
-- CHANGED SEMANTICS. Now, null propagates through expressions, as a valid argument of functions and operators.
   Nullity inside [[...]] is checked only at the end, for the entire expression. 
>>> def quoted(s): return "`%s`" % s
>>> render("$(null | quoted)", globals = {'quoted':quoted})
'`None`'
>>> render("[[$(null | quoted)]]", globals = {'quoted':quoted})
'`None`'
>>> render("[[$fun(null | quoted)]]", globals = {'quoted':quoted, 'fun':lambda s:'fun-'+s})
'fun-`None`'

Using an alternative hypertag definition syntax, with colon ":" following not preceeding a hyperag name in the opening tag
>>> render("<H:>kot</:H><H/>")
'kot'

Embedding of a variable that renders to a Text()  of type "HyML" or exposes __hyml__ method.
>>> hyml = HyML("<H/>")
>>> render("<H:>hypertag embedded through external variable</:H>$hyml", globals = {'hyml': hyml})
'hypertag embedded through external variable'

*** Bug fixes.

Reserved symbols can be a prefix of a variable name.
>>> render("<:A ~ issn input notify ifa aif>$(issn input) $notify $ifa$aif</:A> <A 'a' 'b' 'c' 'd' 'e'></A>")
' ab c de'

Compactification of an inner hypertag using internally a top-level hypertag caused assertion error related to "access link" calculation.
>>> render("<:A text>$text</:A> <:B> <:C><A>ala</A></:C> <C></C> </:B> <B></B>")
'    ala '


@author:  Marcin Wojnarski

"""

import sys, re, operator
from copy import copy
from collections import OrderedDict
from importlib import import_module
from xml.sax.saxutils import quoteattr
from parsimonious.grammar import Grammar
from six import reraise, string_types, text_type as unicode
basestring = string_types[0]

from nifty.util import escape, flatten, isstring, isint, isfunction, asnumber, getattrs, printdict, ObjDict, Timer
from nifty.text import html_escape, html_unescape, Text, HyML
from nifty.parsing.parsing import ParsimoniousTree as BaseTree, ParserError


# Public symbols. When using "from fireweb.hypertags import *" only these symbols will be imported, all others are for internal use of the module:

__all__ = "HyperML hypertag Filter FilterWith parse render HypertagsError UndefinedVariable".split()


########################################################################################################################################################
###
###  UTILITIES
###

class HypertagsError(ParserError):
    def make_msg(self, msg):
        if self.pos and self.node and self.node.tree.filename:
            return msg + " in '%s', line %s, column %s (%s)" % (self.node.tree.filename, self.line, self.column, self.text)
        if self.pos:
            return msg + " at line %s, column %s (%s)" % (self.line, self.column, self.text)

class UndefinedVariable(HypertagsError):
    pass

class NullValue(HypertagsError):
    """
    Null value was encountered during rendering of a node or evaluation of an expression.
    This exception is used to communicate null (None) values back to higher-level nodes during rendering
    and can be caught by xvariant node to choose the right variant from among multiple choices.
    Or, if raised by an expression, it can substitute TypeError for communicating a disallowed use 
    of None value as an operand - in such, the exception can be passed all the way up to the client.
    """
    def __init__(self, msg = "Null value encountered during rendering of a node"):
        Exception.__init__(self, msg)
    

def _addFirst(name, item, orddict):
    "Add name:item pair to the beginning of OrderedDict 'orddict'. New OrderedDict is created and returned."
    assert name not in orddict
    d = OrderedDict([(name, item)])
    for name, attr in orddict.items(): d[name] = attr
    return d


########################################################################################################################################################

class Stack(list):
    """Stack implementation based on list."""
    
    @property
    def size(self):
        return len(self)
    @size.setter
    def size(self, _size_):
        del self[_size_:]

    push     = list.append
    pushall  = list.extend
    get      = list.__getitem__
    set      = list.__setitem__
    position = list.__len__

    def reset(self, state):
        "If anything was added on top of the stack, reset the top position to a previous state and forget those elements."
        # if len(self) < state: raise Exception("Stack.reset(), can't return to a point (%s) that is higher than the current size (%s)" % (state, self.size))
        del self[state:]
        

class MultiDict(object):
    """
    An ordered multi-dictionary with push/pop operations. Or, in other words, a stack of (name,value) pairs that additionally 
    keeps a dict of the names and their most recent values, for fast name lookup.
    Each element of the stack keeps also an index of the previous element with the same name,
    to enable pop() implementation that replaces a dictionary value of a given name with its previous value. 
    
    >>> md = MultiDict()
    >>> md.push('a', 123); md.push('b', 321); md.push('a', 9)
    >>> md.pop()
    ('a', 9)
    >>> md['a']
    123
    >>> md.push('b', 456); md.push('b', 654)
    >>> md.reset(md.getstate() - 2)
    >>> md['b']
    321
    """
    
    stack = None            # Stack object; elements are triples of the form: (name, value, index_of_previous)
    lookup = None           # {name: index} dict of current names and their most recent positions in the stack
        
    def __init__(self, maxlen = 10):
        self.stack = Stack()
        self.lookup = {}
    
    def __contains__(self, name):
        return name in self.lookup
    def __getitem__(self, name):
        "Current value assigned to 'name'."
        idx = self.lookup[name]
        return self.stack[idx][1]
    def get(self, name, default = None):
        idx = self.lookup.get(name, None)
        if idx is None: return default
        return self.stack[idx][1]
    
    def keys(self): return self.lookup.keys()
    def values(self):
        for i in self.lookup.values(): yield self.stack[i][1]
    def items(self):
        for k in self.lookup.keys(): yield k, self[k]
        
    def push(self, name, value):
        prev = self.lookup.get(name, None)
        self.lookup[name] = self.stack.size
        self.stack.push((name, value, prev))
        
    def pop(self):
        "Pop the top element of the stack and return as a (name, value) pair, with proper update of the lookup dictionary."
        top = self.stack.pop()
        name, value, prev = top
        if prev is None: del self.lookup[name]
        else: self.lookup[name] = prev
        return (name, value)
    
    def pushall(self, items):
        "A repeated push(), of all items in the name->value dictionary 'items'."
        for name, value in items.items():
            self.push(name, value)

    def reset(self, state):
        "Do the same as a repeated pop() would do, but a bit more efficiently."
        size = self.stack.size
        if size < state: raise Exception("MultiDict.reset(), can't return to a point (%s) that is higher than the current size (%s)" % (state, size))
        for i in range(size-1, state-1, -1):
            name, _, prev = self.stack[i]
            if prev is None: del self.lookup[name]
            else: self.lookup[name] = prev
        self.stack.size = state

    def asdict(self, state = 0):
        "Return all current elements as an OrderedDict. If state is given, only the elements pushed since 'state' are returned."
        rng = range(state, self.stack.size)
        return OrderedDict((name, value) for name, value, _ in [self.stack[i] for i in rng])

    def getstate(self):
        return self.stack.size
    
    def __unicode__(self): return unicode(self.lookup)
    def __repr__(self): 
        items = [(repr(self.stack[i][0]), self.stack[i][1]) for i in sorted(self.lookup.values())]
        return "{%s}" % ', '.join("%s: %s" % item for item in items)


# class Frame(object):
#     """Activation frame. A list of actual values of hypertag/function arguments, plus values of local variables. 
#     Parent-linked to the caller's activation frame and linked through *access link* to the frame of the immediate lexical encapsulating hypertag.
#     Through the parent link, frames create an *activation list*, a counterpart of a stack in traditional runtime implementations. 
#     Activation list enables easy creation of a parent-pointer-tree for representation of execution of closures (hypertags passed as variables):
#     https://en.wikipedia.org/wiki/Parent_pointer_tree
#     """
#     name = None             # name of the hypertag that created this frame, for debugging
#     
#     vars = []               # the fixed stack of variables' values
#     parent = None
#     accesslink = None


class StackBranch(object):
    """A stack that exposes Stack interface, but internally consists of 2 disjoint parts, each one being a Stack object:
    1) the "lower" Stack or StackBranch object (the "trunk") containing stack of a fixed length - can only be used for read access;
    2) the "upper" Stack object (the "branch") that initially has 0 length, but can grow and shrink like any regular Stack
    StackBranch is used in Closure implementation.
    """
    def __init__(self, lower):
        self.lower = lower
        self.upper = Stack()
        self.lowersize = self.lower.size
        
    ### all Stack methods delegated to the appropriate Stack object...
        
    def push(self, x):
        self.upper.push(x)
    def pop(self):
        return self.upper.pop()
    def pushall(self, elems):
        self.upper.pushall(elems)
                
    def __getitem__(self, pos):
        if pos < self.lowersize:
            return self.lower[pos]
        return self.upper[pos - self.lowersize]
    def get(self, pos):
        if pos < 0:
            pos += self.lowersize + self.upper.size
        return self[pos]
    def set(self, pos, val):
        # transform 'pos' to a positive index in the 'upper' stack
        if pos < 0:
            upos = pos + self.upper.size
        else:
            upos = pos - self.lowersize
        if upos < 0:
            raise Exception("StackBranch.set(), can't modify an element (#%s) that's located on the trunk (size %s)" % (pos, self.lowersize))
        self.upper.set(upos, val)
    
    def position(self):
        return self.lowersize + self.upper.size
    def reset(self, state):
        "If anything was added on top of the stack, reset the top position to a previous state and forget those elements."
        size = self.lowersize + self.upper.size
        if state > size:
            raise Exception("StackBranch.reset(), can't return to a point (%s) that is higher than the current size (%s)" % (state, size))
        if state < self.lowersize:
            raise Exception("StackBranch.reset(), can't return to a point (%s) that is located on the trunk (size %s)" % (state, self.lowersize))
        self.upper.reset(state - self.lowersize)
    
    def __repr__(self): 
        return repr(self.lower) + '/' + repr(self.upper)

    
class Closure(object):
    """
    Frozen hypertag expansion, created when a hypertag is passed as a variable for later execution: $H ... $fun(H). 
    Closure keeps the stack as was present at the point of closure creation, to pass it to the hypertag's expand()
    even if the original stack has changed before the point of expansion.
    Note that in HyperML, hypertags can only be passed downwards through the chain of hypertag expansions or function calls, 
    not upwards, so the stack can only grow, never shrink, before the closure execution point, and consequently
    all the frames that the closure needs are still on the stack. However, the closure may need to extend the stack in its own way
    starting from the stack position from the point of closure creation, which would override the frames added between closure creation
    and execution. To avoid this, we have to implement *stack branching*, done by temporary re-mapping of stack indices
    to "hide" a part of the stack without its physical removal. The hidden part can be unhidden in constant time, and there can be many
    overlapping parts hidden at the same time (happens when a chain of several closures are executed).
    """
    ishypertag = None       # the HypertagSpec
    hypertag = None         # the xhypertag node to be expanded when the request comes
    stack = None            # current stack from the point of closure creation
    occurDepth = None       # call depth at the point of closure creation
    
    def __init__(self, hypertag, stack, occurDepth):
        self.ishypertag = hypertag.ishypertag
        self.hypertag = hypertag
        self.occurDepth = occurDepth
        self.stack = StackBranch(stack)
        #self.stack = stack.copy()
     
    def definition(self): return self.hypertag.definition()
     
    def expand(self, unnamed, kwattrs, caller = None):
        # now we use the recorded stack and depth from the place of closure creation, instead of the ones from the point of expansion
        return self.hypertag.expand(unnamed, kwattrs, self.stack, self.occurDepth, caller)
        

class LazyVariable(object):
    """
    A variable whose value calculation is delayed until the first use.
    If the variable is never used, its value won't be calculated at all.
    The value is calculated from a "value function" set during initialization and
    should be retrieved with getvalue() method. Repeated calls to getvalue() return 
    the same value as calculated on the 1st call, without further re-calculation.
    """
    def __init__(self, fun):
        self.fun = fun          # no-arg "value function"; will be called to calculate the actual value of the variable
        self.value = None
        self.hasvalue = False
        #self.getvalue()

    def getvalue(self):
        if not self.hasvalue:
            self.value = self.fun()
            self.hasvalue = True
        return self.value

lazyEmptyString = LazyVariable(lambda: '')
lazyEmptyString.getvalue()

    
########################################################################################################################################################
###
###  EXTERNAL HYPERTAGS & FILTERS
###

class HypertagSpec(object):
    """
    Properties of hypertags when defined as functions:
    - void / non-void - body attribute should be passed in as the 1st argument or not?
    - with / without a backlink to the containing HyperML document (TODO)
    """
    void     = False    # if True, the hypertag does NOT accept a body attribute and it must always be used without body: <H.../> or <H...></H>
    lazybody = False    # if True, the body attribute should be passed as a LazyVariable instead of a pre-rendered string;
                        # the LazyVariable object must be handled appropriately in the function code, with calls to getvalue() where necessary
    backlink = False    # (TODO) if True, the HyperML document of this hypertag's occurence (call) is passed in the keyword argument 'hyperdoc'
                        # to give the function access to global parser settings, like the target language, encoding configuration etc.

    def __init__(self, **params):
        for name, val in params.items():
            if not hasattr(self, name):
                raise Exception("Unrecognized parameter passed to HypertagSpec: %s" % name)
            setattr(self, name, val)
    

def hypertag(fun):
    "Decorator that marks a given function as a hypertag (standard one: non-void, without backlink)."
    fun.ishypertag = HypertagSpec()
    return fun

# def hypertag_void(fun):
#     "Decorator that marks a given function as a VOID hypertag - one that doesn't accept the 1st special attribute 'body'."
#     fun.ishypertag = HypertagSpec(void = True)
#     return fun

def special_hypertag(**translation):
    """A decorator like @hypertag, but additionally performs translation of attribute names of the hypertag function, 
    so that the resulting function can handle names that are reserved words in Python.
    The translation is given as a list of keyword arguments named after translated attributes: python_name = 'HyperML_name'
    """
    def decorator(fun):
        def translated(*args, **kwargs):       # a function like 'fun', but with some attribute names translated
            for dst, src in translation.items():
                if dst in kwargs: raise TypeError("hypertag function '%s' got an unexpected keyword argument '%s'" % (fun.__name__, dst))
                if src not in kwargs: continue
                kwargs[dst] = kwargs[src]
                del kwargs[src]
            return fun(*args, **kwargs)
        return hypertag(translated)
    return decorator


class Filter(object):
    """
    A wrapper and a decorator that creates a Filter instance to replace a given function:
    * fun = Filter(lambda ...)
    * @Filter 
      def fun(...): ...

    In HyperML, in general, a filter is an object of Filter class. The function call syntax - f(...) - used to a filter object 
    always means parameterization, never a real function call.  Only '|' invokes a real function call.
    However, 1-arg functions  can be used as filters (unparameterized) directly, 
    without wrapping in a Filter class: x | f.

    A filter object 'f' behaves like a function with a special call protocol:
    - f(...) passes parameters to the filter, which are stored for later use in a call
    - x|f or x|f(...) - makes the actual call of 'f', with 'x' passed as the 1st argument
         and the (...) parameters passed as subsequent arguments.

    By default, if x=None, the filter automatically returns None without passing the value to the underlying function.
    This can be changed by setting propagate_null property of the filter to False.
    """
    fun = None                  # the filter function, fun(arg, params...); if None, self.apply() is called
    params = None               # unnamed parameters for fun()/apply()
    kwparams = None             # keyword parameters for fun()/apply()
    
    parameterized = True        # if True, self(...) call means parameterization of the filter; otherwise, self(...) is another way to
                                # apply the filter, as a regular function
    propagate_null = True       # if True, when the null (None) value is passed to the filter, it's automatically propagated to the output,
                                # so that the filter function fun/apply doesn't have to worry about None's
    
    def __init__(self, fun, parameterized = True, propagate_null = True, *params, **kwparams):    
        self.fun = fun
        self.params = params
        self.kwparams = kwparams
        self.parameterized = parameterized
        self.propagate_null = propagate_null
    
    def __call__(self, *params, **kwparams):                                    # in expression:  ... | fun(params)
        """If self.parameterized=True, sets parameters of the filter and creates a new Filter instance 
        to allow multiple re-use of the initial (abstract) filter object, with different parameterizations.
        Otherwise, calls the filter function with the arguments and parameters passed here only.
        """
        if self.parameterized:
            return Filter(self.fun, self.parameterized, self.propagate_null, *params, **kwparams)
        f = self.fun or self.apply
        return f(*params, **kwparams)
    
    def __ror__(self, arg):                                                     # in expression:  arg | ...
        if arg is None and self.propagate_null: return None
        return self.apply(arg, *self.params, **self.kwparams)
    
    def apply(self, arg, *params, **kwparams):
        """Direct call of the wrapped function, with all arguments/params passed at once.
        You can override this method if you sublass Filter and want to provide an alternative 
        implementation of the filter function.
        """
        return self.fun(arg, *params, **kwparams)


def FilterWith(**settings):
    """A decorator like Filter, but allows passing additional settings to the Filter class:
    * @FilterWith(hypertag = True, parameterized = False)
      def myFun(...): ...
    """
    def wrapper(fun): return Filter(fun, **settings)
    return wrapper


########################################################################################################################################################
###
###  BUILT-IN HYPERTAGS, FILTERS & VARIABLES
###

###  Special hypertags

@special_hypertag(else_ = 'else')
def if_(body = lazyEmptyString, condition = None, then = None, else_ = None):
    "Signature inside HyperML: if(body = '', condition = None, then = None, else = None)"
    if condition:
        return then if then is not None else body.getvalue() 
    return else_

@special_hypertag(else_ = 'else')
def ifnot(body = lazyEmptyString, condition = None, then = None, else_ = None):
    "Signature inside HyperML: ifnot(body = '', condition = None, then = None, else = None)"
    if not condition:
        return then if then is not None else body.getvalue() 
    return else_

@special_hypertag(else_ = 'else')
def ifnull(body = lazyEmptyString, value = None, then = None, else_ = None):
    "Signature inside HyperML: ifnull(body = '', value = None, then = None, else = None)"
    if value is None:
        return then if then is not None else body.getvalue() 
    return else_

# in all conditional hypertags, the body attribute must be evaluated in a lazy fashion,
# so that we don't try to render the body when the condition is false 
# (and possibly an attempt to render the body would raise an exception, not to mention efficiency issues)
if_.ishypertag.lazybody = True
ifnot.ishypertag.lazybody = True
ifnull.ishypertag.lazybody = True
    

# ###  If Jinja2 is available, import all Jinja2 standard filters and wrap up in Filter class to work with HyperML.
# ###  If Jinja2 is not installed, leave the 'jinja_filters' dict empty. 
# 
# jinja_filters = {}
# try:
#     from jinja2.filters import FILTERS as _jFILTERS
#     jinja_filters = {k: Filter(v) for k, v in _jFILTERS.items()}
# except:
#     pass


### Standard hypertags & filters (most of them can be used BOTH as a hypertag and a filter)

from six.moves import builtins as __builtin__
from six.moves.urllib.parse import quote

def HTML(s):
    "Marks a given string as HTML-encoded (or HTML-safe), to avoid auto-encoding when the string gets embedded in markup."
    return Text(s, "HTML")

@hypertag
def split(text): return text.split()

@hypertag
@Filter
def splitlines(text, strip = True): 
    lines = text.splitlines()
    if strip: lines = list(filter(None, [line.strip() for line in lines]))
    return lines

@hypertag
def strip(text): return text.strip()

@hypertag
@Filter
def join(seq, sep = Text(u''), cast = None):
    """
    If 'seq' is a string, it's split on line boundaries, each line stripped and then non-empty lines joined.
    If 'cast' is given, all input items are first mapped through cast(), only than joined. In such case,
    the resulting string has no language declared, even if original items had some language specified.
    If 'plain' is not False (it's True, '' or anything else), the resulting Text is unescaped 
    if in the document's target language.
    
    Usage in HyperML:
    1) seq|join ... seq|join{params}
    2) <join> line... line... </join>
    """
    if not isinstance(sep, Text): sep = Text(sep)
    if isinstance(seq, basestring): seq = seq.split()
    if cast is not None: seq = map(cast, seq)
    return sep.join(seq)

@hypertag
@Filter
def joinlines(text, sep = Text(u''), strip = True):
    """
    Split given text on line boundaries, strip each line and remove the empty ones if strip=True, 
    and join the remaining ones with a given separator.
    """
    if not isinstance(sep, Text): sep = Text(sep)
    lines = text.splitlines()
    if strip:
        lines = filter(None, [line.strip() for line in lines])
    return sep.join(lines)

@hypertag
def list_(text, sep = None, strip = True, cast = None):
    """
    Split given text and return as a list (non-string type!) of strings or items (if 'cast' type is given).
    'sep' tells where to split the text and is one of ("blocks", "lines", "words", "chars")
    or a separator string that should be passed to string's split() method.
    If sep=None, either "lines" or "words" mode is used, depending on whether 'text'
    contains a newline character or not. 
    In the "blocks" mode (TODO), an empty (whitespace-only) line is the item separator.
    NOTE: if used inside a hypertag, <list>...</list> must be the ONLY element in this hypertag,
    without ANY surrounding markup, even whitespace, otherwise an exception will be raised
    caused by an attempt to add a list to a string.
    """
    if sep is None: sep = "lines" if '\n' in text else "words"
    if   sep == "lines": items = splitlines.apply(text, strip = strip)
    elif sep == "words": items = split(text)
    elif sep == "chars": items = list(text)
    else:
        items = text.split(sep)
        if strip: items = list(filter(None, [item.strip() for item in items]))
    
    if cast is not None: items = list(map(cast, items))
    return items


def _quote1(x): return quote(unicode(x).encode('utf-8'), safe='/')      # URL quoting, all special chars escaped except '/'
def _quote2(x): return quote(unicode(x).encode('utf-8'), safe='')       # URL quoting, all special chars escaped
    
def url(start = u'', *parts, **query):
    """Build a URL (full) or URL query string from parts: a static string 'start' (no quoting), 
    followed by 'parts' (all special chars quoted except for '/'), followed by a key=value query string 
    built from 'query' (key & value strings fully quoted, including '/').
    Components that contain None values (in 'parts', 'query') are automatically excluded from the result,
    like if each of them were placed inside a variant block (variant blocks are not allowed in expressions, 
    on arguments list of a function, that's why None handling is implemented here in the function code).
    """
    parts = u''.join(_quote1(p) for p in parts if p is not None)
    query = u'&'.join(_quote2(k) + '=' + _quote2(v) for k, v in query.items() if v is not None)
    return start + parts + ('?' + query if query else '')
    

def comma000(x):
    "Format a given number with thousands comma ',' between every 3 digits."
    return '{0:,}'.format(x)


BUILT_IN = {
    # variables (not callable)
    'python':       __builtin__,    # Python's all standard symbols, accessible through python.* even if a given symbol has different meaning in HyperML 
    
    'true':         True,           # $true
    'false':        False,          # $false
    'null':         None,           # $null -- null value
    'newline':      '\n',           # $newline -- needed because in literal strings inside HTML attributes there's no way to put \n, except for making explicit line break
    
    # functions (callable)
    'str':          unicode,        # $str(var) -- string representation of an object, always in Unicode
    'len':          len,            # $len(s)
    'range':        range,
    
    'url':          url,
    
    # hypertags (callable and usable as tags: <H...>)
    'list':         list_,          # <list> item1 item2 ...</list>
    
    'if':           if_,
    'ifnot':        ifnot,
    'ifnull':       ifnull,

}

FILTERS = {
    'HTML':         HTML,
    'split':        split,
    'splitlines':   splitlines,
    'strip':        strip,
    'join':         join,
    'joinlines':    joinlines,
    #'e':        Filter(_jFILTERS['e'], parameterized = False)
    
    'comma000':     comma000,
}


########################################################################################################################################################
###
###  GRAMMAR & PARSER
###

# Grammar for a Parsimonious parser. Actually a template that needs to be formatted with a few additional parameters (see below).
# See: https://github.com/erikrose/parsimonious
grammar_spec = r"""

# Tagged text is a flat sequence of markup (tags, variables/functions, variants) mixed with plain text.
# Full markup elements (open+close tag) and their nesting structure is reconstructed during semantic analysis,
# because proper (and error-resistant) pairing of start tags with their corresponding end tags can only be done at semantic level.

document    =  (markup / text)*

markup      =  noparse / noparse_hyml / comment / tag / variant / escape / value
text        =  ~".[^<$[]*"s                  # plain text is a 1+ sequence of any chars till the next special symbol '<$['. Can begin with a special symbol if no other rule can be matched

#value_in_markup = value


###  BASIC TOKENS

space       =  ~"\s+"                        # obligatory whitespace; can include newline
ws          =  space?                        # optional whitespace; can include newline

def         =  ':'                           # tag name prefix that starts hypertag definition
eval        =  '$'                           # special symbol denoting expression evaluation
lt          =  '<'                           # special symbols for tags ...
gt          =  '>'
slash       =  '/'
void        =  '~'                           # void marker in hypertag's opening tag: <:htag ~ ...>

ident       =  ~"[%s][%s]*"                      # [XML_StartChar][XML_Char]* -- names of tags and attributes as used in XML, defined very liberally, with nearly all characters allowed, to match all valid HTML/XML identifiers, but not all of them can be used as hypertag/variable names
var_id      =  !reserved ~"[a-z_][a-z0-9_]*"i    # names of variables/hypertags/attributes that can appear in expressions; a much more restricted set of names than 'ident', to enable proper parsing of operators and mapping of the names to external execution environment
reserved    =  ~"(if|else|is|in|not|and|or)\\b"  # names with special meaning inside expressions, can't be used for variables; \\b is a regex word boundary and is written with double backslash bcs single backslash-b is converted to a backspace by Python


###  EXPRESSIONS

# atoms: string, number, variable, sub-expression ...

str1         =  ~'"[^"]*"'                   # "string", may contain entities: &apos; &quot; &amp; (others left undecoded!)
str2         =  ~"'[^']*'"                   # 'string', may contain entities: &apos; &quot; &amp; (others left undecoded!)
str_unquoted =  !'$' ~"[^\s\"'`=<>]+"        # in attributes only, for HTML compatibility; see https://html.spec.whatwg.org/multipage/syntax.html#syntax-attributes
#string      =  regex.escaped_string

number       =  ~"((\.\d+)|(\d+(\.\d*)?))([eE][+-]?\d+)?"      # like nifty.text.regex.float regex pattern, only without leading +-
literal      =  number / str1 / str2

var          =  eval? var_id                 # occurence (use) of a variable; trailing '' to work around Parsimonious bug of reducing non-terminals equal to another non-terminal
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
value        =  eval expr_markup                  # $x, $x.y[z], $f(x), $(...), $(...).x[y](z)

escape       =  eval ('$' / '<' / '>' / '[[' / '||' / ']]' / '[#' / '#]' / '[=' / '=]')


###  LISTS OF ATTRIBUTES & ARGUMENTS

# Here, like in HTML, tags can have attributes without values, equiv. to attr=""; on the other hand, strings must always be quoted (other types not).
# Additionally, unlike in HTML, values (unnamed) are allowed as arguments instead of attributes (named) - like in typical programming.

# attributes inside a tag: space-separated, embedded expressions ($...), any XML-compatible names, names can go without values

value_attr_common  =  literal / value
value_attr         =  value_attr_common / str_unquoted
value_attr_named   =  value_attr
value_attr_unnamed =  value_attr_common

kwattr      =  ident (ws '=' ws value_attr_named)?      # HTML syntax: name OR name="value" OR name=value ... HyperML syntax: name=$(...)
attr        =  kwattr / value_attr_unnamed              # 2nd and 3rd options are for unnamed attributes (HyperML syntax)

#value_attr  =  value / literal / str_unquoted
#kwattr      =  ident (ws '=' ws value_attr)?          # HTML syntax: name OR name="value" OR name=value ... HyperML syntax: name=$(...)
#attr        =  kwattr / value / literal               # 2nd and 3rd options are for unnamed attributes (HyperML syntax)
attrs       =  attr (space attr)*


# arguments inside a function call: comma-separated, expressions in abstract form (no $), only regular names, names must have values assigned

kwarg       =  var_id ws '=' ws expr
arg         =  kwarg / expr
args        =  arg (ws ',' ws arg)*


###  TAGS & ELEMENTS

tag_name_end   =  (def var_id) / ident
tag_name_start =  (var_id def) / tag_name_end

tag_name     =  (def var_id) / (var_id def) / ident
tag_core     =  (space attrs)? ws
tag_namecore =  lt tag_name_start (space void)? tag_core

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

# plain text inside variant elements: a 1+ sequence of any chars until the 1st '||', ']]' or a special symbol '<$['. Can begin with a special symbol if no other rule can be matched
# regex: 1 char that doesn't start || nor ]], followed by 0+ non-special chars that don't start || nor ]]
text_variant =  ~"(?!\|\|)(?!\]\]).((?!\|\|)(?!\]\])[^<$[])*"s

choice       =  (markup / text_variant)*
variant      =  '[[' choice ('||' choice)* ']]'

"""


# Regex patterns for character sets allowed in XML identifiers, to be put inside [...] in a regex.
# XML identifiers differ substantially from typical name patterns in other computer languages. Main differences: 
#  1) national Unicode characters are allowed, specified by ranges of unicode point values
#  2) special characters are allowed:  ':' (colon) '.' (dot) '-' (minus)
#     Colon is allowed as the 1st character according to XML syntax spec., although such a name may be treated as malformed during semantic analysis.
#     Others (dot, minus), are allowed on further positions in the string, after the 1st character.
# Specification: http://www.w3.org/TR/REC-xml/#NT-NameStartChar

# human-readable:  [:_A-Za-z] | [\u00C0-\u00D6] | [\u00D8-\u00F6] | [\u00F8-\u02FF] | [\u0370-\u037D] | [\u037F-\u1FFF] | [\u200C-\u200D] | [\u2070-\u218F] | [\u2C00-\u2FEF] | [\u3001-\uD7FF] | [\uF900-\uFDCF] | [\uFDF0-\uFFFD] | [\U00010000-\U000EFFFF]
XML_StartChar  =  u":_A-Za-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD\U00010000-\U000EFFFF"

# human-readable:  XML_StartChar | [0-9.\u00B7-] | [\u0300-\u036F] | [\u203F-\u2040]
XML_Char       =  XML_StartChar + u"0-9.\-\u00B7\u0300-\u036F\u203F-\u2040"

# Template of the no-parse rules to be injected into the grammar:
#                noparse_script =  ~"<script"i tag_core ~">((?!</script\s*>).)*</script\s*>"i
noparse_rule = r'noparse_%s     =  ~"<%s"i tag_core ~">((?!</%s\s*>).)*</%s\s*>"is'


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


class Context(MultiDict):
    "Context data passed through a HyperML syntax tree during semantic analysis."
    
    depth = 0               # current depth of nested hypertag definitions during analyse()
    ref_depth = None        # the top-most (minimum as a value) def-depth of a non-pure variable or hypertag referenced inside the current subtree;
                            # this value is passed bottom-up through the tree, from inner nodes (variable occurences) 
                            # to outer nodes (hypertag def-nodes); def-depth = -1 indicates an external non-pure variable/hypertag
    
    def add_refdepth(self, d, symbol = None):
        """Update self.ref_depth with the depth of one more definition of a variable/hypertag.
        'symbol': optional name of the variable/hypertag being referenced, for debugging.
        """
        if d is None: return                            # special case, for adding back initial ref_depth value, which can be None
        if self.ref_depth is None:                      # when ref_depth is still uninitialized, just use 'd'
            self.ref_depth = d
        else:                                           # otherwise, use 'd' if it's lower than the current value
            self.ref_depth = min(self.ref_depth, d)
        #if DEBUG: print(' ', symbol or '', d, 'ref_depth =', self.ref_depth)


########################################################################################################################################################
###
###  NODES
###

class NODES(object):
    "A lexical container for definitions of all HyperML tree node classes."

    class node(BaseTree.node):
        isstatic     = False        # True in <static>, <literal> and their subclasses
        iselement    = False        # True in <xelement>, <xhypertag> and other xelement subclasses
        ishypertag   = None         # HypertagSpec object in all hypertags: <xhypertag> nodes and external hypertag objects/functions
        isexpression = False        # True in <expression> and subclasses - nodes that implement evaluate() method
        isspecial    = False        # True in <special> and subclasses - nodes that mix element/hypertag functionality
        
        ispure       = None         # True if this node's render() is a pure constant function: will always return the exact same value
                                    # regardless of the context of execution and without side effects. 
                                    # Is set in analyse() or compactify(), not __init__()!
        
        depth        = None         # no. of nested hypertag definitions that surround this node; set and used only in a part of node classes
        
        RAISE, MESSAGE, ORIGINAL = 1, 2, 3          # 'ifnull' special values, see _checkNull() for details
        
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

        def _checkNull(self, value, ifnull):
            """For use in subclasses in places where null values should be detected and either 
            raised as an exception (ifnull = node.RAISE) or converted to another value (the value of 'ifnull', typically '').
            Other special values of 'ifnull', not used currently: 
             - node.MESSAGE: replace the null value with an inline (in the document) error message, using the template configured in HyperML settings
             - node.ORIGINAL: keep the original text of the expression, maybe it will undergo another pass of HyperML parsing (e.g., on the client side)
                           and then the missing values will be filled out?
            """
            if value is not None: return value
            if ifnull == self.RAISE: raise NullValue()
            return ifnull

        def _convertIfNull(self, ifnull):
            """Convert 'ifnull' value from markup element representation (''/RAISE) to expression representation (''/None).
            Instead of raising an exception when None is encountered, expressions propagate None up the expression tree.
            """
            return None if ifnull is self.RAISE else ifnull

        def __str__(self): return "<%s>" % self.__class__.__name__  #object.__str__(self)
        #def __repr__(self): return self.__class__.__name__

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
        
    class xdef (static): pass
    class xvoid (static): pass
    class xident (static): pass
    class xvar_id (static): pass
    class xtext (static): pass
    class xtext_variant(xtext): pass

    class xescape(static):
        def init(self, tree, astnode):
            self.value = self.text()[1:]                    # the leading '$' is truncated
        
    class xnoparse(static):
        "<!-- --> <script> <style> etc."
        def init(self, tree, astnode):
            self.value = self.text()                        # value = the original input, text[start:end], children nodes ignored
    class xnoparse_hyml(static):
        "[= ... =] - the inner contents is not parsed, but is copied to the output in its original form"
        def init(self, tree, astnode):
            self.value = self.text()[2:-2]                  # value = the original input without bounding [= =]

    class merged(static):
        """
        An artificial node created during compactification by merging several sibling nodes that are all pure (or static, in particular).
        Values of the original nodes (strings to be concatenated) are retrieved from their render().
        """
        value = None        # pre-rendered output of the compactified nodes
        ex = None           # if NullValue exception was caught during rendering, it's stored here as an (exception, traceback) pair
        
        def __init__(self, node, stack, ifnull):
            self.tree = node.tree
            self.fulltext = node.fulltext
            self.pos = node.pos
            try:
                self.value = node.render(stack, ifnull)
            except NullValue as ex:
                self.ex = (ex, sys.exc_info()[2])
                
        def merge(self, node, stack, ifnull, sep):
            self.pos = (self.pos[0], node.pos[1])
            if self.ex: return                          # we already know that an exception will be raised upon self.render(), no need to append new nodes
            try:
                nodeValue = node.render(stack, ifnull)
                self.value += sep + nodeValue
            except NullValue as ex:
                self.ex = (ex, sys.exc_info()[2])
    
        def render(self, stack, ifnull = ''):
            if self.ex: reraise(None, self.ex[0], self.ex[1])
            return self.value
        
        def info(self):
            return "%s at position %s rendering: %s" % (self.infoName(), self.pos, escape(str(self.value)))
    

    ###  EXPRESSIONS  ###

    class expression(node):
        """
        Base class for expression nodes. Expressions first undergo evaluation, and then either:
        - rendering (if embedded in document text): strings are pasted without quotes, or
        - encoding to an attribute value string (if inside a tag, on attributes list): strings are quoted.
        The difference between rendering and encoding is roughly the same as the difference between
        __str__ and __repr__ special methods in Python objects (rendering corresponds to __str__, encoding to __repr__).
        """
        isexpression = True
        
        #CHECK_NULL = True       # if True, some expression nodes will check nullity of operands and raise NullValue instead of calculating the result
        
        def compactify(self, stack, ifnull = ''):
            """For expressions, compactify() only pre-computes the evaluate() function, not render().
            For this reason it converts 'ifnull' to a value understood by evaluate() - None or ''.
            Unlike compactify() for markup items, compactify() for expressions can replace 'self' with a newly created
            node object - this (or 'self') object is returned as a result. 
            """
            if ifnull is self.RAISE: ifnull = None
            if not self.isstatic and self.check_pure():
                return NODES.evaluated(self, stack, ifnull)
            self.children = [n.compactify(stack, ifnull) if n.isexpression else n for n in self.children]   # operators excluded from compactification
            return self
            
        def render(self, stack, ifnull = '', inattr = False):
            """If inattr=True, encodes the value to its quoted string representation that can be used as an attribute value.
            Otherwise, renders for direct inclusion in a markup part of the document.
            render() is called only for the root node of an expression, while subexpression nodes only undergo evaluation,
            so as to compute the value of the entire expression tree.
            """
            # calculate the value and check against null
            try:
                val = self.evaluate(stack, self._convertIfNull(ifnull))

            except HypertagsError: raise
            except Exception as e:                            # chain external exception with HypertagsError to inform about the place of occurence
                reraise(None, HypertagsError("Can't evaluate expression", self, cause = e), sys.exc_info()[2])

            val = self._checkNull(val, ifnull)
            isText = isinstance(val, Text)

            # value will be printed on attributes list? unescape it from markup text and put in quotes
            lang = self.tree.language
            if inattr:
                if isText and val.language == lang:     # 'val' is a Text instance in the target markup language? unescape to plain text, to use as an attr value
                    val = self.tree.unescape(val)
                if self.tree.quote_attr_values or isstring(val):
                    return quoteattr(unicode(val))  #return Text(val).encode("HTML-attr")
                return repr(val)

            # value will be printed in the main (markup) part of the document?
            # -> no quoting, but escaping for the target language may be needed
            if isText and val.language == lang:         # 'val' is a Text instance in the target language already? don't do any escaping
                return val
            if getattr(val, '__text__', None):          # 'val' has __text__() method and can produce representation in the target lang?
                text = val.__text__(lang)
                if text is not None: return text
            if lang in ('HTML', 'XHTML') and getattr(val, '__html__', None):
                return val.__html__()                   # 'val' has __html__() method? use it if the target language is HTML

            # otherwise, convert 'val' to a string and perform default escaping
            val = unicode(val)
            if self.tree.autoescape: return self.tree.escape(val)
            return val
            
        def evaluate(self, stack, ifnull):
            raise NotImplementedError(self)
    
    
    class literal(expression):
        isstatic = True
        ispure   = True
        value    = None
        def analyse(self, ctx): pass
        def evaluate(self, stack, ifnull):
            return self.value
        
    class xnumber (literal):
        def init(self, tree, _):
            self.value = asnumber(self.text())
    
    class xstr    (literal):
        def _decode(self, s):
            "For now, we assume that string values in expressions are encoded like HTML attributes, using &apos; &quot; &amp; for special chars."
            # decode entities: &apos; &quot; &amp; (others NOT!)
            return s.replace('&apos;', "'").replace('&quot;', '"').replace("&amp;", "&")
        def init(self, tree, _):
            s = self.text()[1:-1]                           # remove surrounding quotes: '"
            self.value = self._decode(s)
    xstr1 = xstr2 = xstr
    
    class xstr_unquoted(xstr):
        def init(self, tree, _):
            self.value = self._decode(self.text())
    
    class evaluated(literal):
        "Used for compactification, to replace pure sub-expressions with a pre-computed value. Not strictly a literal, but behaves like a literal."
        ex = None           # if NullValue exception was caught during pre-evaluation, it's stored here as an (exception, traceback) pair
        def __init__(self, expr, stack, ifnull):
            self.tree = expr.tree
            self.fulltext = expr.fulltext
            self.pos = expr.pos
            try:
                self.value = expr.evaluate(stack, ifnull)
            except NullValue as ex:
                self.ex = (ex, sys.exc_info()[2])
        def evaluate(self, stack, ifnull):
            if self.ex: reraise(None, self.ex[0], self.ex[1])      # re-raise the exception caught during pre-evaluation?
            return self.value
        
    
    class xvar    (expression):
        "Occurence (use) of a variable."
        name     = None
        
        # external variable, or a native hypertag used like a variable $H...
        hypertag = None         # if the variable refers an xhypertag node, here is this node, as found during analyse()
        external = False        # if True, the variable is linked directly to its value (external var) and the value is stored here in 'value'
        value    = None         # if external=True, the value of the variable, as found already during analyse()
        
        # native variable...
        depth    = None         # no. of nested hypertag definitions that surround this variable; for proper linking to non-local variables in nested hypertag definitions
        defnode  = None         # the node that defines this variable - an xattr node inside a hypertag definition
        nested   = None         # no. of outer hypertag definitions between the declaration of this variable and its occurence here; for finding the right frame in nested hypertags
        offset   = None         # position in the stack frame where the value of this variable is stored, as a negative offset from the top of the frame 
        
        def init(self, tree, _):
            self.name = self.children[0].text()
        
        def analyse(self, ctx):
            self.depth = ctx.depth
            if DEBUG: print("analyse", "$" + self.name, self.depth, ctx.asdict(_debug_ctx_start))
            if self.name not in ctx: raise UndefinedVariable("Undefined variable '%s'" % self.name, self)       # missing variable? raise an exception
            
            value = ctx[self.name]
            if not isinstance(value, NODES.xattr):            # xhypertag node, or external variable defined in Python, not natively in the document?
                if isinstance(value, NODES.xhypertag):        # "$H" xhypertag node?
                    self.hypertag = value
                    self.ispure = value.ispure_expand             
                    ctx.add_refdepth(value.depth, '$' + self.name)
                    return
                
                self.external = True
                self.value = value                            # if external then its value (an object) is known already during analysis
                
                # is this variable pure, i.e., guaranteed to return exactly the same value on every render() call, without side effects?
                # This can happen only for external variables or hypertags, bcs they're bound to constant objects;
                # additionally, we never mark user-defined objects as pure, bcs their behavior (and a returned value) may vary between calls
                # through side effects or internal state, even if the function being called is the same all the time.

                if value in self.tree.pure_externals:
                    self.ispure = True
                else:
                    self.ispure = False
                    ctx.add_refdepth(-1, '$' + self.name)           # mark that this subtree contains an external variable (i.e., defined at depth=-1)
                
                return
                #raise HypertagsError("Symbol is not an attribute (%s)" % self.defnode, self)

            self.defnode = value                                    # a native variable; its name is always linked to a definition node
            assert self.defnode.offset is not None
            assert isinstance(self.defnode.hypertag, NODES.xhypertag)
            hypertag = self.defnode.hypertag                        # hypertag where the variable is defined
            self.nested = self.depth - hypertag.depth - 1           # -1 because the current hypertag is not counted in access link backtracking
            self.offset = self.defnode.offset - 1                   # -1 accounts for the access link that's pushed on the stack at the top of the frame
            self.ispure = False
            
            defdepth = hypertag.depth                               # depth of the definition node (at what depth the variable is defined)
            ctx.add_refdepth(defdepth, '$' + self.name)
                        
        def evaluate(self, stack, ifnull):
            msg = "eval   $" + self.name
            if self.hypertag:                                       # hypertag used like a variable? return a Closure
                if DEBUG: print(msg, "hypertag")
                return Closure(self.hypertag, stack, self.depth)
            if self.external:                                       # external variable? return its value without evaluation
                if DEBUG: print(msg, "external")
                return self._checkNullVal(self.value, ifnull)
            
            # if self references a non-local variable, we must find the right frame on the stack going back via access links
            frame = 0                                                       # here, 0 means the "top frame"
            for _ in range(self.nested): frame = stack.get(frame - 1)       # access link is on [-1] index in each frame
            assert isint(frame) and frame >= 0
            
            if DEBUG: print(msg, self.nested, frame + self.offset, stack)
            value = stack.get(frame + self.offset)
            if isinstance(value, LazyVariable):                     # lazy rendering of $body variable? must call getvalue() method before returning
                value = value.getvalue()
            return self._checkNullVal(value, ifnull)
        
        def _checkNullVal(self, val, ifnull):
            if val is None is ifnull and self.tree.check_null_in_var: 
                raise NullValue("Variable '%s' has null value" % self.name)
            return val
            
        
    class xarg(expression):
        name = None         # can be None, if in unnamed argument
        expr = None         # is never None after initialization

        def init(self, tree, _):
            assert len(self.children) <= 2
            for n in self.children:
                if n.type == 'var_id': self.name = n.text()             # regular (more strict than XML) name of the argument
                else:
                    assert n.isexpression 
                    self.expr = n                                       # value of the argument

        def compactify(self, stack, ifnull = ''):
            "Compactify only 'expr'. 'name' is always a static node."
            self.expr = self.expr.compactify(stack, ifnull)
            return self
        
    class xargs(expression):
        unnamed = None      # list of unnamed arguments (where only a value expression is present)
        named   = None      # OrderedDict of named arguments: name->arg
        
        def analyse(self, ctx):
            super(NODES.xargs, self).analyse(ctx)            # analyse children nodes
            
            # validate uniqueness of the names of keyword arguments, the no. of unnamed ones, and their relative ordering
            named = OrderedDict()
            for arg in self.children:
                if arg.name is None:
                    if named: raise HypertagsError("Unnamed argument after keyword argument not allowed,", self)
                else:
                    if arg.name in named: raise HypertagsError("Argument '%s' appears twice on arguments list: (%s)" % (arg.name, self.text()), self)
                    named[arg.name] = arg
            
            self.unnamed = self.children[:-len(named)] if named else self.children
            self.named = named
        
        def compactify(self, stack, ifnull = ''):
            assert all(n.type == 'arg' for n in self.children)
            for n in self.children: n.compactify(stack, ifnull)         # recursively compactify 'expr' of each argument
            return self

        def evaluate(self, stack, ifnull):
            """Evaluate name/value expressions of the arguments and return as a pair of:
            1) list of values of unnamed attributes,
            2) name->value OrderedDict of subsequent keyword attributes, withOUT the hidden 'body' attr.
            OrderedDict is used to preserve the order of attributes, needed later on when building a stack frame. 
            Missing values are replaced with '' in regular elements, or None (null value) on hypertag definition list.            
            """
            unnamed = [arg.expr.evaluate(stack, ifnull) for arg in self.unnamed]
            kwargs = OrderedDict((name, arg.expr.evaluate(stack, ifnull)) for name, arg in self.named.items())
            return unnamed, kwargs
        
    class xcall(expression):
        title = 'function call (...)'                   # for error messaging
        def compactify(self, stack, ifnull = ''):
            assert len(self.children) <= 1
            if len(self.children) == 1:
                assert self.children[0].type == 'args'
            self.children = [n.compactify(stack, ifnull) for n in self.children]
            return self
        def apply(self, obj, stack, ifnull):
            if self.children:                           # any parameters for this call?
                args, kwargs = self.children[0].evaluate(stack, ifnull)
            else:
                args, kwargs = (), {}
            #if isinstance(obj, Closure):
            #    return obj.expand(args, kwargs, self)
            if getattr(obj, 'ishypertag', False):
                #if obj.ishypertag.backlink:
                #    kwargs['hyperdoc'] = self.tree
                if isinstance(obj, Closure):            # calling a native hypertag like a function? pass the stack to support inner hypertags
                    return obj.expand(args, kwargs, caller = self)
            return obj(*args, **kwargs)
            
    class xslice_value(expression):
        def evaluate(self, stack, ifnull):
            assert len(self.children) <= 1
            if self.children: return self.children[0].evaluate(stack, ifnull)
            return None                                 # None indicates a missing index in the slice(...) object
            
    class xindex(expression):
        """Element access: [...], with any type of subscript: [i], [i:j], [i:j:k], [::] etc.
        Children after reduction are either a single <xexpr> node (no slicing), 
        or a list of 2-3 <xslice_value> nodes in case of a slice.
        """
        title = 'sequence index [...]'
        def compactify(self, stack, ifnull = ''):
            assert 1 <= len(self.children) <= 3
            self.children = [n.compactify(stack, ifnull) for n in self.children]
            return self
        def apply(self, obj, stack, ifnull):
            # simple index: [i]
            if len(self.children) == 1:
                index = self.children[0].evaluate(stack, ifnull)
                return obj[index]
            
            # 2- or 3-element slice index:  i:j[:k]
            values = [n.evaluate(stack, ifnull) for n in self.children]
            return obj[slice(*values)]
        
    class xmember(expression):
        title = 'member access "."'
        def compactify(self, stack, ifnull = ''):
            return self                                 # no compactification, it's only 1 child: a static identifier
        def apply(self, obj, stack, ifnull):
            assert self.children[0].type == "var_id"
            member = self.children[0].value
            return getattr(obj, member)
    
    class xfactor(expression):
        "A chain of tail operators: () [] ."
        def evaluate(self, stack, ifnull):
            obj = self.children[0].evaluate(stack, ifnull)
            trailer = self.children[1:]                 # optional chain of tail operators: call / index / member
            for op in trailer:
                assert isinstance(op, (NODES.xcall, NODES.xindex, NODES.xmember))
                # left-hand null would cause TypeError; raising NullValue instead, may get caught by a variant block
                if obj is None and self.tree.check_null_in_oper: raise NullValue("left operand of a %s operator is null" % op.title)
                obj = op.apply(obj, stack, ifnull)
            return obj
    
    class xexpr_markup(xfactor):
        """
        After reduction of tree nodes during parsing, this becomes the root node of every $... expression,
        embedded either in markup text or in an attribute list within a tag.
        """
        # def render(self, stack, ifnull = '', inattr = False):
        #     """If inattr=True, encodes the value to its quoted string representation that can be used as an attribute value.
        #     Otherwise, renders for direct inclusion in a markup part of the document.
        #     render() is called only for the root node of an expression, while subexpression nodes only undergo evaluation,
        #     so as to compute the value of the entire expression tree.
        #     """
        #     # calculate the value and check against null
        #     try:
        #         val = self.evaluate(stack, self._convertIfNull(ifnull))
        #
        #     except HypertagsError: raise
        #     except Exception as e:                            # chain external exception with HypertagsError to inform about the place of occurence
        #         reraise(None, HypertagsError("Can't evaluate expression", self, cause = e), sys.exc_info()[2])
        #
        #     # # `val` is a text string containing HyML code? parse it into HyML tree and render
        #     # if isinstance(val, Text) and val.language == 'HyML':
        #     #     subtree = HyperML(val, _hyperml_context = self.context)
        #     #     val = subtree.render()
        #
        #     val = self._checkNull(val, ifnull)
        #     isText = isinstance(val, Text)
        #
        #     # value will be printed on attributes list? unescape it from markup text and put in quotes
        #     lang = self.tree.language
        #     if inattr:
        #         if isText and val.language == lang:     # 'val' is a Text instance in the target markup language? unescape to plain text, to use as an attr value
        #             val = self.tree.unescape(val)
        #         if self.tree.quote_attr_values or isstring(val):
        #             return quoteattr(unicode(val))  #return Text(val).encode("HTML-attr")
        #         return repr(val)
        #
        #     # value will be printed in the main (markup) part of the document?
        #     # -> no quoting, but escaping for the target language may be needed
        #     if isText and val.language == lang:         # 'val' is a Text instance in the target language already? don't do any escaping
        #         return val
        #     if getattr(val, '__text__', None):          # 'val' has __text__() method and can produce representation in the target lang?
        #         text = val.__text__(lang)
        #         if text is not None: return text
        #     if lang in ('HTML', 'XHTML') and getattr(val, '__html__', None):
        #         return val.__html__()                   # 'val' has __html__() method? use it if the target language is HTML
        #
        #     # otherwise, convert 'val' to a string and perform default escaping
        #     val = unicode(val)
        #     if self.tree.autoescape: return self.tree.escape(val)
        #     return val
            
        
    
    class static_operator(static):
        name  = None        # textual representation of the operator, for possible rendering back into the document
        apply = None        # corresponding function from 'operator' module
        
        ops = ['+ add', '- sub', '* mul', '// floordiv', '% mod', '<< lshift', '>> rshift', '& and_', '| or_', '^ xor',
               '< lt', '> gt', '== eq', '>= ge', '<= le', '!= ne', 'is is_', 'is not is_not']
        ops = [m.rsplit(' ', 1) for m in ops]
        ops = {op: getattr(operator, fun) for op, fun in ops}
        
        # '/' must be added separately, because it has different names (and behavior) in Python 2 vs. 3
        ops['/'] = getattr(operator, 'div', None) or operator.truediv
        
        # extra operators, implemented by ourselves
        ops['in'] = lambda x, d: x in d                         # operator.contains() is not suitable bcs it takes operands in reversed order
        ops['not in'] = lambda x, d: x not in d 
        ops[''] = ops['+']                                      # missing operator mapped to '+' (implicit +)
        
        def init(self, tree, astnode):
            self.name = self.text()
            self.name = ' '.join(self.name.split())             # to replace multiple whitespaces in "not in", "is not"
            self.apply = self.ops[self.name]
            
    class xop_multiplic(static_operator): pass
    class xop_additive(static_operator): pass
    class xop_shift(static_operator): pass
    class xop_comp(static_operator): pass
    class xneg(static): pass
    class xnot(static): pass
        
    class chain_expression(expression):
        "A chain of different binary operators, all having the same priority: x1 OP1 x2 OP2 x3 ..."
        raise_null = True           # if True, any intermediate null (None) value will raise NullValue exception
        
        def _checkNullVal(self, val, ifnull, side, name):
            if val is None is ifnull and self.raise_null and self.tree.check_null_in_oper: 
                raise NullValue(side + " operand of a '%s' operator is null" % name)

        def evaluate(self, stack, ifnull):
            head, tail = self._prepare(stack, ifnull)
            ops = tail[0::2]                            # items 0,2,4,... are operators
            exprs = tail[1::2]                          # items 1,3,5,... are subsequent expressions, after the initial one
            assert len(exprs) == len(ops)
            
            res = head
            for op, expr in zip(ops, exprs):                # adding terms one by one to 'res'
                self._checkNullVal(res, ifnull, "left", op.name)
                val = expr.evaluate(stack, ifnull)
                self._checkNullVal(res, ifnull, "right", op.name)
                res = op.apply(res, val)                    # calulate: <res> = <res> op <val>
            
            return res    
        
        def _prepare(self, stack, ifnull):
            """Pre-processesing of the 1st item of the chain for evaluate(). Returns the chain as (head, tail) for actual evaluation.
            Override in subclasses if the 1st item is treated differently then the others."""
            head = self.children[0].evaluate(stack, ifnull)
            tail = self.children[1:]
            return head, tail
    
    class xterm(chain_expression):
        "chain of multiplicative operators: * / // %"
    class xshift_expr(chain_expression):
        "chain of shift operators: << >>"
    class xarith_expr(chain_expression):
        "chain of additive operators: neg + -"
        def _prepare(self, stack, ifnull):
            if self.children[0].type == 'neg':
                head = self.children[1].evaluate(stack, ifnull)
                if head is not None:
                    head = -head
                tail = self.children[2:]
            else:
                head = self.children[0].evaluate(stack, ifnull)
                tail = self.children[1:]
            return head, tail
    
    class xconcat_expr(expression):
        "chain of concatenation operators: x1 x2 x3 ... (space-separated expressions)"
        def evaluate(self, stack, ifnull):
            items = [None] * len(self.children)
            for i, expr in enumerate(self.children):
                val = expr.evaluate(stack, ifnull)
                #items[i] = u'' if val is None else val if isstring(val) else unicode(val)
                if val is None:
                    if ifnull is None and self.tree.check_null_in_oper: raise NullValue()
                    val = u''
                items[i] = val if isstring(val) else unicode(val)
            return Text().join(items)

    class simple_chain_expression(expression):
        "A chain built from the same binary operator: x OP y OP z OP ..."
        raise_null = True           # if True and inside variant block, any intermediate null (None) value will raise NullValue exception
        oper = None                 # the operator function to be applied
        def _checkNullVal(self, val, ifnull, side):
            if val is None is ifnull and self.raise_null and self.tree.check_null_in_oper: 
                raise NullValue(side + " operand of a '%s' operator is null" % self.name)
        
        def evaluate(self, stack, ifnull):
            res = self.children[0].evaluate(stack, ifnull)
            for expr in self.children[1:]:
                self._checkNullVal(res, ifnull, "left")
                val = expr.evaluate(stack, ifnull)
                self._checkNullVal(res, ifnull, "right")
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
            if isfunction(y): return y(x)
            return x | y                            # here, 'y' can be a Filter instance
            
    class xcomparison(chain_expression):
        "chain of comparison operators: < > == >= <= != in is, not in, is not"
        raise_null = False
        
    class xand_test(simple_chain_expression):
        "chain of logical 'and' operators. Lazy evaluation: if false item is encountered, it's returned without evaluation of subsequent items"
        name = 'and'
        def evaluate(self, stack, ifnull):
            res = self.children[0].evaluate(stack, ifnull)
            for expr in self.children[1:]:
                if not res: return res
                res = res and expr.evaluate(stack, ifnull)
            return res
    class xor_test(simple_chain_expression):
        "chain of logical 'or' operators. Lazy evaluation: if true item is encountered, it's returned without evaluation of subsequent items"
        name = 'or'
        def evaluate(self, stack, ifnull):
            res = self.children[0].evaluate(stack, ifnull)
            for expr in self.children[1:]:
                if res: return res
                res = res or expr.evaluate(stack, ifnull)
            return res
    
    class xifelse_test(expression):
        "... if ... else ... Lazy evaluation of arguments: only the true branch of the condition undergoes evaluation."
        def evaluate(self, stack, ifnull):
            assert len(self.children) in (2, 3)             # the expression is compactified, that's why a single child is not possible here
            if self.children[1].evaluate(stack, ifnull):
                return self.children[0].evaluate(stack, ifnull)
            if len(self.children) == 3:
                return self.children[2].evaluate(stack, ifnull)
            return ''                                       # default '' when "else..." branch is missing
    
    class xnot_test(expression):
        "not not not ..."
        def evaluate(self, stack, ifnull):
            assert len(self.children) >= 2 and self.children[-1].isexpression
            neg = not (len(self.children) % 2)              # check parity of 'children' to see if negation appears even or odd no. of times
            val = self.children[-1].evaluate(stack, ifnull)
            return not val if neg else val
    
    # these nodes should be reduced during rewriting, right after being created (they always have 1 child and are listed in _compact_ setting) 
    class xexpr (expression): pass
    class xvalue (expression): pass
    

    ###  TAGS & ELEMENTS  ###
    
    class xattr(node):
        """
        name OR name="value" OR name=value OR name=$(...) OR $(...) OR $var OR literal_value ...
        """
        name = None         # name of the attribute, as a string; or None if no name was given
        expr = None         # expression assigned to this attribute: attribute value, or a default value if inside hypertag definition
        hypertag = None     # the xhypertag definition where this attribute belongs to, or None if in a regular element
        offset  = None      # if inside a hypertag def, positition of this attr on attributes list, as a negative offset from the end: -1, -2, ...
        
        def init(self, tree, _):
            assert len(self.children) <= 2
            for n in self.children:
                if n.type == 'ident': self.name = n.text()              # XML name of the attribute
                else:
                    assert n.isexpression 
                    self.expr = n                                       # value of the attribute    
                    #assert(0), n.info()
        
        def makeSymbol(self, hypertag, offset):
            #super(NODES.xattr, self).analyse(ctx)
            self.hypertag = hypertag
            self.offset = offset
        
        def compactify(self, stack, ifnull):
            "Compactify only 'expr'. 'name' is always a static node."
            if self.expr: self.expr = self.expr.compactify(stack, ifnull)
            #if not self.expr or self.expr.isstatic: return
            #if self.expr.check_pure():
            #    self.expr = NODES.evaluated(self.expr, stack, ifnull)
            #else:
            #    self.expr.compactify(stack, ifnull)
            
        def evaluate(self, stack, ifnull):
            """
            Missing values are replaced with '' in regular elements (hypertag occurences), 
            or None (null value) on hypertag definition lists.            
            """
            try:
                if self.expr: return self.expr.evaluate(stack, self._convertIfNull(ifnull))
            
            except HypertagsError: raise
            except Exception as e:                # chain external exception with HypertagsError to inform about the place of occurence
                reraise(None, HypertagsError("Can't evaluate attribute", self, cause = e), sys.exc_info()[2])

            if self.hypertag: return None       # definition of a variable without explicit default value? return None as default
            return ""                           # regular named attribute without value? empty string is the value
            
        def render(self, stack, ifnull = ''):
            if self.expr is None: return self.name                  # ??? or ...return ""
            val = self.expr.render(stack, ifnull, inattr = True)
            if self.name is None: return val
            return u"%s=%s" % (self.name, val)
            
    class xattr_body(BaseTree.virtual, xattr):
        "special class to represent the hidden attribute 'body'"
        name = "body"
        
    class xattrs(node):
        "List of attributes."
        attrs    = []       # list of explicit (without 'body') xattr nodes; same as 'children'
        unnamed  = None     # list of unnamed attributes (where only a value expression is present)
        named    = None     # OrderedDict of named attributes: name->attr
        
        def isempty(self): return not self.children
        
        def analyse(self, ctx):
            self.attrs = self.children
        
            # validate uniqueness and correctness of attribute names; count no. of unnamed ones, collect named ones
            named = OrderedDict()
            for attr in self.attrs:
                if attr.name is None:
                    if named: raise HypertagsError("Unnamed attribute after named attribute not allowed,", attr)
                else:
                    if attr.name in named: raise HypertagsError("Attribute '%s' appears twice on attributes list: <... %s>" % (attr.name, self.text()), attr)
                    named[attr.name] = attr
                attr.analyse(ctx)
            
            self.unnamed = self.attrs[:-len(named)] if named else self.attrs
            self.named = named
        
        def compactify(self, stack, ifnull, full = True):
            """In 'full' compactification, individual <xattr> nodes or even 'self' may be converted to <merged> nodes
            - so they will no longer support evaluate(), of course. If evaluate() has to be still supported, use full=False.
            """
            if full:
                self.attrs = NODES._compactify_siblings_(self.attrs, stack, ifnull, u' ')
            else:
                for a in self.attrs: a.compactify(stack, ifnull)                # recursively compactify 'expr' of each attribute
            
        def render(self, stack, ifnull = ''):
            "Called to render regular markup elements (not hypertag definitions)."
            return u' '.join(a.render(stack, ifnull) for a in self.attrs)
            
        def evaluate(self, stack, ifnull = ''):
            """Evaluate (render) name/value expressions of the attributes in a given context and return as a pair of:
            1) list of values of unnamed attributes,
            2) name->value OrderedDict of subsequent keyword attributes, withOUT the hidden 'body' attr.
            OrderedDict is used to preserve the order of attributes, needed later on when building a stack frame. 
            """
            # in hypertag occurences we may need to check against nulls on attribute list;
            # the function below is an optimized version of self._checkNull()
            if ifnull == '':
                def checkNull(v): return v
            else:
                assert ifnull == self.RAISE
                def checkNull(v):
                    if v is not None: return v
                    raise NullValue()
                
            unnamed = [checkNull(attr.evaluate(stack, ifnull)) for attr in self.unnamed]
            kwattrs = OrderedDict((name, checkNull(attr.evaluate(stack, ifnull))) for name, attr in self.named.items())
            return unnamed, kwattrs
            
    class xattrs_empty(BaseTree.virtual, xattrs):
        attrs = []
        def render(self, stack, ifnull = ''): return {}

    class tag(node):
        isstart = False         # is it a start tag (no '/' after '<')?
        isend = False           # is it an end tag </...>, or a self-closing tag <.../> (the latter one is both a start tag and an end tag)
        ishypertag = False      # True in <:H> and </:H> tags
        isvoid = False          # True in hypertag's opening tag with explicit void marker: <:H ~ ...>
        
        name  = None
        attrs = None            # <xattrs> node with a list of attributes 
        
        def init(self, tree, _):
            for c in self.children:
                if   c.type == 'def': self.ishypertag = True
                elif c.type == 'void': 
                    if not self.ishypertag: raise HypertagsError("Void marker '~' not allowed in elements other than hypertag definitions", self)
                    self.isvoid = True
                elif c.type in ('ident', 'var_id'): self.name = c.text()
                elif c.type == 'attrs': self.attrs = c
                else: assert(0)
            
            # if a hypertag, check if the name is a regular identifier and not reserved
            if self.ishypertag: tree._check_name(self.name, self)
            
        def render(self, stack, ifnull = ''):
            slash1 = '/' if (self.isend and not self.isstart) else ''       # leading slash </... in a closing tag
            slash2 = ' /' if (self.isend and self.isstart) else ''          # trailing slash .../> in an empty (self-closing) element
            name   = (':' if self.ishypertag else '') + self.name           # :name or name
            attrs  = ' ' + self.attrs.render(stack, ifnull) if self.attrs else ''
            tokens = ['<', slash1, name, attrs, slash2, '>']
            return u''.join(tokens)
            
    class xstart_tag(tag):
        isstart = True
        def analyse(self, ctx):
            # if analysis go into a start tag, it means this tag was left unmatched after pairing
            raise HypertagsError("Unmatched start tag", self)
    class xend_tag   (tag):
        isend = True
    class xempty_tag (tag):
        "self-closing tag"
        isstart = isend = True
    
    class xelement(node):
        """Any markup element: a start tag matched with its corresponding end tag, together with all contents in between (the body).
        Produced in the tree after tag pairing, pair(), which is a part of semantic analysis. Replaces the original tags in the tree.
        Can represent both a hyper-element (hypertag occurence, to be replaced with hypertag definition body during compilation), 
        or a regular tag-element that should stay in the document as it is and be rendered at the end.
        Hypertag definition is a special type of element and it's represented by the xhypertag subclass.
        """
        type = "element"                                                                                                #@ReservedAssignment
        name = None
        pos  = None
        body = None
        attrs = None            # xattrs node of the start tag
        start = end = None      # xtag nodes; for a self-closing element <.../>, end=None; for xdocument, both start=end=None
        selfclosing = None      # True in a self-closing element <.../>
        bodypos = None          # (start,end) position of the body (between open/close tags)
        htag = None             # hypertag definition if 'self' is a hypertag occurence, otherwise None
        htag_external = None    # True if 'htag' is an external hypertag function, not an <xhypertag> node
        htag_spec = None        # a HypertagSpec object containing detailed specification of the hypertag interface and behavior
        
        iselement  = True
        depth = None                # no. of nested hypertag definitions that surround this one; for proper expanding of nested hypertags
        
        def __init__(self, tree, start, end, body):
            """
            'end': None for an empty element <.../> 
            'body': always a list of nodes, possibly empty 
            """
            self.tree = tree
            self.fulltext = tree.text
            self.name = start.name
            self.attrs = start.attrs if start.attrs else NODES.xattrs_empty(tree)
            self.start = start
            self.end = end
            self.selfclosing = (end is None)
            self.setBody(body)
            
            end = (end or start)
            self.pos     = (start.pos[0], end.pos[1])
            self.bodypos = (start.pos[1], max(start.pos[1], end.pos[0]))        # empty tag <.../> has start=end= start.pos[1]
        
        def setBody(self, body):
            """'children' are fully derived from start/body/end, thus a separate method is necessary to ensure consistency 
            between redundant 'body' and 'children'. 'children' attribute is needed for printout and debugging of the tree.
            """
            self.body = body
            self.children = [self.start] if self.start else []
            self.children += body
            self.children += [self.end] if self.end else []

        def infoName(self): return "<element %s>" % (self.name) #, self.attrs.vals if self.attrs else '')

        def analyse(self, ctx):
            self.depth = ctx.depth
            if DEBUG: print("analyse", self.name, self.depth, ctx.asdict(_debug_ctx_start))
            assert self.ispure is None
            
            # firstly, analyse recursively 'attrs' and 'body'
            state = ctx.getstate()
            self.attrs.analyse(ctx)
            for n in self.body: n.analyse(ctx)

            # reset the context to its initial state, to perform name scoping - children may have pushed new symbols
            ctx.reset(state)

            # set a working value of self.ispure, taking into account only children (not the hypertag referenced)
            # - may change below, if 'self' occurs to be a hypertag occurence
            self.ispure = self.check_pure()

            # is this a hypertag occurence, either a native one (xhypertag) or an external one (hypertag function/object)?
            # get the HypertagSpec object; 'ishypertag' spec must be present in every true hypertag, be it native or external
            htag = ctx.get(self.name, None)
            if htag is None or not getattr(htag, 'ishypertag', None): return
            
            # keep a link to the definition node or external hypertag function, for future rendering
            self.htag = htag
            self.htag_spec = htag.ishypertag
            assert isinstance(self.htag_spec, HypertagSpec)
            
            native = isinstance(htag, NODES.xhypertag)
            self.htag_external = not native
            if self.htag_spec.void and self.body:
                raise HypertagsError("Hypertag '%s' is declared as void and so it must have empty body" % self.name, self)

            # is this hypertag a pure function, i.e., guaranteed to return the same value on every call, without side effects?
            # we never mark user-defined functions as pure, except for those listed in 'pure_externals',
            # bcs their behavior (and a returned value) may vary between calls through side effects or internal state, 
            # even if the function is the same all the time

            if not self.ispure: return              # if any attribute or body element is not pure, this element is not pure either - don't bother
            
            ispure_htag = (native and htag.ispure_expand) or (not native and htag in self.tree.pure_externals)
            if not ispure_htag:
                self.ispure = False
                ctx.add_refdepth(htag.depth if native else -1, ':' + self.name)

        def compactify(self, stack, ifnull):
            if DEBUG: print("compact", (':' if self.ishypertag else '') + self.name, stack)
            
            # compactify the entire start/end tags (if self is a regular node) or just self.attrs 
            # (if self is a hypertag occurence or definition); in the latter case, only individual expressions 
            # on attributes list can be compactified (full=False) 
            if self.start:
                isregular = not (self.htag or self.ishypertag)
                if isregular:
                    self.start.compactify_self(stack, ifnull)
                else:
                    self.attrs.compactify(stack, ifnull, full = False)
            
            if self.end: self.end = self.end.compactify_self(stack, ifnull)

            # compactify/merge 'body' list and launch recursive compactification in all remaining subtrees (children)
            newbody = NODES._compactify_siblings_(self.body, stack, ifnull)
            self.setBody(newbody)
            
        def render(self, stack, ifnull = ''):
            if DEBUG: print("render", self.name, stack)
            
            # regular element? render it in the way as it appears in the source
            if self.htag is None:
                return u''.join(c.render(stack, ifnull) for c in self.children)
            
            # hypertag occurence? replace with a definition body rendered in the current context, extended with attributes' actual values
            unnamed, kwattrs = self.attrs.evaluate(stack, ifnull)               # actual values of the attributes
            #print("  actual:", unnamed, kwattrs)

            if not self.htag_spec.void:                     # 'body' is present? append to unnamed attributes
                def bodyfun():                              # body rendering as a function, for lazy eval
                    sep = Text(u'', "HTML")                 # the resulting string will be marked as HTML
                    return sep.join(n.render(stack, ifnull) for n in self.body)     # rendering should not affect 'stack'
                
                if self.htag_spec.lazybody:                 # actual rendering to be done later on? (lazy evaluation)
                    body = LazyVariable(bodyfun)            # ...wrap up the function in a LazyVariable for later execution
                    assert self.htag_external               # lazy eval can be used with external hypertags only (!), otherwise
                                                            # the expand() method would modify the stack before evaluation
                else:
                    body = bodyfun()                        # not lazy? pre-render the body right now
                unnamed = [body] + unnamed
            
            else:                                           # void hypertag? omit 'body' when passing arguments
                assert not self.body                        # if body is non-empty, exception should have been raised in analyse()
            
            if not self.htag_external:                      # native <xhypertag> node? just call expand()
                return self.htag.expand(unnamed, kwattrs, stack, self.depth, self)
            
            # external hypertag? expansion called in a different way than for <xhypertag>
            fun = self.htag.apply if isinstance(self.htag, Filter) else self.htag   # for a Filter, must call apply() not __call__
            try:
                content = fun(*unnamed, **kwattrs)
            except HypertagsError: raise
            except Exception as e:                            # chain external exception with HypertagsError to inform about the place of occurence
                reraise(None, HypertagsError("Can't expand external hypertag", self, cause = e), sys.exc_info()[2])
            
            content = self._checkNull(content, ifnull)      # nullity check of the result: external hypertags can't do this by themselves
            return content

    class xhypertag(xelement):
        "Element with a hypertag definition: <:name>...</:name>. Produced during semantic analysis, in pair()."
        
        ishypertag      = None      # HypertagSpec object with specificiation of this hypertag's interface and behavior
        ispure          = True      # hypertag's render() is always pure, because it returns an empty string, but...
        ispure_expand   = None      # ...expand() is not always pure and this is what matters for hypertag resolution
        
        bodyattr        = None      # name of the special attribute 'body' (the 1st attr in non-void hypertag) or None if void
        depth           = None      # no. of outer hypertag definitions that surround this one; for accessing external variables in nested hypertags
        ref_depth       = None      # depth of the top-most variable/hypertag referenced from this one
        
        def __init__(self, *args, **kwargs):
            super(NODES.xhypertag, self).__init__(*args, **kwargs)
            self.ishypertag = HypertagSpec()
            
            # is this hypertag declared as void, either explicitly <:H ~ ...> or implicitly <:H>?
            self.ishypertag.void = self.start.isvoid or (self.attrs.isempty() and self.tree.explicit_body_var)
            if not self.ishypertag.void:
                self.bodyattr = self.attrs.children[0].name if self.tree.explicit_body_var else 'body'
        
        def infoName(self): return "<def %s>" % self.name

        def symbols(self, ctx):
            """OrderedDict of symbols defined in this hypertag - they should be made available to body nodes.
            In a regular hypertag definition, these are all attributes present in the opening tag.
            However, in special node subclassed the set of symbols being defined can be different.
            """
            if self.attrs.unnamed: 
                raise HypertagsError("Unnamed attributes not allowed in a hypertag definition", self.attrs.unnamed[0])
            
            # the special attribute $body must not have any default value
            if self.bodyattr and self.tree.explicit_body_var:
                bodyattr = self.attrs.named[self.bodyattr]
                if bodyattr.expr:
                    raise HypertagsError("The body attribute '%s' must not have any default value" % bodyattr.name, self)
             
            # with explicit or non-existent $body, just return all attrs
            if self.ishypertag.void or self.tree.explicit_body_var:
                return self.attrs.named                 # no need to declare implicit $body: it doesn't exist or was declared explicitly
            
            # return all named attributes (self.attrs.named), but with 'body' added implicitly as the 1st symbol
            body = NODES.xattr_body(self.tree)
            body.analyse(ctx)
            return _addFirst('body', body, self.attrs.named)
        
        def markSymbols(self, symbols):
            "Mark given attributes as symbols: definitions of variables; set their offset and backlink to the containing hypertag."
            total = len(symbols)
            for pos, (name, attr) in enumerate(symbols.items()):
                self.tree._check_name(name, attr)       # we have stricter rules for symbol names than for other attributes - must check
                attr.makeSymbol(self, pos - total)

        def analyseBody(self, ctx, symbols):
            "Add symbols to context and push analysis down the tree."
            state = ctx.getstate()
            ctx.pushall(symbols)                        # add attributes of this hypertag to the context, to resolve references inside body nodes
            ctx.depth += 1
            for n in self.body: n.analyse(ctx)          # analyse body nodes
            ctx.depth -= 1
            ctx.reset(state)                            # reset context to its initial state
        
        def analyse(self, ctx):
            self.depth = ctx.depth
            if DEBUG: print("analyse", ":" + self.name, self.depth, ctx.asdict(_debug_ctx_start))

            ref_depth = ctx.ref_depth                   # here in ctx.ref_depth, after recursive analyse() we'll have the depth
            ctx.ref_depth = None                        # of the top-most variable/hypertag referenced from this subtree
            self.attrs.analyse(ctx)                     # resolve symbols inside attribute values; collect ref_depth values
            
            symbols = self.symbols(ctx)                 # get the dict of attributes defined as new variables (symbols) in this hypertag
            self.markSymbols(symbols)                   # mark these attributes as symbols, so that they can be referenced by xvar nodes
            self.analyseBody(ctx, symbols)              # add symbols to context and push analysis down the tree
            
            ctx.push(self.name, self)                   # now add self to the context, for use by siblings

            # hypertag's expand() is pure when its subtree (attr values and body) doesn't reference any non-pure
            # variable/hypertag defined higher in the tree than 'self' (i.e., defined at a smaller depth)
            self.ref_depth = ctx.ref_depth
            self.ispure_expand = (self.ref_depth is None or self.ref_depth >= self.depth)
            #if DEBUG: print(' ', ':' + self.name, 'ispure_expand =', self.ispure_expand, self.depth, ctx.ref_depth)
            ctx.add_refdepth(ref_depth, '_back_')       # add back the initial ref_depth to account for preceeding siblings
            
            # compactify the subtree already now, from analyse(), because the top-level compacification launched from HyperML
            # will never call compactify() on this subtree, as the hypertag's render() is always pure and gets compactified
            # by some ancestor node, without going down to this node's compactify()
            
            if self.tree.compact:
                stack = Stack()
                for d in range(self.depth + 1):
                    stack.push(d)                       # chain of mock-up "access links" for correct expansion of inner hypertag occurences
                self.compactify(stack, '')              # assert: inner hypertags will never need true frames, bcs they're known to be PURE
            
        def definition(self): 
            return Text(self.text(), "HTML")
        
        def render(self, stack, ifnull = ''):
            """Hypertag definitions should be removed from the final output, thus returning an empty string. 
            For rendering of a hypertag body in the place of hypertag occurence, expand() is used instead."""
            return u""
        
        def expand(self, unnamed, kwattrs, stack, occurDepth, occurence = None):
            """Expand (render) an *occurence* of this hypertag, with a given list+dict of attribute actual values (unnamed + keyword).
            The special 'body' attribute, if present, must be passed as the 1st 'unnamed' value.
            'occurDepth' is the ctx.depth (no. of surrounding hypertag definitions) of the occurence element being expanded,
            for proper calculation of positions in the stack of non-local variables used in this hypertag.
            Hypertag is always expanded in non-variant mode, even if the definition and/or occurence is enclosed 
            in a [[...]] variant block. That's why expand() takes a 'stack' argument but no 'ifnull', unlike typical render().
            """
            # merge actual attribute values with default values where missing
            _, default = self.attrs.evaluate(stack, '')         # all valid attrs and their default values, as an OrderedDict
            implicitBody = not self.tree.explicit_body_var      # a shortcut name
            if implicitBody and not self.ishypertag.void:       # implicit and existing (non-void) 'body'? add to valid attrs
                bodyDefault = lazyEmptyString if self.ishypertag.lazybody else ""
                default = _addFirst('body', bodyDefault, default)
            
            selfclosing = getattr(occurence, 'selfclosing', False)
            attrs = NODES._actual_attrs(default, unnamed, kwattrs, self.bodyattr, occurence, self.name, selfclosing = selfclosing)
            
            # find "access link": position in the 'stack' of the frame of the immediate lexical encapsulating hypertag of self
            accesslink = NODES._find_accesslink(stack, self.depth, occurDepth)

            # create a new execution frame and push onto the stack
            top = stack.position()
            stack.pushall(list(attrs.values()))       # attrs is an OrderedDict, thus it preserves the ordering of attributes from hypertag def
            stack.push(accesslink)
            if DEBUG: print("expand", ":" + self.name, accesslink, stack)
            
            # render hypertag's definition body
            if len(self.body) == 1:                             # special case: when only 1 child, the result may be of any type, not only string
                out = self.body[0].render(stack)
            else:
                out = u''.join(n.render(stack) for n in self.body)
            if isstring(out) and (not isinstance(out, Text) or out.language is None):
                out = Text(out, self.tree.language)             # set language of the resulting text, for proper (non-)escaping later on
            
            stack.reset(top)
            return out
        
        def __call__(self, *unnamed, **kwattrs):
            "For external use of the node like a function. Applicable to top-level hypertags only."
            if self.depth > 0: 
                raise HypertagsError("xhypertag '%s' is defined inside another hypertag (depth=%s) and so it can't be used as a function" % (self.name, self.depth))
            
            # void hypertag? no need to pass 'body' attribute
            if self.ishypertag.void:
                return self.expand(unnamed, kwattrs, Stack(), 0)
                
            # unpack 'body' attribute of a non-void hypertag
            if unnamed:
                body, unnamed = unnamed[0], unnamed[1:]
            else:
                body = kwattrs.pop(self.bodyattr, "")
            
            # If 'body' is a *string*, it's assumed to be in the target language (typically HTML) already,
            # so it shall NOT be escaped when evaluated inside the hypertag definition body. 
            # To guarantee no escaping, the string is wrapped up in Text instance and marked to contain target language.
            # Otherwise, if 'body' is a *non-string* object, its occurence inside markup will be 
            # evaluated to a string and then escaped appropriately. 
            if isinstance(body, basestring) and (not isinstance(body, Text) or body.language is None):
                body = Text(body, self.tree.language)
            return self.expand([body] + list(unnamed), kwattrs, Stack(), 0)
        
    class xvariant(node):
        def pair(self):
            for c in self.children: c.pair()
        
        def analyse(self, ctx):
            """Push the analysis further down the tree, but with proper name scoping along the way: every child lives in its own scope,
            a child cannot access symbols defined in preceeding children.
            """
            if DEBUG: print("analyse", "[[...]]", ctx.asdict(_debug_ctx_start))
            state = ctx.getstate()
            for c in self.children:                         # each child is another branch of the alternative
                assert isinstance(c, NODES.xchoice)
                c.analyse(ctx)
                ctx.reset(state)

        def compactify(self, stack, ifnull):
            for c in self.children:
                c.compactify(stack, ifnull = self.RAISE)
            
        def render(self, stack, ifnull = ''):
            if DEBUG: print("render", "[[...]]", stack)
            for c in self.children:                         # return the output of the 1st xchoice child that renders to a not-null value
                try:
                    return c.render(stack, ifnull = self.RAISE)
                except NullValue:
                    continue
            return ''
        
    class xdocument(node):
        "A node that contains a list of markup/text nodes and performs tag pairing, like xelement, but has no open/close tags."
        def pair(self):
            self.children = self.tree._pair_tags(self.children)
        
        def compactify(self, stack, ifnull):
            if DEBUG: print("compact", "DOC", stack)
            self.children = NODES._compactify_siblings_(self.children, stack, ifnull)
            
        def render(self, stack, ifnull = ''):
            return u''.join(c.render(stack, ifnull) for c in self.children)

    xchoice = xdocument

    
    class special(xelement):
        "Base class for special elements: ones that introduce new symbols to the current namespace, in a tag-specific way."
        
        isspecial = True
        ispure    = True            # special nodes are pure and can be reduced during compactification,
                                    # because their render() always returns an empty string (if not, change this in the subclass)
        static_attrs = {}           # OrderedDict of static attributes accepted by this element and their default values
        static_vals  = {}           # dict of static attribute values, as calculated by analyse()

        def infoName(self): return "<%s>" % self.name

        def analyse(self, ctx):
            "Preparatory steps of analysis: analyse static attributes and calculate their values 'static_vals'."            
            if DEBUG: print("x" + self.name, ctx.asdict(_debug_ctx_start))
            try:
                # perform analysis of attributes in empty context - they must NOT reference any variables, we only handle constant attrs in special tags
                self.attrs.analyse(Context())
            except UndefinedVariable as ex:
                raise HypertagsError("A non-constant expression on attributes list of a special element", ex.node)
            
            if self.static_attrs:                                       # compute actual values of static attributes, self.static_vals
                unnamed, kwattrs = self.attrs.evaluate(stack = None)    # all attribute values are constant, they should not need any stack
                self.static_vals = NODES._actual_attrs(self.static_attrs.copy(), unnamed, kwattrs, None, self, self.name)
            
        def render(self, stack, ifnull = ''):
            return u""
        
    class ximport(special):
        "Special element <import>. Imports given names (variables and/or hypertags) from a Python module. Created during tag pairing."
        name = "import"
        static_attrs = OrderedDict.fromkeys(['module', 'names', 'as', 'namesAs'], None)
        
        def analyse(self, ctx):
            "Load the included file as HyperML tree and add top-level symbols to the current context."
            super(NODES.ximport, self).analyse(ctx)             # analyse attributes list & compute their actual values
            
            moduleName = self.static_vals['module']
            moduleAs = self.static_vals['as']
            names = self.static_vals['names']
            
            module = import_module(moduleName)                  # also added to sys.modules[], together with all parent modules/packages
            
            if moduleAs is not None:                            # add the module itself to the context using the name provided?
                self.tree._check_name(moduleAs, self)
                ctx.push(moduleAs, module)
            elif names is None:                                 # add the module to the context using a default name?
                root = moduleName.split('.')[0]                 # for multi-part package.module names, we must import the root top-level module,
                ctx.push(root, sys.modules[root])               # ...and inner modules will be accessible via '.' then
            
            if names is not None:                               # add selected symbols from the module to the context
                if names == '*':
                    if hasattr(module, '__all__'): names = module.__all__
                    else: names = [n for n in dir(module) if not n.startswith('__')]    # __XXX symbols are excluded by default
                else:
                    if '*' in names:
                        raise HypertagsError("Incorrect 'names' value, the star '*' wildcard must be the only character if present", self)
                    names = names.split()
                    names = filter(None, [n.strip(',') for n in names])     # be forgiving: names are normally space-separated, but let's handle commas, too
                for n in names:
                    ctx.push(n, getattr(module, n))
            
            
    class xinclude(special):
        "Special element <include>. Loads a given file as HyperML tree and adds top-level symbols to the current context. Created during tag pairing."
        name = "include"
        
        # all attributes accepted by this tag
        static_attrs = OrderedDict([('file', None), ('names', None), ('noparse', False)])
        
        content = u""       # contents rendered from the included file
        
        def analyse(self, ctx):
            "Load the file as HyperML tree and add top-level symbols to the current context."
            super(NODES.xinclude, self).analyse(ctx)                # analyse attributes list & compute their actual values

            file = self.static_vals['file']                                                                  # @ReservedAssignment
            names = self.static_vals['names']
            noparse = self.static_vals['noparse']
            
            if file is None: raise HypertagsError("Name of file to include is missing", self)
            if noparse != False and names != None: raise HypertagsError("'names' and 'noparse' can't be set at the same time", self)
            if not self.tree.loader: raise HypertagsError("No loader specified for the document and its dependencies. Can't import '%s'" % file, self)
            
            # the simpler case: when 'noparse' is set, we only load the file as plain text and store in self.content
            if noparse != False:
                self.content = self.tree.load(file, parse = False)
                return
            
            # load the file as a parsed HyperML, possibly retrieved from loader's cache
            hdoc = self.tree.load(file)
            if names is None:                                       # include all symbols + contents, or only the symbols listed by name?
                self.content = hdoc.render()
                names = list(hdoc.symbols.keys())
            else:
                names = names.split()
                names = filter(None, [n.strip(',') for n in names]) # be forgiving: names are normally space-separated, but let's handle commas, too
                
            for name in names:                              # add included symbols to the context, to make them accessible for siblings of <include>
                htag = hdoc.symbols.get(name)
                if htag is None: raise HypertagsError("Hypertag '%s' not found in file '%s'. Import failed" % (name, file), self)
                ctx.push(name, htag)
    
        def render(self, stack, ifnull = ''):
            return self.content
        
    
    class special_hyper(special, xhypertag):
        """A special element that additionally behaves like a hypertag: it has a body and defines new variables 
        that can be referenced by body nodes (not only by siblings, as in non-hyper special elements).
        """        
        def analyse(self, ctx):
            NODES.xhypertag.analyse(self, ctx)
            self.ispure = self.ispure_expand
    
    class xfor(special_hyper):
        """
        Special element: <for>...</for> loop. There are two equivalent forms of usage:
        
        1)  <for item=$items>...</for>
        
        2)  <:X item>...</:X>
            <for $items print=$X />
        
        In the 1st form, 'item' (any attribute name is allowed) becomes a local variable for the body nodes, 
        which are rendered multiple times, once for each item of the collection $items.
        
        Both forms accept an optional attribute sep='\n' - the separator to be added between iterations' outputs. 
        """
        name = "for"
        loopvar = None      # name of the loop variable if present (<for item=$items>...</for>), None otherwise (<for $items print=$H ... />)

        # only these attributes can be given, plus an arbitrary name of the loop variable (definition attribute)
        runtime_attrs = OrderedDict([('items', None), ('print', None), ('sep', '\n')])
        
        def symbols(self, ctx):
            # the form with a hypertag: <for $items print=$H .../>  (empty body, H is expanded for each item)
            if self.attrs.unnamed: 
                if self.body: raise HypertagsError("<for> without a loop variable must have empty body", self)
                return {}
            
            # the form with a loop variable: <for item=$items>...</for>  (body is expanded for each item)
            loopattr = self.attrs.attrs[0]
            self.loopvar = loopattr.name
            return {self.loopvar: loopattr}            
        
        def render(self, stack, ifnull = ''):
            if DEBUG: print("render", "<for>", stack)
            unnamed, kwattrs = self.attrs.evaluate(stack, ifnull)               # evaluate attributes
            
            # is there an unnamed attribute? render the items through a predefined hypertag passed in 'print':
            # <for $items print=$H ... />   OR   <for $items $H ... />
            if unnamed:
                attrs = NODES._actual_attrs(self.runtime_attrs.copy(), unnamed, kwattrs, None, self, self.name)
                if 'print' not in attrs: 
                    raise HypertagsError("<for> tag must contain either a named loop variable or a 'print' attribute, both are missing", self)
                expanded = self.expand_htag(attrs)
            
            # only keyword attributes? the 1st one is the loop variable for rendering this element's body like if it were a hypertag def:
            # <for item=$items> ... </for>
            else:
                items = kwattrs.pop(self.loopvar)
                if 'print' in kwattrs:
                    raise HypertagsError("'print' attribute not allowed in a <for> element with loop variable ('%s')" % self.loopvar, self)
                attrs = NODES._actual_attrs(self.runtime_attrs.copy(), [], kwattrs, None, self, self.name)
                expanded = self.expand_self(items, stack, ifnull)
                
            return attrs['sep'].join(expanded)
        
        def expand_htag(self, attrs):
            "Output of the <for> loop rendered from a hypertag."
            htag = attrs['print']
            items = attrs['items']
            assert isinstance(htag, Closure)        # hypertag must be wrapped up in a Closure that keeps the stack from the point of occurence
            return [htag.expand([x], {}, self) for x in items]
        
        def expand_self(self, items, stack, ifnull):
            "Output of the <for> loop rendered from self.body."
            # create an execution frame and push onto the stack; it will be reused for all iterations of the loop
            top = stack.position()
            stack.push(None)            # create a permanent placeholder for $item instead of pushing/popping every time
            stack.push(top)             # 'top' is the access link; no need to use _find_accesslink(): occurence depth = definition depth
            
            out = []
            for item in items:                  # expand the body multiple times, once for each item of the collection
                stack.set(-2, item)             # stack[-2] is the placeholder for $item
                res = u''.join(n.render(stack, ifnull) for n in self.body)      # render the body
                out.append(res)

            stack.reset(top)
            return out
            
    class xwith(special_hyper):
        """Special element <with>. Created during tag pairing.
        
        <with var1=d1 var2=d2 ... > ... </with>
        
        is equivalent to:
        
        <:H var1=d1 var2=d2 ... > ... </:H>
        <H/>
        
        """
        name = "with"
         
        def symbols(self, ctx):
            if self.attrs.unnamed: raise HypertagsError("Unnamed attributes not allowed in a <with> tag", self)
            for attr in self.attrs.attrs:
                if not attr.expr: raise HypertagsError("Attributes without a value not allowed in a <with> tag", attr)
            return self.attrs.named
 
        def render(self, stack, ifnull = ''):
            "This is actually a hypertag expansion code, with creation of a new stack frame."
            if DEBUG: print("render", "<with>", stack)
            _, kwattrs = self.attrs.evaluate(stack, ifnull)                     # evaluate attributes
            
            # create an execution frame and push onto the stack
            top = stack.position()
            stack.pushall(list(kwattrs.values()))
            stack.push(top)             # 'top' is the access link; no need to use _find_accesslink(): occurence depth = definition depth
            
            out = u''.join(n.render(stack, ifnull) for n in self.body)          # render the body

            stack.reset(top)
            return out
            

    ###  UTILITY METHODS for different types of nodes  ###
    
    @staticmethod
    def _find_accesslink(stack, defDepth, occurDepth):
        """find access link: position in the 'stack' of the frame of the immediate lexical encapsulating hypertag 
        of a given hypertag defined at nestedness depth 'defDepth'.
        """
        assert occurDepth >= defDepth
        accesslink = stack.position()
        hops = occurDepth - defDepth                        # that many backlinks on the stack we must follow to find the right frame
        #print("  occurDepth, self.depth, hops, top:", occurDepth, self.depth, hops, top)
        for _ in range(hops): accesslink = stack.get(accesslink - 1)
        #print("  accesslink:", repr(accesslink))
        assert isint(accesslink) and accesslink >= 0
        return accesslink
        
    
    @staticmethod
    def _actual_attrs(default, unnamed, kwattrs, bodyattr, node, hname, selfclosing = False):
        """Compute actual parameters of hypertag expansion by merging attribute values given in the occurence ('unnamed' list, 'kwattrs' dict) 
        with their default values (OrderedDict). Perform name checking. 'node' is the occurence element that refers to the hypertag.
        WARNING: the 'default' dictionary is modified here and used to pass the result out to the calling function.
        """
        # verify names of keyword attributes
        for name in kwattrs.keys():
            if name not in default: raise HypertagsError("Hypertag '%s' got an unexpected keyword attribute '%s'" % (hname, name), node)
        
        # ensure that the body attribute is NOT explicitly assigned (this is forbidden and usually unintended),
        # unless in a self-closing tag (this has a better chance to be intentional)
        if bodyattr is not None and bodyattr in kwattrs: #and not selfclosing:
            raise HypertagsError("Can't assign explicitly to the body attribute '%s' of a non-void hypertag '%s'" % (bodyattr, hname), node)
        
        # verify the no. of unnamed attributes
        if len(unnamed) > len(default):
            ndef, ngiven = len(default), len(unnamed)
            if bodyattr:                                        # if body attr is present, the no. of explicit attrs is lower
                ndef -= 1; ngiven -= 1
            raise HypertagsError("Hypertag '%s' takes at most %s explicit unnamed attribute(s) (%s given)" % (hname, ndef, ngiven), node)
        
        # assign unnamed values to proper attributes in 'attr'
        attrs = default                                         # NO copy(), we reuse the same 'default' dictionary to store the result (!)
        for name, val in zip(default.keys(), unnamed):
            #if name in kwattrs and (name != bodyattr or not selfclosing):   # body attr CAN be assigned explicitly in a selfclosing <.../> tag
            if name in kwattrs:
                raise HypertagsError("Hypertag got multiple values for keyword attribute '%s'" % name, node)
            if val is not None:                                 # null value, even if explicit, is replaced with the default
                attrs[name] = val
            
        # assign keyword attributes
        for name, val in kwattrs.items():
            if val is not None:                                 # null value, even if explicit, is replaced with the default
                attrs[name] = val
        
        return attrs
        
    @staticmethod
    def _compactify_siblings_(nodes, stack, ifnull, sep = u''):
        "Compactify a list of sibling nodes, by compactifying each one separately when possible and then merging neighboring static nodes."
        out = []
        last = None         # the current last <merged> node; can be expanded if the subsequent node is also pure
        
        for node in nodes:
            #print(' ', node, node.check_pure())
            if node.check_pure():                               # a pure node that can be reduced into a <merged> node?
                if last: last.merge(node, stack, ifnull, sep)
                else: 
                    last = NODES.merged(node, stack, ifnull)
                    out.append(last) 
            else:                                               # non-pure node? let's compactify recursively its subtree and append 
                node.compactify(stack, ifnull)
                out.append(node)
                last = None
        
        return out


########################################################################################################################################################
###
###  HYPERML document tree
###

class HyperML(BaseTree):
    """Syntax tree of a parsed HyperML document and the parsing routines. Subsequent transformations of the tree:
    - parsing - parses source text to AST, with generic syntax nodes as used by a given parser generator (Parsimonious)
    - rewriting - from AST to NODES.x*** nodes; the tree contains primitive expressions: tags, attributes, identifiers, numbers, strings, ...
    - pairing - rewrites a flat list of x*tag/xtext/expression body nodes into a structured tree of xelements, by pairing corresponding start/end tags
    - analysis - semantic analysis of the tree: link occurences of variables and hypertags with their definition nodes, assign other labels
    - rendering - convert the remaining tree to plain output string, typically interpreted further as (X)HTML/XML

    TODO configuration settings:
    - case sensitive/insensitive tag names
    - error handling: strict/inline 
      - in strict mode, exceptions are raised
      - in inline mode, a message is pasted into the output, using the provided template (usually an HTML comment)
    - unpaired tags handling: strict (all tags must be paired) / ignore /
        limited support (a list of tag names that can be left unpaired, typically those in HTML set of empty tags)
    - leading/trailing whitespaces stripped from hypertag definition body or not
    - self-closing slash '.../>' with a leading space or without when printed to the output?
    - xhypertag rendering: ON/OFF? If we want to process a Hyper file several times (e.g., on the server, then by the client), 
      xhypertag rendering to the output should be ON.
    ? $body declared implicitly or explicitly?
      the latter allows for the use of a different name, which may be useful in nested hypertags, when we want to refer to $body attributes
      of several nested hypertags at the same time; the latter is also clearer and more explicit, but creates more boilerplate code.
    ? character encoding of the output and input, to override automatic detection (the user can decode/encode to Unicode outside HyperML)
    """
    
    ###  Configuration of the parsing process (fixed)  ###
    
    parser  = HyperParser()     # parses input text to the 1st version of AST, which undergoes further rewriting to NODES classes later on
    NODES   = NODES             # tell the parser's rewriting routine where node classes can be found
        

    # nodes to be automatically pruned, reduced (replaced with their children) or compactified (replaced with a single child)
    # during rewriting, right after parsing completes; warning: the '_compact_' here corresponds to a *different* compactification
    # process than the public 'compact' setting later on! _compact_ defines simple node reduction done before analysis
    # and based just on the number of children and node type; while 'compact' below controls semantic compactification,
    # when - after symbols are resolved - we find out that some parts of the tree will always render to the same string
    # and thus they can be pre-rendered during analysis.
    _ignore_  = "space ws lt gt slash eval comment html_comment".split() + parser.noparse_names
    _reduce_  = "def_id literal subexpr slice subscript trailer atom value_attr kwattr kwarg " \
                "tag tag_namecore tag_core tag_name tag_name_start tag_name_end markup " \
                "value_in_markup value_attr_common value_attr_named value_attr_unnamed"
    _compact_ = "factor term arith_expr concat_expr shift_expr and_expr xor_expr or_expr comparison " \
                "not_test and_test or_test ifelse_test expr expr_markup value"

    _reduce_anonym_ = True      # reduce all anonymous nodes, i.e., nodes generated by unnamed expressions, typically groupings (...)
    _reduce_string_ = True      # if a node to be reduce has no children but matched a non-empty part of the text, it shall be replaced with a 'string' node 

    
    ###  Configuration of semantic analysis (configurable by the user)  ###

    # Only regular names can be used for attributes inside hypertags and for hypertags themselves.
    regular_name = re.compile(r"^[a-z_][a-z0-9_]*$", re.IGNORECASE)

    # Special tags. They have dedicated x*** node classes, instantiated during tag pairing and providing custom behavior during analysis. Reserved.
    special_tags = set("import include for with".split())

    # These names are reserved and can't be redefined, neither by hypertags nor by hyper-attributes. Case-sensitive match.
    reserved_names = set("true false null if ifnot ifnull".split()) .union (special_tags)

    # 'void' is a set of element names that should be treated as void and closed automatically by the parser after encountering an opening tag.
    # By default it's a complete list of HTML void elements, according to: http://www.w3.org/TR/html-markup/syntax.html#syntax-elements
    # The names are compared in case-insensitive way, like in HTML.
    # Warning: if you want to redefine any of these tags and use as a non-void hypertag, you must remove it from this list before parsing.
    html5_void   = "area base br col command embed hr img input keygen link meta param source track wbr"
    hyperml_void = "import include"
    void         = None

    # Semantics of HyperML language. 
    # The triggers below correspond to design decisions that were difficult to take and may possibly change in the future, 
    # if applications of HyperML show that some other settings are more convenient in practice. 
    ignore_unpaired_endtags   = False   # if True, unpaired end tags are allowed
    allow_html_tags_redefine  = True    # TODO: if False, trying to define a hypertag named like a standard HTML tag (case-INsensitive) will cause an exception
    quote_attr_values         = True    # if True, all values on attribute list, including numerical etc., are converted to string and quoted when rendering
    explicit_body_var         = True    # if True, the $body special variable in hypertag must be explicitly declared as the 1st attribute of non-void hypertag
    check_null_in_var         = False   # if True, variables inside expressions will check nullity of their values and raise NullValue inside variant blocks
    check_null_in_oper        = False   # if True, some operator nodes will check nullity of operands and raise NullValue inside variant blocks
    
    # Loader that was used to load this HyperML source file and should be used for including other related files.
    # Can perform caching and dependencies tracking. See loaders.Loader
    loader = None
    
    # dictionary of external global hypertags/variables imported automatically on parser start-up, just after 'BUILT_IN' symbols;
    # can be overriden in __init__
    globals = {}

    # 'pure_externals': a set of external hypertags/variables that are assumed to be pure functions:
    # returning (or having) always the same value for a given fixed input and never having any side effects.
    # Such functions are pre-computed already during analysis, for efficiency, if only their arguments are pure (same across all render() calls).
    # See: https://en.wikipedia.org/wiki/Pure_function
    pure_externals = set(list(BUILT_IN.values()) + list(FILTERS.values()))
    
    # escaping...
    language = "HTML"   # name of the target language of the document, to mark rendered parts as Text(language) and avoid autoescaping
    escape   = None     # the escape() function to be used when inserting plain text into the main part (markup) of the doc; html_escape() by default
    unescape = None     # the unescape() function to be used when inserting markup text in attribute values; html_unescape() by default
    autoescape = True   # if True, escape() will be called automatically during rendering of the document

    # if True, pure (static, constant) nodes in the document tree will be replaced with their pre-computed render() values
    # and these values will be returned on all future render() requests; this gives large speed improvement, especially when
    # the document comprises mainly static parts and variables occur only occasionally
    compact = True
    
    ###  Properties of this object  ###
    
    filename = None             # name of the file or resource where this document comes from; for debug messages and dependencies tracking
    dependencies = None         # files included by self with <include> tag, as a set of canonical names; for caching and dep. tracking
    init_params = None          # dict of initialization parameters, for passing to a child document in load()
    
    ###  Output of parsing and analysis  ###
    
    text    = None              # full original input string, as was fed to the parser
    ast     = None              # raw AST generated by the parser; for read access by the client
    root    = None              # root node of the final tree after rewriting
    
    symbols   = None            # after _pull(), dict of all top-level symbols as name->node pairs
    hypertags = None            # after _pull(), dict of top-level hypertags indexed by name, for use by the client as hypertag functions;
                                # includes imported hypertags (!), but not external ones, only the native ones defined in HyperML
    
    ###  INSTANTIATION  ###

    def __init__(self, text = None, ast = None, stopAfter = None, _hyperml_context = None, **params):
        """
        :param stopAfter: a string that tells after which phase of analysis to stop; one of: parse, rewrite, pair
        :param _hyperml_context: a Context instance from an outer HyperML tree that should be used as a starting point
            for semantic analysis of this (sub)tree; used when an expression evaluates to HyML code during rendering,
            and this code should be parsed and analysed in a proper context from the main tree (_hyperml_context),
            AFTER the main tree analysis was already completed.
        """
        self.escape = html_escape           # html_escape & html_unescape are functions and setting them at class level
        self.unescape = html_unescape       # would convert them to methods, thus setting here
        
        self.init_params = params.copy()    # remember the configuration parameters, for passing to a child document in load()
        
        def setparam(name):
            val = params.pop(name, None)
            if val is not None: setattr(self, name, val)
        
        # set all configuration parameters passed by the user, those not equal None
        names = HyperML.__dict__.keys()
        for name in names: setparam(name)
        if params: raise Exception("Unrecognized parameter(s) passed to HyperML: %s" % ', '.join(params.keys()))
        
        if self.void is None: 
            self.void = self.html5_void + ' ' + self.hyperml_void
        if isstring(self.void): 
            self.void = self.void.lower().split()
        self.void = set(self.void)
        
        # launch parsing...
        text = unicode(text)                                    # make sure that all parsing and rendering is done consistently on Unicode
        super(HyperML, self).__init__(text, ast, stopAfter)
        if self.root is None:                                   # workaround for Parsimonious bug in the special case when text="" (Parsimonious returns None instead of a tree root)
            self.root = NODES.xdocument(self, ObjDict(start=0, end=0, children=[], expr_name='document'))
        assert isinstance(self.root, NODES.xdocument)
        if stopAfter == "rewrite": return
        
        self.pair()
        if stopAfter == "pair": return

        self.analyse(_hyperml_context)
        if stopAfter == "analyse": return
        
    def load(self, resource, parse = True, dependency = True, **params):
        """Load a document from a given external resource, typically a file identified by path name, 
        parse and return as a new HyperML object (unless parse=False, in which case the plain text is returned).
        If a new HyperML instance is created, it inherits initialization parameters from 'self',
        possibly extended with custom parameters 'params'.
        If a cached and up-to-date copy of the resource is already present in the loader's cache, this copy is returned,
        in such case the parameters of the document are NOT modified! ('params' is not used).
        self.loader is used for resource identification & loading, plus caching of the resulting HyperML 
        or plain text document for possible later use.
        """
        # append main settings from self to 'params', so that the child document inherits non-default settings, 
        # except possibly for those given explicitly in 'params'
        settings = "globals language autoescape compact".split()
        cls = self.__class__
        for name in settings:
            val = getattr(self, name)
            if val is not getattr(cls, name):               # the setting is not a default value as in the class object? append...
                params.setdefault(name, val)
        
        doc, fullname = self._load(resource, self.loader, self.filename, parse, **params)
        if dependency: self.dependencies.add(fullname)      # mark the loaded resource as self's dependency
        return doc

    @classmethod
    def _load(cls, resource, loader, referrer = None, parse = True, **params):
        """
        The actual implementation of load(). As a class method, it can be used for initial loading of the first document,
        when no documents have been loaded yet and there's no way to call the instance method load().
        This method requires more parameters to be specified than load():
        - 'loader': a subclass of fireweb.loaders.Loader or any class exposing the same interface;
        - 'referrer': name of the file that requested loading of the resource, for file name resolving.
        Returns a pair: the document (HyperML or string) and its canonical name (as calculated from 'resource' and 'referrer').
        """
        
        # try to get the cached copy first
        fullname = loader.canonical(resource, referrer)
        #print("HyperML.load(%s):" % fullname)
        #printdict(loader.cached)
        hdoc = loader.get(fullname)
        #if hdoc is not None: print("HyperML document retrieved from CACHE:", fullname)
        
        # if present, 'hdoc' is either raw contents of the file or a parsed HyperML doc;
        # return the doc only if this is what we're looking for, otherwise we have to load and/or parse the doc again
        if isinstance(hdoc, HyperML):
            res = hdoc.text if not parse else hdoc
            return res, fullname
        if isstring(hdoc) and not parse:
            return hdoc, fullname
        
        # only if the resource is not present in cache, or not in the desired form (of a parsed doc), 
        # or has been modified on disk (cache copy is dirty), load it from scratch; parse if necessary
        doc, meta = loader.load(fullname)
        #print("HyperML document loaded from DISK:", fullname)
        
        if not parse:
            loader.cache(fullname, doc, meta, set())            # cache raw document for later use; no dependencies for raw files
            return doc, fullname
            
        hdoc = HyperML(doc, filename = fullname, loader = loader, **params)
        loader.cache(fullname, hdoc, meta, hdoc.dependencies)   # cache parsed document for later use; loader can ignore this if it doesn't handle caching
        return hdoc, fullname
        

    ###  DOCUMENT PROCESSING  ###

    def pair(self):
        """
        Tag pairing. Walk through the tree to find matching start/end tags (xstart_tag, xend_tag)
        and replace them with instances of <xelement> or its subclasses.
        This is the 1st step of semantic analysis and must be called before analyse().
        Unlike analyse(), tag pairing does NOT need to maintain current Context when walking down the tree.
        """
        self.root.pair()
        
    def analyse(self, ctx = None):
        "Link occurences of variables and hypertags with their definition nodes, collect all symbols defined in the document."
        
        if self.loader:                 # only upon analyse() we start tracking dependencies, extracted from <include> nodes;
            self.dependencies = set()   # before analysis, dependencies are not known and must not be relied upon (equal None)
        
        for name in self.globals:       # make sure that global symbols use correct names: only regular identifiers, and not reserved
            self._check_name(name, None, "Error in global symbols. ")
        
        ctx = ctx.copy() if ctx else Context()
        ctx.pushall(BUILT_IN)           # seed the context with built-in symbols
        ctx.pushall(FILTERS)            # ...and standard filters
        ctx.pushall(self.globals)       # seed the context with initial global symbols configured by the user
        state = ctx.getstate()          # keep the state, so that after analysis we can retrieve newly defined symbols alone
        if DEBUG:
            global _debug_ctx_start
            _debug_ctx_start = state
        
        self.root.analyse(ctx)          # now we have all top-level symbols in 'ctx'
        
        # pull top-level symbols & hypertags from the tree and make them into attributes of self that can be accessed directly by the user, 
        # for rendering of arbitrary hypertags in isolation from the rest of the document.
        # Warning: if there is a name clash between a hypertag and an existing property of 'self', the hypertag is not assigned to the property
        # and remains accessible by self.hypertags[name] or self[name] only! Use the latter syntax if you need a bullet-proof code.
        
        self.symbols = ctx.asdict(state)
        self.hypertags = {name: obj for name, obj in self.symbols.items() if isinstance(obj, NODES.xhypertag)}
        for name, htag in self.hypertags.items():
            if not hasattr(self, name):
                setattr(self, name, htag)
    
        # perform compactification; a part of it was already done during analysis, because every hypertag launches
        # compactification in its subtree on its own, during analysis; what's left is compactification 
        # of the top-level document only
        if self.compact: self.compactify()
        
    def compactify(self):
        """
        Replace pure nodes in the document tree with static string/value nodes containg pre-computed render() result 
        of a given node, so that this pre-computed string/value is returned on all future render() calls on the new node.
        
        The document node doesn't take any arguments, so its render() is often a pure function, if only there are no non-pure
        external references to variables/functions inside. So yes, the document can in many cases be replaced with a static string!
        Although we lose access to the original tree (except the access via self.symbols and self.hypertags),
        this access is normally not needed anymore. If it is, you should disable compactification in parser settings.
        """
        self.root.compactify(Stack(), '')
    
    def render(self):
        return self.root.render(Stack())

    def __getitem__(self, tagname):
        "Returns a given top-level hypertag node wrapped up in Hypertag, for isolated rendering. Analysis must have been performed first."
        return self.hypertags[tagname]
                
    def __str__(self):
        doc = BaseTree.__str__(self)
        if not self.symbols: return doc
        symbols = [self.info(node) for node in self.symbols.values()]
        return '\n'.join([doc] + flatten(symbols))

        
    ###  PRIVATE METHODS  ###
    
    def _check_name(self, name, node, msg = ""):
        "Check if a newly defined name of a module/hypertag/attribute is regular and not reserved. Raise an exception on error."
        if not self.regular_name.match(name):
            raise HypertagsError(msg + "Irregular name, contains a character disallowed in an identifier: '%s'" % name, node)
        if name in self.reserved_names:
            raise HypertagsError(msg + "This name is reserved and can't be used for an identifier: '%s'" % name, node)
    
    def _pair_tags(self, nodes):
        """Match start tags with their corresponding end tags on the 'nodes' list, replace them with xelements and return as a new list.
        Creates hierarchy of nested markup elements instead of a flat sequence of raw tags. Works bottom-up, no recursion. Time O(n).
        """
        out = []
        
        def elemclass(tag):
            "Pick the right x*** node class from NODES for a given tag type."
            if tag.ishypertag: return NODES.xhypertag
            if tag.name in self.special_tags: return getattr(NODES, "x" + tag.name)
            return NODES.xelement
        
        def process(node):
            "If 'node' is a self-closing, void or end tag, convert it (and the matching start tag) to an element"
            if node.type == "empty_tag" or (node.type == "start_tag" and not node.ishypertag and node.name.lower() in self.void):    # void element?
                cls = elemclass(node)
                elem = cls(self, node, None, [])
                out.append(elem)
                return
            
            # end tag? find corresponding start_tag, merge into an element and extract all nodes in-between as a body
            elif node.type == "end_tag":
                for offset, start in enumerate(reversed(out)):
                    if start.type == "start_tag" and start.name == node.name and bool(start.ishypertag) == bool(node.ishypertag):
                        body = out[-offset:] if offset else []
                        del out[-offset-1:]
                        cls = elemclass(start)
                        elem = cls(self, start, node, body)
                        out.append(elem)
                        return
                if not self.ignore_unpaired_endtags:
                    name = node.name.lower()
                    if name in self.void:
                        raise HypertagsError("<%s> is declared as a void element in parser settings and must not be accompanied by a closing tag," % name, node)
                    raise HypertagsError("Can't find matching start tag for an end tag (possibly the start tag, if present, has a syntax error and was left unparsed)", node)
            
            elif node.type == "variant":            # variant nodes are already paired, but we have to propagate the pairing process to their inner tags
                node.pair()
            
            out.append(node)                        # end_tag can be appended if no matching start_tag was found
        
        for n in nodes: process(n)
        return out
        

########################################################################################################################################################
###
###  Shorthands
###

def parse(doc, **params): return HyperML(doc, **params)
def render(doc, **params): return HyperML(doc, **params).render()

DEBUG = False
_debug_ctx_start = None             # position where the actual local context begins (after built-in & global symbols)


########################################################################################################################################################
###
###  MAIN
###

txt = """
<:pagin ~ letter searchKeyword searchPublisher>
    <:url page><join>        [# this URL is HTML-encoded on output, but when used as an attribute value href=$url(...) it gets auto-unescaped #]
        /journals/$page 
        [[ /$letter ]]
        [[ ?q=$(searchKeyword) ]]
        [[ ?publisher=$(searchPublisher) ]]
    </join></:url>
    $url(2)
    <a href=$url(2) />
    <a href=$url(3) />
</:pagin>
<pagin 'C' "kot &amp; 'pies'" />
"""

txt = """
<:A ~ f>$f()</:A>
<:B ~ x>
<:H>$x</:H>
$H()
<A $H/>
</:B>
<B 'ARG'></B>
"""

txt = """
<:A><splitlines>
    <a href="/">Home</a>
    Search results
</splitlines></:A>
"""

"""
try:
    raise TypeError("cause")
except TypeError, e:
    raise MyException("result"), None, sys.exc_info()[2]
"""


if __name__ == '__main__':
    
    timer = Timer()

    import doctest
    print(doctest.testmod())
    print("Time elapsed:      ", timer)

    exit()

    DEBUG = True
    
    #print(parse("ala ma kota " * 100))
    
    #grammar = Grammar('text = (~"."i)*')
    #tree = grammar.parse("ala <ma> kota ")
    #node = tree.children[1] #.children[0]
    #print(type(node), node.__dict__, node.expr_name, node.start, node.end, node.text)
    #exit()

    #txt = """<html> <:psa rasa>$rasa Burka</:psa> 'ala' <ma href="www" style=""> "kota" </ma> i <psa rasa="terier"/> oraz <psa></psa> </unpaired> </html>"""
    tree = HyperML(txt, stopAfter = "rewrite", compact=True, globals = FILTERS) # jinja_filters.copy())
    print()
    print("===== AST =====")
    print(tree.ast)
    print(type(tree.ast))
    print()
    print("===== After rewriting =====")
    print(tree)
    print()
    
    print("===== After tag pairing =====")
    tree.pair()
    print(tree)
    print()
    
    print("===== After semantic analysis =====")
    tree.analyse()
    print()
    print(tree)
    print()
    
    print("===== After rendering =====")
    print(tree.A())
    #print(tree.render())
    print()
    