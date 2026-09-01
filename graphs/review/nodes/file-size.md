# Responsibility

AI tends to make the following mistakes. Find and recommend fixes. 

## Large Files 

One file with everything. For example, one single `views.py` with 5 views. Prefer one file per thing. 

```
views/
  users.py
  posts.py
```

Same applies to components, models, schemas, etc. 

## Poor Directory Structure 

Directory structure should be consistent, thoughtful and well designed. Schemas, shared shapes, views, auth tools, utils. 

## Files where they don't belong

A random make_request.py in `models` ? Agents can get lazy. 