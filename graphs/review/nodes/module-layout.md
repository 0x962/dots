Runs when: The diff adds a model, a serializer, a view, or a service class. Signals: a class that inherits `models.Model`, `Serializer`, `ModelSerializer`, `APIView`, `ViewSet`, or `GenericAPIView`, a class whose name ends in `Service`, or a new or changed file under a `models/`, `serializers/`, `views/`, or `services/` package. When that misses, return SKIP with the file that decided it.

Rules:
1. Read the layout rule before you judge anything. Open the nearest `CLAUDE.md` or `AGENTS.md` above each changed file on the base branch, and hold the diff to what that file says.
2. A package whose instruction file states no layout rule is out of scope. Say that you skipped it, and stop there.
3. Quote the instruction file and the heading you read it under in every finding. A finding with no quotation is a finding you invented.
4. The rule as written beats every rule below. When the two disagree, follow the instruction file and report the difference.
5. The rules below are the shape `backend/operator-service/CLAUDE.md` states today. Read them as the example, not as the standard.
6. One model, one serializer, one view, or one service to a file, inside a package named for what it holds. A second class of the same kind in a file that already holds one is a finding.
7. A new `models.py` or `views.py` module in an app that already has the matching package is a finding. The class belongs in the package.
8. The package `__init__.py` imports every name and lists it in `__all__`. A class the `__init__.py` does not re-export is a finding.
9. A file takes the name of the thing, not the name of its type. `connection.py`, not `connection_model.py`.
10. An enum lives in the file of the model that uses it.
11. A serializer that reads a request body is named `<Action>RequestSerializer`, and it sits in the file of the view that reads it. The `serializers/` package holds only what the API sends back.
12. A test sits beside the module it covers, named `<module>_test.py`.
13. Layout drift on its own is `likely`. Mark it `certain` only when it breaks something real: an import that now resolves to a different object, a name that `__all__` drops while a caller imports it, or a model Django can no longer find.
14. Report a class you did not move, and name the file it belongs in.
