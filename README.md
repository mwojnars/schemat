## Hyperweb

### Item

- No custom attributes in Item subclasses. Use `@cached` whenever 
  temporary objects have to be created instead of assigning precomputed
  objects to `self` - the latter requires explicit item initialization,
  which is difficult to implement given different ways how an item can be
  created and initialized (often a delayed initialization would be needed).


---
## DEVELOPMENT

Adminer plugins:
  
    sudo apt install php-mbstring
    sudo service apache2 restart

---

