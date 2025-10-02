## Demonstration apps

### 1. The Bookstore

Objectives:
- static HTML
- templates (EJS)
- assets (CSS, pics)
- app configuration
- web objects & categories
- layout of application folder: flexible & organized around functionalities (unlike MVC)
- URLs

What's new (as compared to traditional web frameworks):
- app configuration is fully stored in DB (ring-cluster)
- schema of application objects is fully stored in DB (Category objects, see 02_app.*.yaml)
  - web interface for schema editing (todo: improve)
  - smooth modifications of the schema in the future; incremental migrations
  - type attributes: `info`, `multiple`
- built-in web interface for creating & editing application objects, a la CMS (todo: improve)
- system URLs: `/$/<id>` -- available out of the box
- custom URLs: `/books`, `/authors` ??
- endpoint names in URLs: `::view`, `::inspect`, default endpoint
- loading objects (`category.list_objects()`, `.load()`)
- multivalued fields and "plural" property name (`.name$`, `book.author$` vs `book.author`)
- versioning ?? (of schema and objects)


### 2. Shoppik

- URL slugs
- indexes
- Users & login ??
- permissions ??


### 3. Twister

- Couchbase
- scalability: performance under large workload & high data volume
- 