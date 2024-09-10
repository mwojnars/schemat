## Demonstration apps

### 1. Booksy

Objectives:
- static HTML
- templates (EJS)
- assets (CSS, pics)
- site configuration
- web objects & categories

What's new (as compared to traditional web frameworks):
- site configuration is fully stored in DB (see db-site.yaml)
- schema of application objects is fully stored in DB (Category objects, see db-app.yaml)
  - web interface for schema editing (todo: improve)
  - smooth modifications of the schema in the future; incremental migrations
- built-in web interface for creating & editing application objects, a la CMS (todo: improve)
- system URLs: `/$/<id>`, available out of the box
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