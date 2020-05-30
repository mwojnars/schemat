from nifty.parsing.parsing import ParserError

########################################################################################################################################################

class HyMLError(ParserError):
    def make_msg(self, msg):
        if self.pos and self.node and self.node.tree.filename:
            return msg + " in '%s', line %s, column %s (%s)" % (self.node.tree.filename, self.line, self.column, self.text)
        if self.pos:
            return msg + " at line %s, column %s (%s)" % (self.line, self.column, self.text)

class UndefinedVariable(HyMLError):
    pass

class NullValue(HyMLError):
    """
    Null value was encountered during rendering of a node or evaluation of an expression.
    This exception is used to communicate null (None) values back to higher-level nodes during rendering
    and can be caught by xvariant node to choose the right variant from among multiple choices.
    Or, if raised by an expression, it can substitute TypeError for communicating a disallowed use
    of None value as an operand - in such, the exception can be passed all the way up to the client.
    """
    def __init__(self, msg = "Null value encountered during rendering of a node"):
        Exception.__init__(self, msg)
    
class NoneExpression(HyMLError):
    """
    """
    def __init__(self, msg = "expression embedded in text evaluates to None"):
        Exception.__init__(self, msg)
    
class BodyDisallowed(HyMLError):
    """
    Raised when non-empty body is provided for a void tag.
    """
    def __init__(self, msg = "body must be empty for a void tag"):
        Exception.__init__(self, msg)
    
