########################################################################################################################################################
#####
#####  SDK
#####

class Tag:
    """
    Base class for all tags:
    - ExternalTag - a tag implemented as a python function
    - NativeTag - a tag implemented inside Hypertag code
    """
    void = False        # if True, __body__ is expected to be empty, otherwise an exception shall be raised by the caller
    text = False        # if True, __body__ will be provided as plain text (rendered DOM), not a DOM; allows better compactification
    pure = True         # if True, the tag is assumed to always return the same result for the same arguments (no side effects),
                        # which potentially enables full compactification of a node tagged with this tag
    
    # text_body = False       # if True, the __body__ argument to expand() will be a string (rendered DOM), not DOM;
    #                         # setting this to True whenever possible allows speed optimization through better
    #                         # compactification of constant subtrees of the AST before their passing to a hypertag

class ExternalTag(Tag):
    """
    External tag, i.e., a (hyper)tag defined as a python function.
    Every tag behaves like a function, with a few extensions:
    - it accepts body as the 1st unnamed argument, passed in as a Sequence of HNodes, or plain text;
      some tags may expect body to be empty
    - it may accept any number of custom arguments, regular or keyword
    - it should return either a Sequence of nodes, or plain text, or None
    """
    
    def expand(self, __body__):     # more attributes can be defined in subclasses
        """
        Subclasses should NOT append trailing \n nor add extra indentation during tag expansion
        - both things will be added by the caller later on, if desired so by programmer.
        
        :param __body__: rendered main body of tag occurrence, as a string; if a tag is void (doesn't accept body),
                         it may check whether __body__ is empty and raise VoidTag exception if not
        :param attrs, kwattrs: tag-specific attributes, listed directly in subclasses and/or using *attrs/**kwattrs notation
        :return: string containing tag output; optionally, it can be accompanied with a dict of (modified) section bodies,
                 as a 2nd element of a pair (output_body, output_sections); if output_sections are NOT explicitly returned,
                 they are assumed to be equal __sections__; also, the __sections__ dict CAN be modified *in place*
                 and returned without copying
        """
        raise NotImplementedError

