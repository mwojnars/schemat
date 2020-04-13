"""
Exceptions for Hyperweb.
"""

class ConfigError(Exception): pass
class SysConfigError(ConfigError): pass

class ItemDoesNotExist(Exception):
    """The requested object does not exist in DB."""
    item_class = None

class InvalidName(Exception): pass
class InvalidHandler(InvalidName): pass

class DuplicateName(Exception): pass
class DuplicateHandler(DuplicateName): pass

class SerializationError(Exception): pass
class StateError(Exception):
    """State passed to deserialization (Value.setstate()) is incorrect and can't be decoded back into a Value instance."""

