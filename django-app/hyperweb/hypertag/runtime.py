import importlib
from six.moves import builtins

from hyperweb.hypertag.grammar import MARK_TAG, MARK_VAR
from hyperweb.hypertag.AST import HypertagAST


#####################################################################################################################################################
#####
#####  RUNTIME
#####

class Runtime:
    """
    Base class for runtime execution environments of Hypertag scripts. A runtime keeps references to external
    scripts and modules, as well as dynamic *context* of a particular execution.
    Enables import of tags and variables from these external sources to a Hypertag script.
    Sources are identified by "paths". The meaning of a particular path is decided by the Runtime or its subclasses.
    In the future, Runtime may include a *routing* mechanism that maps external names of resources
    to an arbitrarily defined namespace of paths as visible to a script.
    
    Standard Runtime allows imports of 3 types:
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
        from HY:context ...
        from HY:builtins ...
        from HY:html ...
    Python paths:
        from os.path import ...
        from ..package.module import ...
        from PY:builtins ...
        from PY:os.path ...
        from PY:..package.module ...
    Filesystem paths:
        from file://127.0.0.1/home/marcin/...
        from file:/home/marcin/...
        from file:../../scripts/...
    DB paths:
        from [table] import ...
        from DB/db.table[name_column,code_column] import ...
        from DB/db.table[name=ITEM] import %column as page               -- entire script parsed as a tag, with nested tags
        from DB/db.table[name=ITEM] import $column1, $column2, ...
    Catalog paths:
        from CT:CATEGORY.field[item].subfield import ....
        from CT:CATEGORY.script import %tag ....
        from CT:CATEGORY import $title, $name, ....
        from CT:meta.cat:XXXX/view import ...
        from CT:meta.cat[NAME]/view
        from CT:space.categ:XXXX
    Abstract paths:
        from
        
    URI schemes:  PY: HY: FILE: file:
    """

    # canonical paths of predefined modules
    PATH_CONTEXT  = 'CONTEXT'
    PATH_BUILTINS = 'BUILTINS'
    
    # precomputed dict of built-in symbols, to avoid recomputing it on every __init__()
    BUILTINS = {MARK_VAR + name : getattr(builtins, name) for name in dir(builtins)}
    
    # symbols to be imported automatically upon startup; subclasses may define a broader collection
    DEFAULT  = BUILTINS
    
    language = None     # target language the documents will be compiled into, defined in subclasses
    compact  = True     # if True, compactification is performed after analysis: pure (static, constant) nodes are replaced with their pre-computed render() values,
                        # which are returned on all subsequent render() requests; this improves performance when
                        # a document contains many static parts and variables occur rarely
    escape   = None     # escaping function or static method that converts plaintext to target language; typically, when assigned
                        # in a subclass, staticmethod() must be applied as a wrapper to prevent this attr be treated as a regular method:
                        #   escape = staticmethod(custom_function)

    modules  = None     # cached modules and their symbols: {canonical_path: module}, where "module" is a dict of symbols and their values
    
    @property
    def context(self): return self.modules[self.PATH_CONTEXT]

    
    def __init__(self, __tags__ = None, **variables):
        """
        :param __tags__: dict of tag names and their Tag instances/classes that shall be made available to the script
                     as a dynamic "context" of execution; names can be prepended with '%', though this is not mandatory
        :param variables: names of external variables that shall be made available to the script
                     as a dynamic "context" of execution
        """
        self.modules = {}
        self.modules[self.PATH_BUILTINS] = self.BUILTINS
        self.modules[self.PATH_CONTEXT]  = self._create_context(__tags__, variables)
        
    @staticmethod
    def _create_context(tags, variables):

        context = {}
        if tags:
            # TODO: check if names are non-empty and syntactically correct
            context.update({name if name[0] == MARK_TAG else MARK_TAG + name : link for name, link in tags.items()})
            
        context.update({MARK_VAR + name : value for name, value in variables.items()})
        return context
        
    def import_one(self, symbol, path = None):
        """`symbol` must start with either % or $ to denote whether a tag or a variable should be imported."""

        module = self._get_module(path)
        if symbol not in module: raise ImportError(f"cannot import '{symbol}' from a given path ({path})")
        return module[symbol]
    
    def import_all(self, path = None):
        """
        Import all available symbols (tags and variables) from a given `path`, private symbols excluded.
        A private symbol is the one whose name (after %$) starts with "_".
        Return a dict of {symbol: object} pairs. Every symbol starts with either % (a tag) or $ (a variable).
        """
        module = self._get_module(path)
        return {name: value for name, value in module.items() if name[1] != '_'}

    def import_default(self):
        """
        Import default symbols that shall be available to every script upon startup.
        This typically means all built-in symbols + standard tags/variables specific for a target language.
        """
        return self.DEFAULT
    
        
    def _get_module(self, path_original):

        path   = self._canonical(path_original)
        module = self.modules.get(path)

        if module is None:
            module = self._load_module(path)
            if module is None: raise ModuleNotFoundError(f"import path not found '{path_original}'")
            self.modules[path] = module
        
        return module

    def _canonical(self, path):
        """Convert `path` to its canonical form."""
        if path is None: return self.PATH_CONTEXT
        return path
        
    def _load_module(self, path):
        """Path must be already converted to a canonical form."""
        mod = self._load_module_hypertag(path)
        if mod is None:
            mod = self._load_module_python(path)
        return mod
        
    def _load_module_hypertag(self, path):
        """"""
        pass
        
    def _load_module_python(self, path):
        """
        Both absolute and relative Python paths are supported. The latter require that "$__package__" variable
        is properly set in the context.
        """
        package = self.context.get('$__package__')
        return importlib.import_module(path, package)

    def render(self, script, **config):
    
        ast = HypertagAST(script, self, **config)
        return ast.render()
        

# class CompoundRuntime(Runtime):
#     """Runtime that combines multiple sub-runtimes, each one having its own XX/ prefix to be added to import paths."""
#
#     loaders = {
#         'HY':   HypertagLoader,
#         'PY':   PythonLoader,
#         'file': FileLoader,
#     }
    
