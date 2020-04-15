from .errors import EncodeError, EncodeErrors, DecodeError
from .schema import Type
from .utils import import_
from .globals import aliases
from .core import Item, site


#####################################################################################################################################################
#####
#####  ATOMIC types
#####

class String(Type):
    
    def encode(self, value):
        return value

    def decode(self, value):
        if not isinstance(value, str): raise DecodeError(f"expected a <str>, not {value}")
        return value

class Python(Type):
    """Wrapper around a python object/class specified by its full package-module name."""
    
    def encode(self, value):
        if value is None: return None
        cls = value
        fullname = cls.__module__ + "." + cls.__name__
        fullname = aliases.encode(fullname)
        return fullname
    
    def decode(self, value):
        if not isinstance(value, str): raise DecodeError(f"expected a <str>, not {value}")
        fullname = aliases.decode(value)
        return import_(fullname)
        

class Dict(Type):
    """Specification of a key-value mapping where every key must be unique; wrapper for a standard <dict> type."""

class Link(Type):
    """
    The python value is an Item object.
    The underlying DB value is an ID=(CID,IID), or just IID, of an item.
    """
    
    # default CID: if item's CID is equal to this, only IID is stored; otherwise, complete ID is stored
    cid = None
    
    def encode(self, item):
        
        if None in item.__id__:
            raise EncodeError(f"Linked item does not exist or its ID is missing, ID={item.__id__}")
            
        if self.cid is not None and item.__cid__ == self.cid:
            return item.__iid__
        
        return item.__id__

    def decode(self, value):
        
        cid = iid = None
        
        if isinstance(value, int):
            iid = value
            if self.cid is None:
                raise DecodeError(f"expected a (CID,IID) tuple, but got only IID ({iid})")
        else:
            # unpack (CID,IID)
            try:
                cid, iid = value
            except Exception as ex:
                raise DecodeError(f"expected a (CID,IID) tuple, not {value} - {ex}")

            if not isinstance(cid, int):
                raise DecodeError(f"expected CID to be an integer, but got {type(cid)} instead: {cid}")
            if not isinstance(iid, int):
                raise DecodeError(f"expected IID to be an integer, but got {type(iid)} instead: {iid}")

        # if self.cid is not None:
        #     if cid is not None and cid != self.cid:
        #         raise DecodeError(f"expected CID={self.cid}, not {cid}")
        
        if cid is None:
            cid = self.cid
            
        category = site.get_category(cid)
        return category.new(__id__ = (cid, iid))
        