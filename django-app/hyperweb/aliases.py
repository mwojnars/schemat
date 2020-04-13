from .errors import SysConfigError
from .utils import import_

#####################################################################################################################################################

class Aliases:
    """
    Predefined mapping of full python names (package+module+name) of selected python entities
    (typically, classes) to short names for use in serialization of items and attribute values.
    """
    
    # per-class aliases
    aliases     = None      # [dict] mapping of full python names to aliases
    aliases_rev = None      # [dict] reverse mapping: alias -> full name
    
    def __init__(self, aliases, validate = False):
        """
        The argument, `aliases`, is a list of generic aliases of the form:
            (from-prefix, to-prefix, list-of-suffixes)
        Typically, "from-prefix" is a package-module name with a trailing dot;
        while "list-of-suffixes" is a list of names to be aliased in a given module.
        """
        self.aliases = {}
        
        # translate prefix-suffix aliases to direct per-class mappings;
        # validate correctness of original class names
        for from_prefix, to_prefix, suffixes in aliases:
            for suffix in suffixes:
                fullname = from_prefix + suffix
                
                # check validity of the `fullname`;
                # this can be skipped (validate=False) if not all system modules have been loaded
                if validate:
                    try:
                        import_(fullname)
                    except Exception as ex:
                        raise SysConfigError(f"cannot import name '{fullname}' during Aliases initialization; cause: {ex}")
                
                alias = to_prefix + suffix
                self.aliases[fullname] = alias
        
        # compute a reversed mapping and check against duplicate aliases
        self.aliases_rev = {alias: fullname for fullname, alias in self.aliases.items()}
        if len(self.aliases_rev) < len(self.aliases):
            raise Exception("Aliases are not unique:", aliases)
    
    
    def encode(self, fullname):
        return self.aliases.get(fullname, fullname)

    def decode(self, alias):
        return self.aliases_rev.get(alias, alias)


