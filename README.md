# Schemat

🚧 🚧 ... WORK IN PROGRESS! ... 🚧 🚧

**Schemat** is an object-oriented platform for building scalable internet applications composed of [isomorphic](https://en.wikipedia.org/wiki/Isomorphic_JavaScript) **web objects** that can be seamlessly transferred over the network and executed in any local environment (on client, server, or data node). 
Web objects implement network communication as their internal activity and can talk to their own copies on other machines, thus freeing programmers from the burden of designing custom AJAX calls and protocols. As such, web objects live "on the web" rather than on any single machine. All network communication is implemented as object-to-itself messaging, which simplifies application design and allows programmers to focus on building useful features rather than handcrafting client-server and intra-cluster communication.

<!-- Web objects can talk to their own copies on other machines, thus freeing programmers from the burden of designing custom AJAX calls. By encapsulating network communication as an implementation detail, web objects live "on the web" rather than on any single machine. Network communication happens transparently between instances of the same web object and without the programmer writing any networking code, so the network becomes a unified execution environment for web objects. -->

Schemat comes with an internal, NoSQL-like, distributed, schema-aware, object-oriented **data store** that uses JavaScript for all queries and mutations, supports indexes, object versioning, schema evolution, polymorphic schemas, and more. Web objects are grouped into **categories** that define their schemas and behavior, and may derive properties from other objects via prototype-based inheritance. <!-- The data store itself is implemented with web objects,  -->

By introducing isomorphic, network-aware and network-native _web objects_, Schemat extends the traditional [OOP](https://en.wikipedia.org/wiki/Object-oriented_programming) object model and makes it compatible with the distributed nature of web applications, allowing the object to encapsulate the specifics of all different environments (client, server, database) and to execute in any one of them. Web objects can fully represent a particular web functionality, with the _presentation_ layer, the server-side _logic_, and the _data model_, all combined in a single, network-native entity. This contrasts with the traditional, network-agnostic object, which only implements a part of any given web functionality, related to an isolated local environment: either the client, or the server, or the database, but not all three at once.

As such, Schemat is the first software platform that elevates [Object-Oriented Programming](https://developer.mozilla.org/en-US/docs/Learn_web_development/Extensions/Advanced_JavaScript_objects/Object-oriented_programming) (OOP) to the network level and brings full expression of the OOP paradigm to the web. Schemat is written in Javascript and Node.js.


### Features

Web objects have many useful features that make them suitable for building complex internet applications:

- Every web object has a **unique ID** that serves as its global identifier across all execution environments (client, server, database), and is assigned when the object is inserted to the database. Optionally, a web object may have a human-readable, plain-text **name**.

- Web object has persistent **properties** (_aka_ attributes or fields) that are automatically serialized and saved in the internal data store. They can take on values of various types, including primitives (strings, numbers, booleans), compound (arrays, maps, records), custom types, JavaScript objects, or references to other web objects. Properties may have **default** values, or be imputed with **imputation** functions declared in the property schema.

- Web object may contain multiple values for a given property, i.e., the same property name can be repeated a number of times in the object, creating a **repeated (multivalued)** property. Schemat provides a special "plural" syntax (`.name$`) for accessing an array of all values of a repeated property.

- Web object may belong to a **category** that defines its **schema** (valid properties and value types) and performs validation of its content upon insertion and modification. Categories themselves are web objects, so they share all the features of web objects listed here: they can be stored in the database, transferred, modified, versioned, etc. The concept of categories can be viewed as a web-level equivalent of OOP classes, with the principle of *classes are objects* as present in some OOP languages being mirrored by the *categories are web objects* rule in Schemat.

- Web object may have a JavaScript **class** defined for it, too. 
Whenever the object is fully loaded from the database and materialized as a local JavaScript instance, its class is attached to it via the JavaScript prototype mechanism. The class provides local behavior (methods, getters), but also defines web endpoints, database actions, edit operators, and RPC/RMI methods for the object. [*Remember that JavaScript is a prototypal language, so attaching a class to an object is a matter of setting the object's _prototype_ with `Object.setPrototypeOf()`, which can be done at any point during object's lifetime, even after instantiation. This trick enables lazy loading as described later.]

- Web object may **inherit** properties from other web object(s). Typically, inheritance is applied to _category_ objects which are allowed to inherit properties (e.g., schema definitions), from each other. This is a web-level equivalent of JavaScript's [prototype-based inheritance](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Inheritance_and_the_prototype_chain), with the important extension that multiple parents can be specified for a given object (_multiple inheritance_ applied to prototypes). Note that Schemat's inheritance is implemented at the level of web objects and does _not_ employ JavaScript's own inheritance mechanism - only in this way it is possible to implement multiple inheritance, which is natively missing in JavaScript.

- Web object is **serializable** and **transferable**. It can be automatically serialized to JSON for storage in the database, transmitted to/from client or between different nodes in a cluster. Importantly, the serialization supports:
    - nested values (arrays and dictionaries in the form of POJO objects) [*POJO stands for Plain Old JavaScript Object.],
    - sub-objects of custom JS classes (the subobject is recreated with a proper class after deserialization),
    - references to other web objects (the reference is replaced with the target object's ID during serialization, and is resolved back into a "stub" when the object is deserialized).

- Web objects are **lazily loaded**. If an object references another one, and the target object is not needed immediately, it is instantiated as an empty _stub_ that only remembers its database ID, but is able to load its full content upon explicit request (`.load()`). The same target object (stub) can be referenced from multiple places, and when it gets loaded, it is loaded once for all referencing objects. The stub object retains its identity when loaded (no replacement with a new instance), meaning all existing references remain valid - there's no need to update references throughout the object graph. This approach enables efficient lazy loading of large networks of interconnected objects while maintaining memory efficiency.

- When used only for reading, local instances of web objects are created **immutable** and are **cached** in the local Registry. In this way, they can be shared and reused across multiple web requests, even those that are served concurrently. The _Time-To-Live_ (TTL) is configured separately for each category.

- Immutable web objects maintain a **property cache**, which contains the values of their properties and getters. The calculation of a property is only done once, and the result is reused in all subsequent web requests until the object is evicted from the Registry.

- Web objects may expose **edit operators**: specifically named methods (`'edit.XYZ'()`) that implement atomic modifications of a single object's content to be executed on the data node in a mutually-exclusive way. Edits can be recorded on the client side, sent in a batch to the server, replayed on a data node and saved to the database. The set of edits is extensible and can be customized for each category by adding new `'edit.XYZ'()` methods to its JavaScript class. Performing an edit is as simple as calling `obj.edit.XYZ(args)` - on client or server alike - followed by `obj.save()`. No SQL required!

- Edits on multiple objects can be grouped into **actions** that (in the future) will be executed as a single database transaction [TODO]. Actions are implemented as another type of specially-named method (`'action.XYZ'()`), and they not only enable one-line execution of a complex set of edits, but also perform background refresh of the affected objects on the caller from their final state from the database.

- Web objects can be **versioned**. If requested so in the category definition, a version number is assigned to the object upon its creation, to be subsequently incremented with every modification. Optionally, past **revisions** can be retained, which enables rollbacks to previous versions and inspection of the history of changes.

- Category objects can be versioned, too, and may retain their older revisions with past schema versions. This allows for **gradual schema evolution**: schema migrations are applied to objects in a delayed (lazy) and selective manner, without massive rewrites that might cause application downtimes. Whenever requested, an object can migrate its content forward or backward to the newer or older schema version.

- Web object can be exposed at a particular **URL** and be accessed from the internet. The URL structure is formed by nesting _container_ objects, in a similar way as files are organized in directories on a local filesystem. The important difference is that Schemat's URL space contains not just static files, but fully-operational objects, which can be interacted with via their URL endpoints. Another difference is that some containers may employ dynamic addressing schemes (the "name" part can be mapped dynamically to/from an object ID), which allows for an unbounded number of objects to be exposed at a given URL prefix.

<!-- - Some methods of the web object's class may be exposed as **network methods** at particular **endpoints**, which makes them accessible over the internet. -->

- Web object may accept web requests on a number of **endpoints** and implement **handler** methods that send responses of any kind: a web page, a serialized object, a file, etc. The endpoint name is appended to the object's URL after double colon (`::`) to form a complete address (`https://...path/to/object::endpoint`). If endpoint name is omitted, the request is forwarded to the object's _default endpoint_ (typically `::view`). Endpoints in Schemat are web counterparts of regular OOP methods.

- In a special case, web object may generate an **active page** as its web response, which is an HTML page with Schemat's startup code embedded in it. This allows client-side code to interact with Schemat directly in the browser: load and modify web objects, save property updates and execute their methods - all in the same way as would be done on a server machine. Typically, the active page may contain a front-end component (like a React.js component) that (re-)renders the page while using some Schemat objects as building blocks, or may display HTML forms whose user-provided data is then reflected in the object's properties.

- By default, every web object supports the special endpoint **::inspect**, which generates a web UI for inspecting this object's content and manually modifying its properties. 

- Web objects of selected categories expose another special endpoint, **::admin**, that provides a higher-level administrative interface for performing category-specific actions, like browsing the URL structure of a Site, adding indexes in a Database etc. Like regular methods and properties, the implementation of endpoints may be overridden in subcategories and child objects, so, for instance, the default administrative UI can be replaced with a custom one.

- Instead of serving pages, the web object may expose a **service** on a particular endpoint, which is a special type of web handler that has its client-side counterpart automatically generated by Schemat. The server-side and client-side code both use the same method name, and Schemat takes care of binding the proper implementation depending on the current environment (server or client). The call looks like a local method execution, and is redirected to the server-side instance of the same web object. This is Schemat's realization of the _remote procedure call_ (RPC), with the important difference that the call is always related to a particular web object, and it can be executed on the client and server alike, providing isomorphism of the application code.

- With a few exceptions for system objects, web objects are **isomorphic** and can be instantiated and executed in every environment: on a client, or a server, _without_ any changes in the code or import statements (the code is _isomorphic_). This is an important feature that bridges the gap between server- and client-side parts of the application, and allows for a unified development model. For example, isomorphism allows the same React code to be rendered on the server (Server-Side Rendering, or SSR) and in the browser (Client-Side Rendering, or CSR); or, the same validation procedures to be executed on the server when inserting data into the database, and on the client where the data is edited in a web form and the user must be informed about mistakes _before_ the form gets submitted.

- Database **indexes** can be created for particular properties of web objects, including for nested, multivalued, inherited and imputed properties. Modification of a web object automatically propagates updates to the relevant indexes. Every index itself is represented by a web object of a system category, `Index`.

- When retrieving index records, their binary content can be mapped back onto web object properties, which creates **partial objects**. Partial objects can be used in a similar way as fully-loaded objects, except they are not cached and cannot be modified and saved back to the database. In particular, `obj.load()` can be called on a partial object to replace its content with the full content from the object's database entry. [TODO]

- In the future, access to web objects will be secured through authentication and authorization mechanisms. [TODO]


It is important to note that not only user-facing functionalities or data are represented as web objects. Schemat itself consists in major part of web objects - called **system objects** - which implement core functionalities of the platform, like the data store, cluster management, network communication, URL routing, etc. System objects implement all of the backend logic and are the ones that store all configuration of the cluster and the application.

One important group of system objects are **system categories**, primarily the root category (`[Category]`) that all other categories inherit from.

Another group are **agents**: objects of the `[Agent]` category that can be _installed_ on a specific node in the cluster to execute a recurring _event loop_ over there. Typically, agents are responsible for managing and granting access to local resources, like disk space or network ports; and they can also serve as a **microservice** for other system objects. Examples include:
- **servers** that accept external requests, like the edge HTTP server threads;
- data blocks that manage local data files and serve read/write requests via **RPC calls** on behalf of other objects;
- **background tasks** that perform periodic operations, like pruning and compacting log files in the database.

All such activities are implemented as web objects that inherit from the `[Agent]` category and get deployed on particular nodes in the cluster before they become fully operational. Agents can be _installed_ and _uninstalled_ on a given node; and they can be _started_, _stopped_ or _restarted_ on demand. Once in a while, running agents get refreshed (reloaded and reinstantiated), to let the cluster dynamically react to the changes in agent configuration and their internal settings. When the changes to agents or other system objects are critical and need to be quickly propagated across the cluster, they can be **broadcasted** to all nodes right after being saved to the database. In such case, the local cached instances of the objects are expired and replaced with the new content from the database.


<!-- Some of these system objects make use of special internal functionality provided by Schemat.

- Select system objects may serve as **agents** that are deployed on a particular node in the cluster and expose a **microservice** for use by other system objects. Typically, the agent is responsible for managing and granting access to local resources, like disk space; and runs an infinite loop (event loop) that processes incoming requests and performs operations (RPC calls) on behalf of calling objects. Schemat takes care of refreshing the agent object between requests, so modifications to the agent's properties and behavior are possible even while the agent is running. 
- Important system objects (agents or regular objects) may be **broadcasted** upon update to all nodes in the cluster. This enables immediate propagation of changes across the entire cluster, and allows local refresh procedures to reinstantiate the object with its new content even before the cache expiration of the existing local instance.
-->


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
