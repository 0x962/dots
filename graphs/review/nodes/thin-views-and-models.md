Runs when: The diff adds or changes a view, a route handler, a controller, a page component, a serializer, or a model. When that misses, return SKIP with the file that decided it.

Rules:
1. A view reads the request, calls one service function, and renders what comes back. That is the whole job.
2. A view holds no business rule, no database query, no calculation the domain cares about, and no orchestration of several steps.
3. A view that calls three services in order is orchestrating. That sequence is one service function, and the view calls it.
4. A model holds its fields, its relations, and the validation of its own data. Nothing else.
5. A model does not call another service, does not send an email, does not queue a job, and does not reach the network.
6. A model does not run a workflow across several models. That workflow is a service function.
7. A property on a model that reads another table on every access is a query in disguise. Move it to the service.
8. A service function takes plain arguments and returns plain data. It never takes a request object, and it never returns a response object; that translation is the view's job.
9. Where the instruction file of the changed path names a service class convention, hold the diff to it and quote that file in the finding. `backend/operator-service` calls for a `<Thing>Service` in `<app>/services/<thing>.py`, with static methods that take keyword arguments, return models or querysets, and raise their own exceptions rather than the request framework's.
10. Keep the behaviour identical while you move code. A move that also changes a rule hides the rule change.
11. Report logic you did not move, and name the service that should hold it.
