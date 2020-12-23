import six.moves.builtins as builtins


#####################################################################################################################################################
#####
#####  DEFINITIONS
#####

MARK_TAG = '%'
MARK_VAR = '$'

def TAG(name):
    """Convert a tag name to a symbol, for insertion to (and retrieval from) a Context."""
    return MARK_TAG + name

def VAR(name):
    """Convert a variable name to a symbol, for insertion to (and retrieval from) a Context."""
    return MARK_VAR + name

def TAGS(names):
    """Mapping of a dict of tag names (and their linked objects) to a dict of symbols."""
    return {TAG(name): link for name, link in names.items()}

def VARS(names):
    """Mapping of a dict of variable names (and their linked objects) to a dict of symbols."""
    return {VAR(name): link for name, link in names.items()}


#####################################################################################################################################################
#####
#####  ENVIRONMENT
#####

class Environment:
    """
    Base class for execution environments of Hypertag scripts. An environment keeps references to external
    scripts and modules, as well as dynamic *context* of a particular execution.
    Enables import of tags and variables from these external sources to a Hypertag script.
    Sources are identified by "paths". The meaning of a particular path is decided by the Environment or its subclasses.
    In the future, Environment may include a *routing* mechanism that maps external names of resources
    to an arbitrarily defined namespace of paths as visible to a script.
    
    Standard Environment allows imports of 3 types:
    - import %X, $Y (no source path specified): imports from core builtin symbols + runtime context passed to parse()
    - from
    
    Builtin paths:
        import ...                      -- import from context
        from `context import ...
        from ~context import ...
        from [context] import ...
        from [builtins] import ...
        from [python.builtins] import ...
        from [hypertag.builtins] import ...
        from [hypertag.html] import ...
        from HY/context ...
        from HY/builtins ...
        from HY/html ...
    Python paths:
        from os.path import ...
        from ..package.module import ...
        from PY/builtins ...
        from PY/os.path ...
        from PY/..package.module ...
    Filesystem paths:
        from FILE//home/marcin/...
        from FILE/../../scripts/...
    DB paths:
        from [table] import ...
        from DB/db.table[name_column,code_column] import ...
        from DB/db.table[name=ITEM] import %column as page               -- entire script parsed as a tag, with nested tags
        from DB/db.table[name=ITEM] import $column1, $column2, ...
    Catalog paths:
        from CT/CATEGORY.field[item].subfield import ....
        from CT/CATEGORY.script import %tag ....
        from CT/CATEGORY import $title, $name, ....
        from CT/meta.cat:XXXX/view import ...
        from CT/meta.cat[NAME]/view
        from CT/space.categ:XXXX
    Abstract paths:
        from
    """

    CONTEXT_PATH = 'CONTEXT'
    
    context = None      # dict of symbols that belong to dynamic context

    
    def __init__(self, __tags__ = None, **variables):
        """
        :param __tags__: dict of tag names and their Tag instances/classes that shall be made available to the script
                     as a dynamic "context" of execution; names can be prepended with '%', though this is not mandatory
        :param variables: names of external variables that shall be made available to the script
                     as a dynamic "context" of execution
        """
        self.context = {}
        if __tags__:
            # TODO: check if names are non-empty and syntactically correct
            self.context.update({name if name[0] == MARK_TAG else MARK_TAG + name : link for name, link in __tags__.items()})
            
        self.context.update({MARK_VAR + name : value for name, value in variables.items()})
        
        
    def import_default(self):
        """
        Import default symbols that shall be available to every script upon startup.
        This typically means all built-in symbols.
        """
        raise NotImplementedError
    
    def import_all(self, path = None):
        """
        Import all available symbols (tags and variables) from a given `path`, private symbols excluded.
        A private symbol is the one whose name starts with "_".
        Returns a dict of {symbol: object} pairs. Every symbol starts with either % (a tag) or $ (a variable).
        """
        raise NotImplementedError

    def import_one(self, symbol, path = None):
        """`symbol` must start with either % or $ to denote whether a tag or a variable should be imported."""
        
        if path is None:
            path = self.CONTEXT_PATH
            
        if path == self.CONTEXT_PATH:
            if symbol not in self.context: raise ImportError(f"cannot import '{symbol}' from '{path}'")
            return self.context[symbol]
        
        assert False
        

class HypertagEnvironment(Environment):
    """Builting tags and functions defined by Hypertag; plus context symbols passed ."""
    
class PythonEnvironment(Environment):
    """Imports from python modules using standard Python path syntax (package.module), with absolute or relative paths."""
    
class CompoundEnvironment(Environment):
    """Environment that combines multiple sub-environments, each one having its own XX/ prefix to be added to import paths."""
    
class StandardEnvironment(Environment):
    """"""
    environments = {
        'HY': HypertagEnvironment,
        'PY': PythonEnvironment,
    }
    
