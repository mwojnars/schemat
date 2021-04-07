#
# Sample view file for testing of Hypertag-Django backend
#

context $item
from .view2 import $x

% aCategory
    a href=$item.__category__.get_url() | {item.__category__.name? or item.__category__}
    -- TODO: aCategory should be inserted in inline mode to avoid spaces around parentheses (...)

html
    head
        title | {item.name? or item}
    body
        h1
            | {item.name? or item} (
            aCategory
            | ) -- ID {item.__id__}
        p
            | Category:
            aCategory
        p:b | Loaded from Django template file! x = $x
        h2  | Attributes
        ul
            for attr, value in item.__data__.items()
                li
                    b | {attr}:
                    . | {value}
