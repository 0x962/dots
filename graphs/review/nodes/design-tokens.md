Runs when: The diff adds or changes a stylesheet, a class list, a style property, or a theme file. When that misses, return SKIP with the file that decided it.

Rules:
1. Find the token source first: the theme file, the token module, or the library's scale. Judge every literal against it.
2. No colour literal at a call site. No hex, no `rgb()`, no named CSS colour. Use the token.
3. No raw spacing value. Padding, margin, and gap come from the spacing scale.
4. No font size, weight, or line height literal. Use the type scale.
5. No radius, shadow, or border width literal. Use the token.
6. No z-index number picked by hand. Use the layer scale the library defines.
7. A value that is close to a token but not equal to it is a finding. Snap it to the token, or report why the screen needs the other value.
8. A colour must work in both the light and the dark theme. A literal that only reads in one theme is a bug, not a style choice.
9. No breakpoint literal. Use the named breakpoint.
10. Report a value that no token covers. Say what the value is, where it is used, and which part of the scale it belongs beside.
