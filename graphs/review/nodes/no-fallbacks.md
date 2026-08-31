Runs when: The diff adds or changes executable code in any language. Skip only when the diff touches nothing but documentation, a lock file, or generated output. When that misses, return SKIP with the file that decided it.

Rules:
1. The standard is a loud failure. Let the error reach the caller and crash. A stack trace at the point of failure beats a silent fallback or a wrapped error.
2. Find every `try`/`catch`, `try`/`except`, `rescue`, and `recover` the diff adds or changes. Each one needs a very strong justification to survive.
3. A fallback survives on two conditions together. First, it sits at a true system boundary: input from a person, a call to an external service, a file the program does not own, or a network call whose failure is a normal outcome. Second, the code states the recovery in a comment, or a test exercises the recovery path.
4. Delete every other fallback. When you delete a `catch`, delete the handler body with it and let the error propagate. Do not re-raise a new error type that loses the original trace.
5. A fallback is not only a `try`. Search the diff for these signals as well.
6. A default that stands in for a failed lookup: `?? fallback`, `|| fallback`, `dict.get(key, default)`, `getattr(obj, name, default)`, `map.get(k) ?? make()` where the key must exist.
7. A swallowed promise or future: `.catch(() => {})`, `.catch(() => null)`, `except Exception: pass`, `except: pass`, a bare `rescue nil`.
8. A broad catch: `catch (e)` around more than one failing call, `except Exception`, `except BaseException`. A broad catch hides the error the author never considered.
9. Log and continue: the code writes a warning and then carries on with a value it knows is wrong.
10. An optional type used to hide a missing required value: a function that returns `None`, `null`, `[]`, or `{}` on failure while every caller treats the result as present.
11. A guard for a condition that cannot happen: `if not obj: return`, `hasattr(x, 'y')`, `if (typeof fn === 'function')` on a typed contract, a null check on a value the type system already guarantees.
12. An optional import: `try: import x except ImportError: x = None`.
13. A retry loop or a backoff around a call that is not a network call.
14. A validation of an internal input: a check on an argument that only this codebase passes. Trust internal code, framework guarantees, and typed contracts.
15. A `default:` branch in a switch over a closed set of values, when that branch invents a value instead of failing.
16. For each surviving fallback, write the justification into the code as a comment that states what recovers and why. Follow the comment rules: name the exact failure, in plain words, with no reference to a former version of the file.
17. Never add a new fallback of your own while you work.
18. Report a fallback you did not delete, and say in the finding which of the two survival conditions it fails.
