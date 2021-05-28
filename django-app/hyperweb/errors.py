"""
Exceptions for Hyperweb.
"""

class HyperwebException(Exception): pass

class ConfigError(Exception): pass
class SysConfigError(ConfigError): pass

class ItemDoesNotExist(Exception):
    """The requested object does not exist in DB."""
    item_class = None

class InvalidName(Exception): pass
class InvalidHandler(InvalidName): pass

class DuplicateName(Exception): pass
class DuplicateHandler(DuplicateName): pass

class SchemaError(Exception): pass
# class ValidationError(SchemaError):
# class DeserializationError(SchemaError):

class EncodeError(SchemaError):
    """Python value passed to validation or serialization (Type.encode()) doesn't match the schema."""
class EncodeErrors(EncodeError):
    """Raised by Schema to inform about multiple validation errors in attributes."""
class DecodeError(SchemaError):
    """Raw value passed to deserialization (Type.decode()) is incorrect and can't be decoded."""

