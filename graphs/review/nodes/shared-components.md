Runs when: The diff adds or changes any user interface code: a component, a page, a template, a stylesheet, or markup in any framework. When that misses, return SKIP with the file that decided it.

Rules:
1. Find the shared component library before you judge anything. It is the package or the directory the screens already import their buttons and inputs from. Never start a second one.
2. A one off element is banned. Every button, input, select, checkbox, card, badge, chip, modal, drawer, tooltip, toast, table, list row, tab, avatar, spinner, skeleton, and empty state comes from the shared library.
3. Raw markup that reimplements a library component is a one off. A `<button>` with a class list that repeats the library button, or a `<div>` that draws a card, must become the library component.
4. When the library has no component for the element, add the component to the library and import it at the call site. Do not write the element in the screen and plan to move it later.
5. A variation of an existing component becomes a prop or a variant on that component. Never copy the component under a new name to change one detail.
6. Before you add a component, search the library for one that already fills the role under another name. Two names for one element is the same fault as a one off.
7. Use the design tokens the library defines. No hex colour, no raw pixel spacing, and no font size literal at a call site.
8. Compose the library's primitives when they already make the element. A new component earns its place only when composition cannot make it.
9. A component that is truly local to one screen, and that no other screen can use, stays local. Say in the finding why it cannot be shared.
10. Keep the accessibility the library component carries. Do not replace a library control with markup that loses the keyboard behaviour or the label.
11. Report a one off you did not move, and name the library component that should replace it, or the component the library needs.
