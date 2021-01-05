import importlib
from six.moves import builtins

from hypertag.core.errors import ImportErrorEx, ModuleNotFoundEx
from hypertag.core.grammar import MARK_TAG, MARK_VAR, TAGS
from hypertag.core.AST import HypertagAST
import hypertag.builtins


#####################################################################################################################################################
#####
#####  UTILITIES
#####

def _read_module(module):
    """
    Pull symbols: tags & variables from a module and return as a dict.
    All top-level symbols are treated as variables; tags are pulled from a special dictionary named `__tags__`.
    """
    symbols = {MARK_VAR + name : getattr(module, name) for name in dir(module)}
    tags = symbols.pop('$__tags__', None)
    if tags:
        assert isinstance(tags, dict), "module's __tags__ if present must be a dict"
        symbols.update({name if name[0] == MARK_TAG else MARK_TAG + name : link for name, link in tags.items()})
        
    return symbols


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
    
    Context = virtual module whose contents is initialized when a new script is to be rendered;
              all scripts imported by the initial one use the SAME context module (!);
              `from hypertag import context` - global object that provides access to current context from Python code (??)
    
    Builtin paths:
        import ...                      -- import from context
        from ~context import ...
        from [context] import ...
        from [builtins] import ...
        from [python.builtins] import ...
        from hypertag.core.builtins import ...
        from hypertag.core.html import ...
        from hypertag.core.context import ...
        from ~ import ...
        from ^ import ...
        from / import ...
        from . import ...    -- this in python means importing from the current package's __init__.py (!)
        from HY:context ...
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

    # precomputed dict of built-in symbols to avoid recomputation on every __init__()
    BUILTINS = _read_module(builtins)
    BUILTINS.update(_read_module(hypertag.builtins))
    
    # symbols to be imported automatically upon startup; subclasses may define a broader collection
    DEFAULT = BUILTINS
    
    # canonical paths of predefined modules
    PATH_CONTEXT = '~'
    
    standard_modules = {
        PATH_CONTEXT: {},
    }

    language = None     # target language the documents will be compiled into, defined in subclasses
    #compact  = True    # if True, compactification is performed after analysis: pure (static, constant) nodes are replaced with their pre-computed render() values,
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
        self.modules = self.standard_modules.copy()
        self.update_context(__tags__, variables)
        
    def update_context(self, tags, variables):
        
        if not (tags or variables): return
        self.modules[self.PATH_CONTEXT] = context = self.modules[self.PATH_CONTEXT].copy()
        context.update(self._create_context(tags, variables))
        
    @staticmethod
    def _create_context(tags, variables):

        context = {}
        if tags:
            # TODO: check if names of tags are non-empty and syntactically correct
            context.update({name if name[0] == MARK_TAG else MARK_TAG + name : link for name, link in tags.items()})
        if variables:
            context.update({MARK_VAR + name : value for name, value in variables.items()})
        return context

    def import_one(self, symbol, path = None, ast_node = None):
        """`symbol` must start with either % or $ to denote whether a tag or a variable should be imported."""

        module = self._get_module(path, ast_node)
        if symbol not in module: raise ImportErrorEx(f"cannot import '{symbol}' from a given path ({path})", ast_node)
        return module[symbol]
    
    def import_all(self, path = None, ast_node = None):
        """
        Import all available symbols (tags and variables) from a given `path`, private symbols excluded.
        A private symbol is the one whose name (after %$) starts with "_".
        Return a dict of {symbol: object} pairs. Every symbol starts with either % (a tag) or $ (a variable).
        """
        module = self._get_module(path, ast_node)
        return {name: value for name, value in module.items() if name[1] != '_'}

    def import_default(self):
        """
        Import default symbols that shall be available to every script upon startup.
        This typically means all built-in symbols + standard tags/variables specific for a target language.
        """
        return self.DEFAULT
    
        
    def _get_module(self, path_original, ast_node):

        path   = self._canonical(path_original)
        module = self.modules.get(path)

        if module is None:
            module = self._load_module(path)
            if module is None: raise ModuleNotFoundEx(f"import path not found '{path_original}'", ast_node)
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
        return None
        
        # filename = None
        # script = open(filename).read()
        #
        # # CONTEXT has already been extended by a calling method and will be available to the script below (!)
        # dom, symbols = self.translate(script)
        #
        # return symbols
        
    def _load_module_python(self, path):
        """
        Both absolute and relative Python paths are supported. The latter require that "$__package__" variable
        is properly set in the context.
        """
        package = self.context.get('$__package__')
        try:
            module  = importlib.import_module(path, package)
            return _read_module(module)
        except:
            return None

    def translate(self, script, __tags__ = None, **variables):
        
        self.update_context(__tags__, variables)
        ast = HypertagAST(script, self)
        return ast.translate()
        
    def render(self, script, __tags__ = None, **variables):
        
        dom, symbols = self.translate(script, __tags__, **variables)
        return dom.render()
        

# class CompoundRuntime(Runtime):
#     """Runtime that combines multiple sub-runtimes, each one having its own XX/ prefix to be added to import paths."""
#
#     loaders = {
#         'HY':   HypertagLoader,
#         'PY':   PythonLoader,
#         'file': FileLoader,
#     }
    
