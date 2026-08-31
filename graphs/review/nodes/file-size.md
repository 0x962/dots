Runs when: The diff adds a source file, or adds lines to one. When that misses, return SKIP with the file that decided it.

Rules:
1. A source file stays under 300 lines. Count the lines of every file the diff adds or grows.
2. A file over 300 lines becomes a directory named after the file. Put one responsibility in each file inside it, and add an index that re-exports the public surface.
3. Split along the responsibilities, not at the line number. Three groups that do not call each other make three files.
4. One long function that cannot split keeps its file. Report it for its author instead of cutting it in a way that hides the flow.
5. Export one component, one service entry point, or one hook per file.
6. Place each new file where this repository places that kind of file. Read the repository's own structure guide, `AGENTS.md` or `CLAUDE.md`, before you make a directory.
7. Keep the import path of the public surface working. A caller outside the new directory imports the directory, not a file inside it.
8. Move code without changing it. A split that also rewrites a function is two changes in one and hides the rewrite.
9. Report a file over the limit that you did not split, with its line count and the responsibilities you would cut it along.
