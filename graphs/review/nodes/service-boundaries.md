Runs when: The diff adds or changes a service module, or adds an import that crosses from one service or package into another. When that misses, return SKIP with the file that decided it.

Rules:
1. One service owns one domain. The service that defines a model is the service that reads and writes it.
2. A service never reads another service's tables, private helpers, or internal state. It calls that service's public function.
3. A service never imports a module from inside another service's directory. It imports that service's entry point.
4. No cycle between services. When two services need each other, the shared part moves to a third module that both call.
5. A shared module holds no domain logic of its own. It holds the types, the constants, and the pure helpers both callers need.
6. A service function names the operation in the domain's words, so that a caller reads the name and knows what happens.
7. Data crosses a boundary as plain data. Do not pass a model instance, a session, a request, or an open transaction into another service.
8. A service does not reach into another service's queue, cache key, or storage path.
9. A new dependency between two services needs a reason in the finding. Say which direction it goes and why it cannot go the other way.
10. Report a boundary break you did not fix, and name the public function the caller should use instead.
