# Architecture


- Network Object / Web Object / Distributed Object (Web OOP)
  - an object that lives on the network: a collection of instances (copies) of the same local object 
    existing on different machines; the copies may communicate with each other and assume different behavior (client/server) 
    depending on the location
  - `Item` class, "item" = "web object"
  - 3x types of objects:  user / application / system objects
  - objects created / stored in DB / transmitted / instantiated / executed -- on any! machine (db/server/client)
  - UI = browse / view / modify objects
- Object Model:
    - physical layer:
      - class ("@")
      - reference ("@")
      - Classpath
      - repeated fields (Catalog / Data)
    - logical layer:
      - `_class_`
      - `_category_`: schema & defaults
      - multiple inheritance
      - compound values: merging of inherited/default (Catalog)
    - proxy wrapper & caching of properties
    - networking
      - endpoints (`PROTO/name`) & API (`_api_`)
      - actions (`_net_.PROTO.name()`)
      - RPC to myself only
- Category
  - `schema` 
  - data types
- Site
    - database
      - rings
      - main sequence
      - indexes
    - file system & containers
      - objects / files
      - folders / namespaces
      - URL generation
      - (dynamic imports?)
- Schemat (global instance)
  - cache of objects
  - site
  - db
- UI:
  - Component:
    - React.Component
    - scoped CSS
  - Page & View
    - view = View + object
  - Assets:
    - Type.collect()
    - deduplication
    - render_all()
    - nested styles
    - same assets for all types of pages per object, no differentiation