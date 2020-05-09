from parsimonious.grammar import Grammar as Parsimonious
from nifty.parsing.parsing import ParsimoniousTree, ParserError

from hyperweb.hyml.grammar import XML_StartChar, XML_Char, hyml_grammar


#####################################################################################################################################################
#####
#####  HYML_PARSER
#####

class HyML_Parser(Parsimonious):
    
    default = None      # class-level default instance of HyML_Parser, the one with standard indentation chars;
                        # can be used for parsing of a given text only if the text doesn't contain any of
                        # special characters that are used in the parser for indent / dedent
    
    SPECIAL_SYMBOLS = ['INDENT_S', 'DEDENT_S', 'INDENT_T', 'DEDENT_T']
    CHARS_DEFAULT   = ['\u2768', '\u2769', '\u276A', '\u276B']              # indent/dedent special chars to be used in `default` parser
    
    symbols = None      # dict of special symbols: {symbol_name: character}
    
    def __init__(self, chars):
        
        assert len(chars) == len(self.SPECIAL_SYMBOLS)
        self.symbols = dict(zip(self.SPECIAL_SYMBOLS, chars))
        
        placeholders = self.symbols.copy()
        placeholders.update({'XML_StartChar': XML_StartChar, 'XML_Char': XML_Char})
        
        grammar = hyml_grammar % placeholders
        print('HyML_Parser grammar:')
        print(grammar)
        
        super(HyML_Parser, self).__init__(grammar)
    
    @staticmethod
    def get_parser(script):
        """
        Return HyML_Parser instance suitable for parsing a given `text`.
        The parser must be created with a proper choice of special characters,
        ones that don't collide with character set of `text`.
        """
        if not (set(HyML_Parser.CHARS_DEFAULT) & set(script)):
            return HyML_Parser.default

        chars = []
        
        # find 4 unicode characters that are not in `text`; start with CHARS_DEFAULT[0]
        code = ord(HyML_Parser.CHARS_DEFAULT[0])
        for _ in range(4):
            while chr(code) in script:
                code += 1
            chars.append(chr(code))
            code += 1
            
        return HyML_Parser(chars)
        
    
    def preprocess(self, script):
        """
        Preprocessing:
        - INDENT_* / DEDENT_* inserted in place of leading spaces/tabs
        - empty lines passed unmodified
        - comment lines (--) removed
        """
        lines = []
        linenum = 0             # current line number in input script
        current = ''            # current indentation, as a string
        
        for line in script.splitlines():
            linenum += 1
            tail = line.lstrip()
            indent = line[: len(line) - len(tail)]
            
            if not tail:                            # empty line, append without changes
                lines.append(line)
                
            elif tail.startswith('--'):             # comment line, ignore
                pass
            
            else:                                   # code line, convert `indent` to INDENT_*/DEDENT_* characters and insert `tail`
                if indent == current:
                    pass

                elif indent.startswith(current):
                    increment = indent[len(current):]
                    symbols = [self.symbols['INDENT_S' if char == ' ' else 'INDENT_T'] for char in increment]
                    tail = symbols + tail
                    current = indent

                elif current.startswith(indent):
                    decrement = current[len(indent):]
                    symbols = [self.symbols['DEDENT_S' if char == ' ' else 'DEDENT_T'] for char in reversed(decrement)]
                    tail = symbols + tail
                    current = indent
                    
                else:
                    raise IndentationError(f'indentation on line {linenum} is incompatible with previous line')
                    
                lines.append(tail)
                
        return '\n'.join(lines) + '\n'
        
        
HyML_Parser.default = HyML_Parser(chars = HyML_Parser.CHARS_DEFAULT)

        
#####################################################################################################################################################
#####
#####  HYML_TREE
#####

class HyML_Tree(ParsimoniousTree):


    _ignore_ = "ws space comma nl vs"
    _reduce_ = "target"
    
    
    def __init__(self, script):
        
        self.parser = HyML_Parser.get_parser(script)            # parses input text to the 1st version of AST, which undergoes further rewriting to NODES classes later on
        
