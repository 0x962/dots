Runs when: The diff adds or changes an HTTP endpoint. Signals: a route table or URL map, a controller, a view that answers a request, a serializer or a response schema, an OpenAPI or GraphQL schema file, an SDK or client method that calls an endpoint, or a status code literal. When that misses, return SKIP with the file that decided it.

Rules:
1. Read the endpoints the service already exposes first. The convention this API already follows beats a general rule. Report a conflict between the two; do not rewrite the API to match the textbook.
2. A path names a resource with a plural noun: `/reservations`, `/hotels/{hotelId}/rooms`. A path never holds a verb.
3. The method carries the verb. GET reads, POST creates, PUT replaces the whole representation, PATCH changes part of it, DELETE removes.
4. GET and HEAD change no state. GET, PUT, DELETE, and HEAD give the same result when the client repeats them.
5. An action that is not a create, a read, an update, or a delete becomes its own resource. `POST /reservations/{id}/cancellations`, not `POST /reservations/{id}/doCancel`.
6. Return the right status. 200 for a read or an update that returns a body, 201 with a `Location` header for a create, 202 for accepted work that finishes later, 204 for a success with no body, 400 for a malformed request, 401 for no identity, 403 for an identity without the right, 404 for a resource that does not exist, 405 for a method the resource does not answer, 409 for a conflict with the current state, 415 for an unsupported media type, 422 for a well formed request that fails a rule, 429 for a rate limit.
7. Never answer a failure with 200 and an error field in the body.
8. Nest a path one level, and only to express ownership. Past one level, use the flat collection with a filter: `/rooms?hotelId=123`, not `/hotels/1/floors/2/rooms/3/beds`.
9. A collection endpoint filters, sorts, and paginates through query parameters, and returns the page metadata the client needs to ask for the next page.
10. Every error in the API shares one body shape. The status code carries the class of the failure; the body carries the detail.
11. An identifier belongs in the path, not in a query parameter and not in the body.
12. Do not tunnel a method through POST, and do not read a method override header.
13. Keep the version prefix the rest of the API uses. Do not start a second versioning scheme.
14. A response holds the resource, not a wrapper that repeats the status. Keep the field naming of the existing API.
15. A create that a client may retry needs an idempotency key when repeating it would make a second resource.
16. Report every finding with the method and the path, so the reader can find the endpoint without the diff.
