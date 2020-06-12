from nifty.parsing.parsing import ParserError

########################################################################################################################################################

class HyMLError(ParserError):
    def make_msg(self, msg):
        if self.pos and self.node and self.node.tree.filename:
            return msg + " in '%s', line %s, column %s (%s)" % (self.node.tree.filename, self.line, self.column, self.text)
        if self.pos:
            return msg + " at line %s, column %s (%s)" % (self.line, self.column, self.text)

# class HyMLSyntaxError(ParserError): pass
# class HyMLRuntimeError(ParserError): pass

########################################################################################################################################################

class UndefinedTag(HyMLError):
    pass
class NotATag(HyMLError):
    pass

class DuplicateAttribute(HyMLError):
    pass


class MissingValue(HyMLError):
    """
    Empty (false) value was returned by an expression marked with "!" (obligatory) qualifier.
    Typically, this exception is caught at a higher level with a "try" block.
    """
    
class NoneExpression(HyMLError):
    """
    """
    def __init__(self, msg = "expression embedded in text evaluates to None"):
        Exception.__init__(self, msg)

    
class VoidTag(HyMLError):
    """
    Raised when non-empty body is passed to a void tag (i.e., a tag that doesn't accept body).
    """
    def __init__(self, msg = "body must be empty for a void tag"):
        Exception.__init__(self, msg)
    
