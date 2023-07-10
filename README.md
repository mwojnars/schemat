# Schemat

(_WARNING: This is a work in progress at an early stage of development!_)

**Schemat** is an object-oriented software platform for scalable, data-centric web applications 
with complex and evolving data schemas.

It provides a uniform **object space** that can be interacted with across the network from any machine,
be it a server-side storage (database) node, a compute (app server) node, or a client machine.
In addition, Schemat makes application objects **network-aware** and unifies the client and server
environments to the point where a single object can fully encapsulate a particular web functionality
-- its _data_, _behavior_, and _appearance_ -- contrary to traditional approaches like MVC, 
where these three aspects of an atomic functionality are implemented separately and remain dispersed 
throughout the codebase, which prevents the true OOP to emerge.
By creating an **extended object model** that spans the entire application stack -- from the database to the client -- 
Schemat is the first application platform that genuinely brings the full expression of OOP paradigm to the web.

Schemat is written in Node.js and Javascript.


### Features

[//]: # (Existing and planned features include:)

Schemat already provides, or _will_ provide in the future:

- Built-in scalable, distributed, **NoSQL store** that keeps all primary data as JSON-serialized 
  **application objects** (_items_) and allows for creation of derived indexes and aggregations through 
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
  between the platform and application code.

<!---

- **CSS-safe embedding** of widgets in the front-end.

A) Object-Oriented Data Model:
B) Network-Enabled Universal Objects:
C) Safe & Modular Front-End Development:

- **network polimorphism** of data objects: .....
- **web-aware encapsulation** for objects that binds together their data, behavior, and appearance, 
  and allows for their transparent execution on both the client and the server; 
- **universality** of the data objects, which can be instantiated and executed on both the client and the server;

In traditional OOP, an object comes with a set of methods that represent its local behavior.
Schemat extends this approach by allowing objects to expose:
- **services**, which are server-side methods that can be executed remotely, either by another copy of the same object 
  on a different machine, or by an external client (like a user's browser); for this purpose, every service 
  defines not only a code to be performed on the server, but also a communication protocol that specifies how
  the input and output data should be encoded and transmitted over the network; when instantiating an object
  on a remote machine, it automatically receives an internal proxy client that exposes the same interface as the
  original object, but forwards all method calls to the remote machine, and receives the results back;
- **actions** are pre-packaged services that can be executed on any machine, locally or remotely, using 
  the exact same interface, similar to calling a local method of the object;

with the concept of **remote behavior** (methods that are executed on the server), and **remote appearance** 
(CSS styles that are applied on the server);

- In traditional OOP software, objects are **network-agnostic**: they are designed to be executed on a single machine, 
  and cannot be passed between machines without loss of information;
- Schemat extends the traditional OOP software model with network-aware features
--->

......
