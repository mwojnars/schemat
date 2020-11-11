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

class ExternalTag(Tag):
    """
    External tag, i.e., a (hyper)tag defined as a python function.
    Every tag behaves like a function, with a few extensions:
    - it accepts unnamed body in "__body__" argument, which contains a markup value; some tags may expect body to be empty
    - it may accept any number of named sections passed in "__NAME__" arguments; they contain markup values
    - it may accept any number of plain (non-markup) arguments
    - it should always return an unnamed markup value; additionally, it may return a dict of named markup values (sections) ??
    """
    
    def expand(self, __body__, *attrs, **kwattrs):
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

