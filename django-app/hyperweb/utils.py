# from hypertag import HyperHTML
#
#
# # standard global Hypertag runtime
# hyperhtml = HyperHTML()
#
#
# def hypertag(view, render = True, **context):
#     """
#     Utility function that uses Hypertag's HyperHTML runtime with standard loaders
#     to translate and (optionally) render a given `view`.
#     """
#     run = hyperhtml.render if render else hyperhtml.translate
#     return run(view, **context)



def common_indent(text):
    """
    Retrieve the longest indentation string fully composed of whitespace
    that is shared by ALL non-empty lines in `text`, including the 1st line (if it contains a non-whitespace).
    """
    lines = text.split('\n')
    lines = list(filter(None, [l.rstrip() for l in lines]))             # filter out empty or whitespace-only lines
    if not lines: return ''
    
    # iterate over columns of `text`, from left to right
    for i, column in enumerate(zip(*lines)):        # zip() only eats up as many characters as the shortest line
        if not column[0].isspace() or min(column) != max(column):
            return lines[0][:i]
    else:
        size = min(map(len, lines))
        return lines[0][:size]                      # when all lines are prefixes of each other take the shortest one
    
def dedent(text):
    """
    Remove maximum common indentation in `text`.
    """
    indent = common_indent(text)
    if text.startswith(indent): text = text[len(indent):]
    return text.replace('\n' + indent, '\n')

