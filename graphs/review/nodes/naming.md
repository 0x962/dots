Runs when: The diff adds or renames a function, a method, a class, a variable, a constant, a file, or a database column. When that misses, return SKIP with the file that decided it.

Rules:
1. A name says what the thing is or what it does, in words a new hire reads without a glossary.
2. Do not use a coined team term in a name. `_demote_unavailable` becomes `_set_offline_if_still_gone`.
3. Do not use these words in a name unless the codebase already defines them as a domain term: liveness, watermark, demote, dangling, poison, touch, self-heal, routable.
4. Spell the word out. An abbreviation earns its place only when the domain writes it that way, for example `id`, `url`, `http`.
5. A boolean reads as a statement that is true or false: `is_open`, `has_expired`, `should_retry`. Not `flag`, not `status` for a boolean, and not a negative name such as `not_ready`.
6. A function name starts with a verb and names its effect. `get_user` reads, `create_user` writes. A `get` that writes is a lie.
7. A collection takes a plural name. A single item takes a singular one.
8. Use one word for one idea across the whole change. Do not call it `reservation` in one file and `booking` in the next.
9. Match the word this codebase already uses for the idea, even when another word is better in general. Report the mismatch; do not start a second vocabulary.
10. A name that needs a comment to explain it is the wrong name. Change the name and delete the comment.
11. Do not encode the type in the name. `user_list`, `str_name`, and `IUserInterface` repeat what the reader can see.
12. A constant names the reason, not the value. `AGENT_SHIFT_GRACE_SECONDS`, not `SIXTY`.
