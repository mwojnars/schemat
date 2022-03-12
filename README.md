## Schemat / Hyperweb

### Boot Up

- DB rings

### Item

- Properties (.data)
- Prototypes (on items)
- Inheritance (via prototypes on categories)
- VIEW_*() methods CANNOT be "async". Any async initialization
  must be done in the `async init(data) {...}` method.
- Caching: `Item.setCaching(...)` with a list of method names.

### Routing

- **SUN** (Schemat's Universal Namespace)
  - files
  - items
- **active routing**: itermediate items play active role in URL path interpretation; examples:
  - ABTest

---
## DEVELOPMENT

Adminer plugins:
  
    sudo apt install php-mbstring
    sudo service apache2 restart

---

