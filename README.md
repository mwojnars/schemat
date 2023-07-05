# Schemat

**Schemat** is a novel, object-oriented software platform for scalable, data-centric web applications
with complex and evolving data schemas.

Schemat already provides, or will provide in the future:

- built-in scalable, distributed data store of NoSQL type that keeps all primary data as JSON-serialized 
  **data objects** and allows for creation of secondary indexes and aggregations through 
  persistent, distributed **data transforms** (a la MapReduce)
- **schema-awareness** of data objects through their optional assignment to **categories**, 
  where each category specifies a rich, Javascript-based schema for the objects' properties, with support for: 
  arbitrary type validations, custom value constraints, nested values, repetitions, arrays, defaults, imputations and more; 
- **extended JSON serialization** that can serialize arbitrary data objects, for storage or transmission, 
  while preserving their identity as expressed by their class and category;
- **uniform object namespace** that provides a consistent network-wide naming scheme for all the application's 
  objects and code, allowing the dependencies to be declared in the same way on the client and the server, 
  and the same code to be executed on both sides;
- **web-aware encapsulation** for objects that binds together their data, behavior, and appearance, 
  and allows for their transparent execution on both the client and the server; 
- **universality** of the data objects, which can be instantiated and executed on both the client and the server, 
  and can be passed between them without any loss of information;
- **network polimorphism** of data objects: .....
- **multiple prototypical inheritance** for categories and objects, such that properties or schema definitions
  of a given object can be derived - in part or in whole - from other category(ies) or object(s);
- **schema evolution** that allows for schema changes to be applied to the categories and objects in a selective manner,
  without the need to update the entire database;
- **css-safe embedding** of widgets in the front-end;

Schemat is written in Node.js and Javascript. It is designed to be simple, fast, and scalable.
Currently, it is in the early stages of development (work in progress).


## Introduction

......
