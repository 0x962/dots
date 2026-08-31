Runs when: The diff adds or changes any source file. When that misses, return SKIP with the file that decided it.

Rules:
1. Delete a commented-out block of code. The reader cannot tell whether it is a plan, a rollback, or a leftover, and version control already keeps it.
2. Delete an export that nothing imports. Confirm with `rg` across the whole repository first, and count the test files as importers.
3. Delete a branch that cannot run: a condition that is always true, a case for a value the type does not allow, an `if` after a `return`.
4. Delete a parameter no caller passes, and a parameter every caller passes the same value for.
5. Delete a flag, an option, or a setting that has one value everywhere. Inline the value it always has.
6. Delete an import, a variable, or a helper the file no longer uses.
7. Delete a function the pull request adds and never calls, unless it is the public surface of a new module.
8. A `TODO` with no owner and no ticket is a finding, not a deletion. Report it.
9. Keep code a test reaches. A helper only the tests use is live code.
10. Keep an export a plugin, an entry point, or a configuration file names as a string. That use never appears as an import statement, so search for the name as text before you delete it.
11. Report anything you did not delete, and name the evidence you used to decide it was dead.
