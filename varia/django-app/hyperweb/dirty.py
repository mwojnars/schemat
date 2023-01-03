
class onchange:
    """Decorator that marks a method as dependent on a given set (tuple) of trigger attributes of the same class."""
    def __init__(self, *triggers):
        self.triggers = set(triggers)
        
    def __call__(self, method):
        method.triggers = self.triggers
        return method
    

class Data:
    """
    A data object that tracks changes to its contents and triggers related actions upon commit().
    In this way, changes are automatically propagated and consistency of both internal AND external data is ensured, 
    as effects of actions may go beyond the current object.
    In the Data base class, __dirty__ flag is a boolean that refers to the entire object, such that every change of the object contents
    shall trigger all actions registered in __actions__.
    In subclasses, __dirty__ may refer to individual elements and actions may be more specific, triggered by changes in selected elements only.
    """
    
    __dirty__    = None     # if true (True or non-empty), there exist some uncommitted changes in this Data object; must be set every time the data gets modified
    __parents__  = None     # Data object that refers to this one and must be notified whenever self.__dirty__ becomes true; as {parent: token} dict, the token identifies an element within parent that holds a reference to this object (can be None); the graph of child-parent relationships must NOT contain cycles, otherwise an infinite loop of notifications will occur
    __actions__  = None     # list of functions to be executed by commit() in a dirty state; actions may internally contain extra information that controls if a given action is actually called
    __incommit__ = False    # flag to prevent multiple commits being executed one inside another
    
    def __init__(self):
        self.__parents__ = {}
        self._dirty_clear()
        
    def _dirty_set(self, element = None):
        """
        Mark a given `element`, or the entire object, as dirty. If the object was clean beforehand, parents get notified.
        Should be called by a client, or a subclass, or child elements, whenever the data in `self` has changed.
        """
        was_dirty = self.__dirty__
        self.__dirty__ = True
        
        if was_dirty: return
        self._dirty_notify()
    
    def _dirty_notify(self):
    
        for parent, token in self.__parents__.items():
            parent._dirty_set(token)
    
    def _dirty_make_parent(self, parent, token):
        """Add a parent of this Data object."""
        assert parent not in self.__parents__
        self.__parents__[parent] = token
        #assert not self.__parent__
        #self.__parent__ = (parent, token)
    
    def _dirty_drop_parent(self, parent):
        
        assert parent in self.__parents__
        del self.__parents__[parent]
        #assert self.__parent__ and self.__parent__[0] is parent
        #self.__parent__ = None
    
    def _dirty_children(self):
        """Return a sequence of all child Data elements, dirty or clean."""
        return []
    
    def _dirty_clear(self):
        """Mark this object as clean. Children left untouched."""
        self.__dirty__ = False
    
    def _dirty_triggers(self, state, action):
        """True if `action` should be invoked in a given `state` (the value of __dirty__ from the start of commiting)."""
        return True
    
    def commit(self, max_iter = None):
        """
        Internal data commit. Marks the end of attribute changes and triggers propagation of values 
        to other (derived) attrs & actions. Triggers commit() of child Data elements, as well.
        """
        if not self.__dirty__: return
        if self.__incommit__: return
        self.__incommit__ = True
        
        # commit changes in child elements, if any
        for child in self._dirty_children():
            child.commit(max_iter)        
        
        # propagate changes; some actions may introduce further changes to `self`, hence a loop
        iteration = 0
        while self.__dirty__ and (max_iter is None or iteration < max_iter):
            state = self.__dirty__
            self._dirty_clear()
            for action in self.__actions__:
                if _dirty_triggers(state, action):
                    action()
            iteration += 1
        
        self.__incommit__ = False
    
    
class DataObject(Data):
    """
    Like Data, but all attributes are treated as separate data elements and their changes tracked individually.
    Each action function may contain an internal parameter, `triggers`, with a list of names of class attributes 
    whose change will trigger this action; this parameter is set by @onchange(...) decorator.
    All methods marked with @onchange are added to __actions__ by the metaclass (TODO).
    __dirty__ contains a set of attributes whose value has changed since the last commit() according to "==" comparison; 
    nested dirty collections are included only IF they are Data objects themselves and correctly provide parent notifications
    """
    
    def _dirty_clear(self):
        self.__dirty__ = set()

    def _dirty_children(self):
        
        return [child for child in self.__dict__.values() if isinstance(child, Data)]
        
    def _dirty_triggers(self, state, action):
        
        # action() is invoked if at least 1 attribute it depends on has changed; or there are no triggers defined (= any attr change triggers the action)
        triggers = getattr(action, 'triggers', None)
        return not triggers or (triggers & state)
    
    def __setattr__(self, name, value):
        
        # don't track changes of special attributes (starting with __), otherwise a race condition would occur
        if name[:2] == '__': 
            super().__setattr__(name, value)
            return

        previous = getattr(self, name, None)
        super().__setattr__(name, value)            # new value is assigned to `name` EVEN if previous==value (below), which in some rare cases may NOT mean strict identity
        
        # check if the value has really changed, otherwise we may end up in an infinite loop during change propagation in commit()
        if hasattr(self, name):
            if previous is value: return
            if isinstance(previous, Data) and previous is not self:
                previous._dirty_drop_parent(self)
        
        if isinstance(value, Data) and value is not self:       # don't set child-parent relationship for self-references (value==self)
            value._dirty_make_parent(self, name)
        
        if previous == value: return
        self.__dirty__.add(name)
    
    def __delattr__(self, name):
        
        removed = getattr(self, name)
        super().__delattr__(name)
        
        # unregister self as a parent of the removed element
        if isinstance(removed, Data):
            removed._dirty_drop_parent(self)
        
        self.__dirty__.add(name)        
    
