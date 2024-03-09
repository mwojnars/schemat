# Schemat

## Introduction

- Similar to a desktop app, Schemat's web application is fully built of **objects** (**items**).
  Unlike in desktop programming, however, all the application's objects are stored in a database using automatic
  schema-driven **serialization**, and are accessible **server-side** and **client-side** alike in a way 
  that is transparent to the programmer.
- Thanks to the Schemat's Universal Namespace (**SUN**) which standardizes the way how application's objects 
  and all functional parts are named, each object is accessible through the same import path on both the server
  and the client, which greatly simplifies coding. 
- 


## Programming Guide

### Boot Up

- DB rings

### Item

- Properties (_data_)
- Prototypes (on items)
- Inheritance (via prototypes on categories)
- VIEW_*() methods CANNOT be "async". Any async initialization
  must be done in the `async init(data) {...}` method.
- Caching: `this.CACHED_PROP()`

### Routing

- **SUN** (Schemat's Universal Namespace)
  - files
  - items
- **active routing**: itermediate items play active role in URL path interpretation; examples:
  - ABTest
- special routes: /$, /local, /system (?)

### Code in DB

- **code as data**: all application code may reside in DB, be shared autom. in a cluster...
  abstracted from hardware (no per-node install, no OS config etc.)
- **unification**: *same* code works server-side & client-side seamlessly 
  with full *interoperability* (!), i.e. imports between different pieces of code
- `import()` works over SUN, *both* server-side & client-side 
- `vm` used to dynamically create modules (server-side)
- `*_server`, `*_client` to restrict parts of code to server/client env only

### Known issues

- **import()** in dynamic code, when used inside a method and awaited,
may cause the method be completed too late, after surrounding async code;
this is probably caused by a bug in `vm` module execution (?).
Workarounds:
  - use top-level `import` in the category's initialization section (`code`);
  - inside a method, use `return import().then(...)` instead of `await import()`.


---
## DEVELOPMENT

Adminer plugins:
  
    sudo apt install php-mbstring
    sudo service apache2 restart

---

