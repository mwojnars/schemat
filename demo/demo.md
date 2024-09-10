## Demonstration apps

### 1. Booksy

Objectives:
- static HTML
- templates (EJS)
- assets (CSS, pics)
- site configuration
- web objects & categories
- layout of application folder: flexible & organized around functionalities (unlike MVC)
- URLs

What's new (as compared to traditional web frameworks):
- site configuration is fully stored in DB (see db-site.yaml)
- schema of application objects is fully stored in DB (Category objects, see db-app.yaml)
  - web interface for schema editing (todo: improve)
  - smooth modifications of the schema in the future; incremental migrations
  - type attributes: `info`, `repeated`
- built-in web interface for creating & editing application objects, a la CMS (todo: improve)
- system URLs: `/$/<id>` -- available out of the box
- custom URLs: `/books`, `/authors` ??
- endpoint names in URLs: `::view`, `::control`, default endpoint
- loading objects (`schemat.list_category()`, `.load()`)
- repeated fields and "plural" property name (`.name$`)
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