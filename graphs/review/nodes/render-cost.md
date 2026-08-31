Runs when: The diff adds or changes a component, a hook, or a list that draws data. When that misses, return SKIP with the file that decided it.

Rules:
1. No work in a render body. A sort, a filter, a date format, or a regular expression over a list runs on every draw. Compute it once and remember it.
2. A list key identifies the row. Use the row's own id. An array index as a key makes the wrong row keep the wrong state when the list reorders.
3. An effect lists every value it reads in its dependencies. A missing one makes the effect run against a stale value.
4. An effect that only computes a value should not exist. Compute the value while rendering instead of storing it in state.
5. State that derives from other state is a bug waiting to happen. Compute it; do not store a second copy that can disagree with the first.
6. Do not create an object, an array, or a function inside a prop unless the child is cheap to redraw. A new reference on every render defeats the child's memo.
7. A list that can grow past a few hundred rows needs virtualisation. Report it with the largest row count the data source can produce.
8. An effect that fetches needs a cleanup that cancels the request, or the answer to an old request overwrites a new one.
9. Do not subscribe a whole tree to one store. Select the field the component reads, so that a change elsewhere does not redraw it.
10. An image needs its dimensions, so the page does not jump when it loads.
11. Report a cost you did not fix, and say what makes it expensive and at what size it starts to hurt.
