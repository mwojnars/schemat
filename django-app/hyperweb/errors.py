"""
Exceptions for Hyperweb.
"""

class ItemDoesNotExist(Exception):
    """The requested object does not exist in DB."""
    item_class = None

class InvalidName(Exception): pass
class InvalidHandler(InvalidName): pass

class DuplicateName(Exception): pass
class DuplicateHandler(DuplicateName): pass


