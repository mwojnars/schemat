"""
Global Hyperweb objects. This module must NOT be imported at the beginning of another module,
but rather it should only be imported inside functions, to avoid cyclic module dependencies.
"""

from .config import ALIASES
from .aliases import Aliases

#####################################################################################################################################################

aliases = Aliases(ALIASES)
