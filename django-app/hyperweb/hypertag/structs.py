"""
Data structures for semantic analysis of HyML's AST.
"""

from collections import OrderedDict
from copy import copy
from six import text_type as unicode

########################################################################################################################################################

class Stack(list):
    """
    Stack of current symbols encountered during semantic analysis. Implementation based on standard <list>.
    Additionally, it keeps track of current indentation.
    """

    # current indentation string, as a combination of ' ' and '\t' characters;
    # initial \n is used to mark that an indentation is absolute rather than relative to a parent node
    indentation = '\n'
    
    @property
    def size(self):
        return len(self)
    @size.setter
    def size(self, _size_):
        del self[_size_:]

    #push    = list.append
    pushall  = list.extend
    get      = list.__getitem__
    set      = list.__setitem__
    
    def push(self, value):
        """Append `value` to the stack and return its index in the list."""
        self.append(value)
        return len(self) - 1

    def indent(self, whitechar):
        self.indentation += whitechar
    
    def dedent(self, whitechar):
        assert self.indentation[-1] == whitechar, 'Trying to dedent a different character than was appended'
        self.indentation = self.indentation[:-1]
    
    # def next_slot(self):
    #     """
    #     Index in the list of symbols where a new symbol will be inserted if push() is called right after.
    #     This method can be merged with push() in the future.
    #     """
    #     return len(self)
    
    def position(self):
        """
        Position in a Stack that can be passed to reset().
        As a pair: (length of stack of symbols, length of indentation).
        """
        return len(self), len(self.indentation)

    def reset(self, position):
        "If anything was added on top of the stack, reset the top position to a previous state and forget those elements."
        # if len(self) < state: raise Exception("Stack.reset(), can't return to a point (%s) that is higher than the current size (%s)" % (state, self.size))
        pos_symbols, pos_indent = position
        self.indentation = self.indentation[:pos_indent]
        del self[pos_symbols:]
        
    def copy(self):
        dup = Stack(self)
        dup.indentation = self.indentation
        return dup
        

class MultiDict(object):
    """
    An ordered multi-dictionary with push/pop operations. Or, in other words, a stack of (name,value) pairs
    that additionally keeps a dict of the names and their most recent values, for fast name lookup.
    Each element of the stack keeps also an index of the previous element with the same name,
    to enable pop() implementation that replaces a dictionary value of a given name with its previous value.
    
    >>> md = MultiDict()
    >>> md.push('a', 123); md.push('b', 321); md.push('a', 9)
    >>> md.pop()
    ('a', 9)
    >>> md['a']
    123
    >>> md.push('b', 456); md.push('b', 654)
    >>> md.reset(md.getstate() - 2)
    >>> md['b']
    321
    """
    
    stack = None            # Stack object; elements are triples of the form: (name, value, index_of_previous)
    lookup = None           # {name: index} dict of current names and their most recent positions in the stack
    
    def __init__(self, maxlen = 10):
        self.stack = Stack()
        self.lookup = {}
    
    def __contains__(self, name):
        return name in self.lookup
    def __getitem__(self, name):
        "Current value assigned to 'name'."
        idx = self.lookup[name]
        return self.stack[idx][1]
    def get(self, name, default = None):
        idx = self.lookup.get(name, None)
        if idx is None: return default
        return self.stack[idx][1]
    
    def keys(self): return self.lookup.keys()
    def values(self):
        for i in self.lookup.values(): yield self.stack[i][1]
    def items(self):
        for k in self.lookup.keys(): yield k, self[k]
        
    def push(self, name, value):
        prev = self.lookup.get(name, None)
        self.lookup[name] = self.stack.size
        self.stack.push((name, value, prev))
        
    def pop(self):
        "Pop the top element of the stack and return as a (name, value) pair, with proper update of the lookup dictionary."
        top = self.stack.pop()
        name, value, prev = top
        if prev is None: del self.lookup[name]
        else: self.lookup[name] = prev
        return (name, value)
    
    def pushall(self, items):
        "A repeated push(), of all items in the name->value dictionary 'items'."
        for name, value in items.items():
            self.push(name, value)

    def reset(self, state):
        "Do the same as a repeated pop() would do, but a bit more efficiently."
        size = self.stack.size
        if size < state: raise Exception("MultiDict.reset(), can't return to a point (%s) that is higher than the current size (%s)" % (state, size))
        for i in range(size-1, state-1, -1):
            name, _, prev = self.stack[i]
            if prev is None: del self.lookup[name]
            else: self.lookup[name] = prev
        self.stack.size = state

    def asdict(self, state = 0):
        "Return all current elements as an OrderedDict. If state is given, only the elements pushed since 'state' are returned."
        rng = range(state, self.stack.size)
        return OrderedDict((name, value) for name, value, _ in [self.stack[i] for i in rng])

    def getstate(self):
        return self.stack.size
    
    def copy(self):
        dup = copy(self)
        dup.stack = self.stack.copy()
        dup.lookup = self.lookup.copy()
        return dup
    
    def __unicode__(self): return unicode(self.lookup)
    def __repr__(self):
        items = [(repr(self.stack[i][0]), self.stack[i][1]) for i in sorted(self.lookup.values())]
        return "{%s}" % ', '.join("%s: %s" % item for item in items)


class Context(MultiDict):
    """Context data passed through a HyperML syntax tree during semantic analysis."""
    
    depth = 0               # current depth of nested hypertag definitions during analyse()
    ref_depth = None        # the top-most (minimum as a value) def-depth of a non-pure variable or hypertag referenced inside the current subtree;
                            # this value is passed bottom-up through the tree, from inner nodes (variable occurences)
                            # to outer nodes (hypertag def-nodes); def-depth = -1 indicates an external non-pure variable/hypertag
    
    def add_refdepth(self, d, symbol = None):
        """Update self.ref_depth with the depth of one more definition of a variable/hypertag.
        'symbol': optional name of the variable/hypertag being referenced, for debugging.
        """
        if d is None: return                            # special case, for adding back initial ref_depth value, which can be None
        if self.ref_depth is None:                      # when ref_depth is still uninitialized, just use 'd'
            self.ref_depth = d
        else:                                           # otherwise, use 'd' if it's lower than the current value
            self.ref_depth = min(self.ref_depth, d)
        #if DEBUG: print(' ', symbol or '', d, 'ref_depth =', self.ref_depth)


# class Frame(object):
#     """Activation frame. A list of actual values of hypertag/function arguments, plus values of local variables.
#     Parent-linked to the caller's activation frame and linked through *access link* to the frame of the immediate lexical encapsulating hypertag.
#     Through the parent link, frames create an *activation list*, a counterpart of a stack in traditional runtime implementations.
#     Activation list enables easy creation of a parent-pointer-tree for representation of execution of closures (hypertags passed as variables):
#     https://en.wikipedia.org/wiki/Parent_pointer_tree
#     """
#     name = None             # name of the hypertag that created this frame, for debugging
#
#     vars = []               # the fixed stack of variables' values
#     parent = None
#     accesslink = None


class StackBranch(object):
    """A stack that exposes Stack interface, but internally consists of 2 disjoint parts, each one being a Stack object:
    1) the "lower" Stack or StackBranch object (the "trunk") containing stack of a fixed length - can only be used for read access;
    2) the "upper" Stack object (the "branch") that initially has 0 length, but can grow and shrink like any regular Stack
    StackBranch is used in Closure implementation.
    """
    def __init__(self, lower):
        self.lower = lower
        self.upper = Stack()
        self.lowersize = self.lower.size
        
    ### all Stack methods delegated to the appropriate Stack object...
    
    def push(self, x):
        self.upper.push(x)
    def pop(self):
        return self.upper.pop()
    def pushall(self, elems):
        self.upper.pushall(elems)
        
    def __getitem__(self, pos):
        if pos < self.lowersize:
            return self.lower[pos]
        return self.upper[pos - self.lowersize]
    def get(self, pos):
        if pos < 0:
            pos += self.lowersize + self.upper.size
        return self[pos]
    def set(self, pos, val):
        # transform 'pos' to a positive index in the 'upper' stack
        if pos < 0:
            upos = pos + self.upper.size
        else:
            upos = pos - self.lowersize
        if upos < 0:
            raise Exception("StackBranch.set(), can't modify an element (#%s) that's located on the trunk (size %s)" % (pos, self.lowersize))
        self.upper.set(upos, val)
    
    def position(self):
        return self.lowersize + self.upper.size
    def reset(self, state):
        "If anything was added on top of the stack, reset the top position to a previous state and forget those elements."
        size = self.lowersize + self.upper.size
        if state > size:
            raise Exception("StackBranch.reset(), can't return to a point (%s) that is higher than the current size (%s)" % (state, size))
        if state < self.lowersize:
            raise Exception("StackBranch.reset(), can't return to a point (%s) that is located on the trunk (size %s)" % (state, self.lowersize))
        self.upper.reset(state - self.lowersize)
    
    def __repr__(self):
        return repr(self.lower) + '/' + repr(self.upper)

    
class Closure(object):
    """
    Frozen hypertag expansion, created when a hypertag is passed as a variable for later execution: $H ... $fun(H).
    Closure keeps the stack as was present at the point of closure creation, to pass it to the hypertag's expand()
    even if the original stack has changed before the point of expansion.
    Note that in HyML, hypertags can only be passed downwards through the chain of hypertag expansions or function calls,
    not upwards, so the stack can only grow, never shrink, before the closure execution point, and consequently
    all the frames that the closure needs are still on the stack. However, the closure may need to extend the stack in its own way
    starting from the stack position from the point of closure creation, which would override the frames added between closure creation
    and execution. To avoid this, we have to implement *stack branching*, done by temporary re-mapping of stack indices
    to "hide" a part of the stack without its physical removal. The hidden part can be unhidden in constant time, and there can be many
    overlapping parts hidden at the same time (happens when a chain of several closures are executed).
    """
    ishypertag = None       # the HypertagSpec
    hypertag = None         # the xhypertag node to be expanded when the request comes
    stack = None            # current stack from the point of closure creation
    occurDepth = None       # call depth at the point of closure creation
    
    def __init__(self, hypertag, stack, occurDepth):
        self.ishypertag = hypertag.ishypertag
        self.hypertag = hypertag
        self.occurDepth = occurDepth
        self.stack = StackBranch(stack)
        #self.stack = stack.copy()
     
    def definition(self): return self.hypertag.definition()
    
    def expand(self, unnamed, kwattrs, caller = None):
        # now we use the recorded stack and depth from the place of closure creation, instead of the ones from the point of expansion
        return self.hypertag.expand(unnamed, kwattrs, self.stack, self.occurDepth, caller)
        

class LazyVariable(object):
    """
    A variable whose value calculation is delayed until the first use.
    If the variable is never used, its value won't be calculated at all.
    The value is calculated from a "value function" set during initialization and
    should be retrieved with getvalue() method. Repeated calls to getvalue() return
    the same value as calculated on the 1st call, without further re-calculation.
    """
    def __init__(self, fun):
        self.fun = fun          # no-arg "value function"; will be called to calculate the actual value of the variable
        self.value = None
        self.hasvalue = False
        #self.getvalue()

    def getvalue(self):
        if not self.hasvalue:
            self.value = self.fun()
            self.hasvalue = True
        return self.value

lazyEmptyString = LazyVariable(lambda: '')
lazyEmptyString.getvalue()

