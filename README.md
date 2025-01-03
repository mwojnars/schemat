# Schemat

[... WORK IN PROGRESS ...]

**Schemat** is an object-oriented platform for building scalable 
internet applications composed of isomorphic **web objects** that are seamlessly 
transferred over the network and executed on any machine (client, server, database node).

Schemat comes with a built-in, distributed, schema-aware, NoSQL **database** engine that supports index creation, live schema evolution, object & schema versioning, and more. Web objects are grouped into categories and may utilize multiple prototypical inheritance.

By introducing isomorphic, network-aware web objects, Schemat extends the traditional object model to span the entire distributed application stack -- from the database to the client node -- in a way that unifies all client/server environments. Web objects are designed to fully encapsulate a given web functionality, with its _data model_, server-side _logic_, and client-side _appearance_ - all combined in a single, network-native object. This is in contrast to traditional, network-agnostic objects that are designed to be executed on a single machine.
As such, Schemat is the first software platform that brings the full expression of OOP paradigm to the web.

Schemat is written in Node.js and Javascript.


### Features

Web objects have many useful features that make them suitable for building complex internet applications:

- The web object has a **unique ID** that serves as its global identifier across all execution environments (client, server, database), and is assigned when the object is inserted to the database. Optionally, a web object may have a human-readable, plain-text **name**.

- Web object has persistent **properties** (_aka_ attributes or fields). They can take on values of various types, including primitives (strings, numbers, booleans), compound (arrays, maps, records), custom types, JavaScript objects, or references to other web objects. Properties may have **default values** or **imputation functions** defined, which are used to fill in missing values.

- Web object may contain multiple values for a given property, i.e., the property can be repeated multiples times in the object with different values (a _repeated_ or **multivalued property**), without the need to declare the property as an array. Schemat provides a special syntax for accessing the repeated values.

- Web object may belong to a **category** that defines its properties and their schema, and performs automatic validation of the object's content upon insertion and modification. Categories themselves are web objects, so they can be stored in the database, and accessed and modified in the same way as any other web object.

- Web object may have a corresponding **JavaScript class** that defines its local JavaScript methods whenever the web object gets instantiated as a local JavaScript object. When the web object is loaded from the database, its corresponding JavaScript class gets attached to it via prototype mechanism, providing _local behavior_ for it. [*remember that JavaScript is a prototypal language, so attaching a class to an object is a matter of setting the object's _prototype_ property with `Object.setPrototypeOf()`, and this can be done at any point during the object's lifecycle, even after the object has been already instantiated - something not possible in other languages. This trick is needed for lazy loading as described later.]

- Web object may **inherit** properties from other web object(s). This is a web equivalent of JavaScript's _prototypical_ inheritance, with the important extension that multiple parents can be specified, not just one (similar to _multiple inheritance_, but with even broader applicability). Note that this type of inheritance is implemented at a higher level of abstraction, at the level of web objects, and does _not_ employ JavaScript's own inheritance mechanism.

- Web object is **serializable** and **transferable**. It can be automatically serialized to JSON for storage in the database, transmitted to/from client or between different nodes in a cluster. Importantly, the serialization supports:
    - nested values (arrays and dictionaries in the form of POJO objects) [*POJO stands for Plain Old JavaScript Object.],
    - sub-objects of custom JS classes (the subobject is recreated with a proper class after deserialization),
    - references to other web objects (the reference is replaced with the target object's ID during serialization, and is resolved back into a "stub" when the object is deserialized).

- Web objects are **lazily loaded**. If an object references another one, and the target object is not needed immediately, it is instantiated as an empty _stub_ that only remembers its database ID, but is able to load its full content upon explicit request (`.load()`). The same target object (stub) can be referenced from multiple places, and when it gets loaded, it is loaded once for all referencing objects. The stub object retains its identity when loaded (no replacement with a new instance), meaning all existing references remain valid - there's no need to update references throughout the object graph. This approach enables efficient lazy loading of large networks of interconnected objects while maintaining memory efficiency.

- When used only for reading, local instances of web objects are created **immutable** and are **cached** in the local Registry. In this way, they can be shared and reused across multiple web requests, even those that are served concurrently. The _Time-To-Live_ (TTL) is configured separately for each category.

- Immutable web objects maintain a **property cache**, which contains the values of their properties and getters. The calculation of a property is only done once, and the result is reused in all subsequent web requests until the object is evicted from the Registry.

- Web objects can be **versioned**. If requested so in the category definition, a version number is assigned to the object upon its creation, to be subsequently incremented with each modification. Optionally, past **revisions** can be retained, which enables rollbacks to previous versions and inspection of the history of changes.

- Category objects can be versioned, too, and may retain their older revisions with past schema versions. This allows for **gradual schema evolution**: schema migrations are applied to objects in a delayed (lazy) and selective manner, without massive rewrites that might cause application downtimes. Whenever requested, an object can migrate its content forward or backward to the newer or older schema version.

- Web object can be exposed at a particular **URL** and be accessed from the internet. The URL structure is formed by nesting _container_ objects, in a similar way as files are organized in directories on a local filesystem. The important difference is that Schemat's URL space contains not just static files, but fully-operational objects, which can be interacted with via their URL endpoints. Another difference is that some containers may employ dynamic addressing schemes (the "name" part can be mapped dynamically to/from an object ID), which allows for an unbounded number of objects to be exposed at a given URL prefix.

<!-- - Some methods of the web object's class may be exposed as **network methods** at particular **endpoints**, which makes them accessible over the internet. -->

- Web object may accept web requests on a number of **endpoints** and implement **handler** methods that send responses of any kind: a web page, a serialized object, a file, etc. The endpoint name is appended to the object's URL after double colon (`::`) to form a complete address (`https://...path/to/object::endpoint`). If endpoint name is omitted, the request is forwarded to the object's _default endpoint_ (typically `::view`). Endpoints in Schemat are web counterparts of regular OOP methods.

- In a special case, web object may generate an **active page** as its web response, which is an HTML page with Schemat's startup code embedded in it. This allows client-side code to interact with Schemat directly in the browser: load and modify web objects, save property updates and execute their methods - all in the same way as would be done on a server machine. Typically, the active page may contain a front-end component (like a React.js component) that (re-)renders the page while using some Schemat objects as building blocks, or may display HTML forms whose user-provided data is then reflected in the object's properties.

- By default, every web object supports the special endpoint **::inspect**, which generates a web UI for inspecting this object's content and manually modifying its properties. 

- Web objects of selected categories expose another special endpoint, **::admin**, that provides a higher-level administrative interface for performing category-specific actions, like browsing the URL structure of a Site, adding indexes in a Database etc. Like regular methods and properties, the implementation of endpoints may be overridden in subcategories and child objects, so, for instance, the default administrative UI can be replaced with a custom one.

- Instead of serving pages, the web object may expose a **service** on a particular endpoint, which is a special type of web handler that has its client-side counterpart automatically generated by Schemat. The server-side and client-side code both use the same method name, and Schemat takes care of binding the proper implementation depending on the current environment (server or client). The call looks like a local method execution, and is redirected to the server-side instance of the same web object. This is Schemat's realization of the _remote procedure call_ (RPC), with the important difference that the call is always related to a particular web object, and it can be executed on the client and server alike, providing isomorphism of the application code.

- With a few exceptions for system objects, web objects are **isomorphic** and can be instantiated and executed in every environment: on a client, or a server, _without_ any changes in the code or import statements (the code is _isomorphic_). This is an important feature that bridges the gap between server- and client-side parts of the application, and allows for a unified development model. For example, isomorphism allows the same React code to be rendered on the server (Server-Side Rendering, or SSR) and in the browser (Client-Side Rendering, or CSR); or, the same validation procedures to be executed on the server when inserting data into the database, and on the client where the data is edited in a web form and the user must be informed about mistakes _before_ the form gets submitted.


<!-- Schemat already provides, or _will_ provide in the future:

- Built-in scalable, distributed, **NoSQL store** that keeps all primary data as JSON-serialized 
  **web objects** and allows for creation of derived indexes and aggregations through 
  persistent, distributed **data transforms** (_a la_ MapReduce).

- **Object-oriented JSON encoding** for transmission and storage that can serialize 
  application objects while preserving their behavior and identity as expressed by their class and category(ies).
  Objects can be freely transmitted and shared between the server and the client,
  which facilitates seamless integration of the front-end and back-end code within a single object or category.

- **Schema-awareness** of application objects through their (optional) assignment to **categories**, 
  where each category defines a Javascript-based object schema with support for: 
  default values, arrays, nested and repeated fields, custom validation rules and constraints, automatic 
  imputations and more. Schemas are fully implemented in Javascript, so they can be arbitrarily complex
  and perform any type of validation or encoding, not limited by the capabilities of an imposed data language
  like the SQL; also, the exact same validation code that runs on the server can be reused on the client
  to verify web forms.

- **Multiple inheritance** for categories and objects: Schemat-managed properties and the schema definition 
  for an application object can be derived - in part or in whole - from other category(ies) and object(s). 
  The inheritance is **prototypical**, like in regular Javascript, so it can be applied not only 
  to categories, but also to individual Schemat objects.

- **Live schema evolution** with **versioning**: 
  schema changes are applied to objects in the database in a selective and continuous manner, 
  with older schema versions co-existing with the new ones to allow for gradual migration of the data 
  and to avoid massive database updates that might cause application downtimes.

- **Network-awareness** of application objects, which provide not only regular methods for local execution, 
  but also **services** and RPC-like **actions** (*remote methods*) that can be invoked remotely, 
  either by another copy of the same object on a different machine, or by an external client (like a user's browser).
  Actions provide a method-like interface that abstracts away the network-related aspects of their execution,
  so an action can be invoked locally or remotely in exactly the same way.
  Services and actions may employ arbitrary network protocols for outbound vs intra-cluster communication:
  HTTP(S), WebSockets, TCP, Kafka, etc.
  An object may also expose **views**, which are a special type of HTTP service that define 
  how the object should be rendered on the client.
  
- **Uniform object space**: a network-wide namespace for application objects and their code,
  where every object can be assigned a unique URL-like import path. This allows the dependencies 
  and import statements to be expressed in the same way on both the client and the server,
  which makes application code **universally executable** on both sides.
  The object space includes Schemat's system and standard objects, facilitating seamless integration  
  between the platform and application code. -->
