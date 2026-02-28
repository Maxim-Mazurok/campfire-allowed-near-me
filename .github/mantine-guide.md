# Mantine v8 — Quick Reference for AI Agents

> Canonical docs for LLMs: <https://mantine.dev/llms.txt>
> Full single-file reference: <https://mantine.dev/llms-full.txt>
> Use `mcp_context7` with library ID `/llmstxt/mantine_dev_llms_txt` for detailed API lookups.

---

## 1. Core Principles

1. **Use what exists** — Mantine ships 120+ components and 70+ hooks. Before building a custom widget, search Mantine's catalogue. If a component does 80% of what you need, use it and style the remaining 20% with the Styles API instead of re-implementing from scratch.
2. **Go with the flow** — Follow Mantine conventions (props, Styles API, CSS variables, `rem` units) rather than fighting them. Avoid heavy overrides and custom CSS unless Mantine truly has no solution.
3. **Keep styling lightweight** — Prefer built-in props (`color`, `variant`, `size`, `radius`), theme-level `defaultProps`, and CSS modules. Avoid inline `style` objects; avoid `!important`.
4. **Accessibility out of the box** — Mantine components handle ARIA, focus management, and keyboard navigation. Do not strip or override those features.
5. **Use the theme** — Colors, spacing, radii, shadows, and typography should come from the Mantine theme object rather than raw CSS values. This keeps the design system consistent.
6. **No custom hex colors** — Never use raw hex/RGB/HSL color values anywhere (components, CSS modules, inline styles, or even in the theme file). Always use Mantine's built-in named colors (`green.6`, `gray.3`, `red.5`, `dimmed`, etc.). If a built-in color does not fit, discuss with the user before introducing a new palette.
7. **Theme changes require approval** — Do not modify `web/src/theme.ts` (add colors, change primary color, adjust radii, spacing, etc.) without explicit permission from the user in the current session. Propose the change and wait for approval.

---

## 2. Project-Specific Setup

| Item | Value |
|---|---|
| Mantine version | **v8** (`@mantine/core ^8.3.15`, `@mantine/hooks ^8.3.15`) |
| Theme file | `web/src/theme.ts` |
| Primary color | `green` (custom 10-shade palette) |
| Default radius | `md` |
| Icon library | `@tabler/icons-react` — **do not** use FontAwesome or other icon sets |
| Test wrapper | `renderWithMantine` from `tests/test-utils.tsx` |
| CSS approach | CSS Modules (`.module.css`) + Mantine style props |

### Theme extension

Extend `web/src/theme.ts` via `createTheme()` rather than adding ad-hoc inline colors:

```tsx
import { createTheme } from "@mantine/core";

export const campfireTheme = createTheme({
  primaryColor: "green",
  defaultRadius: "md",
  colors: {
    green: [/* 10-shade palette */],
  },
  // Add defaultProps, component overrides, etc. here
});
```

---

## 3. Component Catalogue (by category)

Use this as a checklist before rolling your own solution.

### Layout

| Component | Purpose |
|---|---|
| `AppShell` | Responsive app frame with header, navbar, aside, footer |
| `Container` | Centered content with max-width and padding |
| `Grid` / `Grid.Col` | 12-column responsive grid (`span={{ base: 12, md: 6 }}`) |
| `SimpleGrid` | Equal-width columns, simpler API than Grid |
| `Group` | Horizontal flex row (use for button rows, inline elements) |
| `Stack` | Vertical flex column (use for form fields, card content) |
| `Flex` | Generic flex container when Group/Stack do not fit |
| `Center` | Center content both axes |
| `Space` | Explicit spacing from theme |
| `AspectRatio` | Maintain width/height ratio |
| `Divider` | Horizontal/vertical separator |
| `Box` | Base polymorphic component (like a styled `div`) |

### Typography

| Component | Purpose |
|---|---|
| `Title` | `h1`–`h6` headings |
| `Text` | Body text with `size`, `fw`, `c`, `truncate` props |
| `Highlight` | Highlight substring within text |
| `Anchor` | Themed `<a>` link |
| `Blockquote` | Blockquote with cite |
| `Code` | Inline and block code |
| `Kbd` | Keyboard key display |
| `Mark` | Highlighted text span |
| `List` | Ordered / unordered list |

### Inputs & Forms

| Component | Purpose |
|---|---|
| `TextInput` | String input |
| `NumberInput` | Numeric input with controls |
| `Textarea` | Auto-size or fixed textarea |
| `PasswordInput` | Password with visibility toggle |
| `Select` | Searchable dropdown |
| `MultiSelect` | Multi-value dropdown |
| `Autocomplete` | Free-text with suggestions |
| `Checkbox` / `Checkbox.Group` | Boolean / multi-boolean |
| `Radio` / `Radio.Group` | Single-select radio |
| `Switch` | Toggle switch |
| `SegmentedControl` | Inline segment picker |
| `Chip` / `Chip.Group` | Inline toggle chips |
| `Slider` / `RangeSlider` | Numeric range input |
| `ColorInput` / `ColorPicker` | Color picking |
| `FileInput` / `FileButton` | File upload |
| `PinInput` | OTP / pin code |
| `TagsInput` | Free-input tags |
| `NativeSelect` | Native browser `<select>` |
| `Fieldset` | Group related form fields |
| `JsonInput` | JSON textarea |

### Buttons & Actions

| Component | Purpose |
|---|---|
| `Button` | Primary action button (variants: `filled`, `outline`, `light`, `subtle`, `default`, `transparent`) |
| `ActionIcon` | Icon-only square button (same variants) |
| `CloseButton` | Pre-built close / dismiss button |
| `CopyButton` | Render-prop component for clipboard copy |
| `UnstyledButton` | Base for fully custom clickable elements |

### Feedback & Overlays

| Component | Purpose |
|---|---|
| `Modal` | Accessible dialog overlay |
| `Drawer` | Slide-in panel |
| `Dialog` | Fixed-position overlay dialog |
| `Popover` | Floating content relative to target |
| `HoverCard` | Popover on hover |
| `Menu` | Dropdown action menu |
| `Tooltip` | Hover tooltip |
| `Alert` | Static message banner |
| `Notification` | Toast notification item (see also `@mantine/notifications`) |
| `LoadingOverlay` | Overlay spinner |
| `Loader` | Spinner component |
| `Skeleton` | Content placeholder |
| `Progress` | Linear progress bar |
| `RingProgress` | Circular progress |
| `Overlay` | Semi-transparent overlay |

### Data Display

| Component | Purpose |
|---|---|
| `Badge` | Status badge / pill / tag |
| `Card` / `Card.Section` | Content card |
| `Paper` | Elevated surface (like a card without sections) |
| `Avatar` | User image / initials |
| `Image` | Themed image with fallback |
| `Table` | Styled HTML table |
| `Accordion` | Collapsible sections |
| `Tabs` | View switching |
| `Spoiler` | Show/hide long content |
| `Timeline` | Chronological event list |
| `Stepper` | Multi-step process |
| `Indicator` | Corner badge on another element |
| `ThemeIcon` | Icon inside themed circle |
| `ColorSwatch` | Color display |
| `NumberFormatter` | Format numbers with separators |
| `Breadcrumbs` | Navigation breadcrumbs |
| `NavLink` | Sidebar navigation link |
| `Pagination` | Page navigation |
| `Tree` | Tree structure display |

### Navigation

| Component | Purpose |
|---|---|
| `Burger` | Hamburger menu toggle |
| `Tabs` | Tab-based views |
| `NavLink` | Nested navigation |
| `Breadcrumbs` | Location breadcrumbs |
| `Pagination` | Page controls |
| `Stepper` | Step-based navigation |

### Utility

| Component | Purpose |
|---|---|
| `Portal` | Render outside parent DOM tree |
| `Affix` | Fixed-position portal element |
| `Transition` | Animate mount/unmount |
| `Collapse` | Slide-down expand/collapse |
| `FocusTrap` | Trap focus within child |
| `ScrollArea` | Custom scrollbar area |
| `VisuallyHidden` | Screen-reader-only content |
| `FloatingIndicator` | Animated indicator over element group |

### Extension Packages

| Package | Key Components |
|---|---|
| `@mantine/notifications` | `notifications.show()`, `.update()`, `.hide()`, `.clean()` — toast system |
| `@mantine/modals` | Centralized modal manager (`modals.open()`, `modals.openConfirmModal()`) |
| `@mantine/dates` | `DatePickerInput`, `DateTimePicker`, `Calendar`, `TimeInput`, etc. |
| `@mantine/charts` | `AreaChart`, `BarChart`, `LineChart`, `PieChart`, `DonutChart`, etc. (Recharts-based) |
| `@mantine/dropzone` | `Dropzone` — drag-and-drop file upload |
| `@mantine/carousel` | `Carousel` — Embla-based carousel |
| `@mantine/spotlight` | `Spotlight` — command palette / search |
| `@mantine/nprogress` | `NavigationProgress` — page-transition progress bar |
| `@mantine/tiptap` | `RichTextEditor` — Tiptap rich text editor |
| `@mantine/code-highlight` | `CodeHighlight` — syntax highlighting (Shiki/highlight.js) |

> **Only install extension packages when actually needed.** Currently this project uses only `@mantine/core` and `@mantine/hooks`.

---

## 4. Hooks Catalogue

Before writing custom hooks, check if Mantine already provides one.

### State Management

| Hook | Purpose |
|---|---|
| `useDisclosure` | Boolean open/close/toggle (modals, drawers, menus) |
| `useToggle` | Cycle through values |
| `useCounter` | Increment/decrement counter |
| `useListState` | Array state with helpers (append, remove, reorder) |
| `useSetState` | Partial-update object state (like class component `setState`) |
| `useMap` / `useSet` | Map/Set state wrappers |
| `useQueue` | Queue data structure state |
| `useUncontrolled` | Controlled/uncontrolled dual-mode |
| `useInputState` | Bind input value + onChange |
| `useValidatedState` | State with validation |
| `usePrevious` | Previous render value |
| `useStateHistory` | Undo/redo state |
| `useLocalStorage` | `localStorage`-synced state |

### UI & DOM

| Hook | Purpose |
|---|---|
| `useMediaQuery` | Match CSS media query |
| `useViewportSize` | Window width/height |
| `useElementSize` | Element dimensions (ResizeObserver) |
| `useResizeObserver` | Full ResizeObserver binding |
| `useIntersection` | IntersectionObserver |
| `useInViewport` | Boolean in-viewport check |
| `useScrollIntoView` | Smooth scroll to element |
| `useWindowScroll` | Window scroll position |
| `useClickOutside` | Detect clicks outside element |
| `useHover` | Track hover state |
| `useMouse` | Track mouse position |
| `useMove` | Track movement (drag) |
| `useFocusWithin` | Focus inside container |
| `useFocusTrap` | Trap focus |
| `useFocusReturn` | Return focus on unmount |
| `useMergedRef` | Merge multiple refs |
| `useFullscreen` | Fullscreen API |
| `useHeadroom` | Show/hide on scroll |
| `useHotkeys` | Keyboard shortcuts |
| `useLongPress` | Long-press detection |

### Timing & Performance

| Hook | Purpose |
|---|---|
| `useDebouncedValue` | Debounce a value |
| `useDebouncedCallback` | Debounce a callback |
| `useDebouncedState` | Debounced `useState` |
| `useThrottledValue` / `useThrottledState` / `useThrottledCallback` | Throttled equivalents |
| `useTimeout` | `setTimeout` with cleanup |
| `useInterval` | `setInterval` with cleanup |
| `useIdle` | Detect user idle |

### Utilities

| Hook | Purpose |
|---|---|
| `useId` | Stable unique ID for accessibility |
| `useOs` | Detect operating system |
| `useNetwork` | Network status |
| `useDocumentTitle` | Set `document.title` |
| `useDocumentVisibility` | Page visibility |
| `useFavicon` | Dynamic favicon |
| `useColorScheme` | Detect preferred color scheme |
| `useReducedMotion` | Detect reduced-motion preference |
| `useHash` | URL hash state |
| `usePageLeave` | Detect cursor leaving page |
| `useClipboard` | Copy to clipboard |
| `useEyeDropper` | Native eye dropper API |
| `useForceUpdate` | Force re-render |
| `useIsFirstRender` | First-render check |
| `useMounted` | Mounted state |
| `useIsomorphicEffect` | SSR-safe `useLayoutEffect` |
| `useDidUpdate` | `useEffect` that skips first render |
| `useShallowEffect` | Shallow-compare deps effect |
| `useFetch` | Simple fetch with state |
| `useTextSelection` | Track selected text |
| `useWindowEvent` | Typed `window.addEventListener` |
| `useEventListener` | Typed element `addEventListener` |
| `useMutationObserver` | MutationObserver binding |
| `useFileDialog` | File dialog API |

---

## 5. Styling Guide

### Priority order (prefer top to bottom)

1. **Built-in props** — `color`, `variant`, `size`, `radius`, `fw`, `ta`, `c`, `bg`, `p`, `m`, etc.
2. **Theme-level `defaultProps`** — set once in `createTheme()`, applied globally.
3. **CSS Modules** — `.module.css` files, applied via `className` or `classNames` prop.
4. **Styles API (`classNames` prop)** — target internal component parts: `classNames={{ root: classes.root, label: classes.label }}`.
5. **`style` prop** — only for truly dynamic one-off values (e.g. computed positions).
6. **`styles` prop** — inline styles targeting internal parts; avoid in production code.

### Style Props (layout shortcuts)

All Mantine components support shorthand style props:

| Prop | CSS Property | Example |
|---|---|---|
| `m`, `mt`, `mb`, `ml`, `mr`, `mx`, `my` | margin | `mt="md"` \|  `mx="auto"` |
| `p`, `pt`, `pb`, `pl`, `pr`, `px`, `py` | padding | `p="lg"` |
| `w`, `h`, `maw`, `mah`, `miw`, `mih` | width / height | `w={300}` \| `maw="100%"` |
| `ta` | text-align | `ta="center"` |
| `c` | color | `c="dimmed"` \| `c="red.6"` |
| `bg` | background | `bg="gray.1"` |
| `fw` | font-weight | `fw={700}` |
| `fz` | font-size | `fz="sm"` |
| `ff` | font-family | `ff="monospace"` |
| `lh` | line-height | `lh={1.5}` |
| `lts` | letter-spacing | `lts={-0.5}` |
| `td` | text-decoration | `td="underline"` |
| `display` | display | `display="flex"` |
| `pos` | position | `pos="relative"` |
| `top`, `left`, `right`, `bottom` | position offsets | |
| `opacity` | opacity | `opacity={0.5}` |
| `bd` | border | `bd="1px solid gray.3"` |
| `hiddenFrom` / `visibleFrom` | responsive visibility | `hiddenFrom="md"` |

Style props accept **responsive objects**: `mt={{ base: "sm", md: "lg" }}`.

> **Performance note:** Responsive style props generate `<style>` tags at runtime. For lists with many items, use CSS modules instead.

### Spacing and sizing scale

Use theme tokens, not raw pixels:

| Token | Default px |
|---|---|
| `xs` | 10 |
| `sm` | 12 |
| `md` | 16 |
| `lg` | 20 |
| `xl` | 32 |

Numbers are treated as pixels and converted to `rem`. Use `rem()` utility for explicit conversions.

### Colors

- Reference theme colors as `"green.6"`, `"gray.3"`, `"red.8"`, etc. (color name + shade 0–9).
- Use `"dimmed"` for secondary text.
- Use `var(--mantine-color-green-6)` in CSS.
- Light/dark variants: `@mixin light { ... }` / `@mixin dark { ... }` in PostCSS with `postcss-preset-mantine`.
- **Never use raw hex/RGB/HSL values** (e.g. `#2f855a`, `rgb(47, 133, 90)`) in components, CSS modules, or inline styles. Always use Mantine color tokens.
- **Do not add custom color palettes to the theme** without explicit user approval.

### Data attributes for state styling

Mantine components expose data attributes for styling states in CSS:

```css
.root[data-disabled] { opacity: 0.5; }
.root[data-variant="outline"] { border-color: var(--mantine-color-green-6); }
.root[data-active] { font-weight: 700; }
```

---

## 6. Forms

### `useForm` hook (`@mantine/form`)

```tsx
import { useForm } from "@mantine/form";

const form = useForm({
  mode: "uncontrolled",                    // recommended for v8
  initialValues: { email: "", age: 0 },
  validate: {
    email: (value) => (/^\S+@\S+$/.test(value) ? null : "Invalid email"),
    age: (value) => (value < 18 ? "Must be 18+" : null),
  },
});

// In JSX:
<TextInput
  label="Email"
  key={form.key("email")}
  {...form.getInputProps("email")}
/>
<form onSubmit={form.onSubmit((values) => handleSubmit(values))}>
```

- Prefer `mode: "uncontrolled"` (v8 default) for better performance.
- Use `form.getInputProps("fieldName")` to wire inputs — it provides `value`, `onChange`, `error`, and `onBlur`.
- Use `form.key("fieldName")` as the React `key` to enable proper uncontrolled re-rendering.
- For Zod validation: `import { zodResolver } from "mantine-form-zod-resolver"` and pass as `validate: zodResolver(schema)`.

---

## 7. Common Patterns

### Modal with `useDisclosure`

```tsx
import { Modal, Button } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";

function SettingsModal() {
  const [opened, { open, close }] = useDisclosure(false);
  return (
    <>
      <Button onClick={open}>Settings</Button>
      <Modal opened={opened} onClose={close} title="Settings">
        {/* content */}
      </Modal>
    </>
  );
}
```

### Responsive fullscreen modal

```tsx
const isMobile = useMediaQuery("(max-width: 50em)");
<Modal opened={opened} onClose={close} fullScreen={isMobile} />
```

### Button variants

```tsx
<Button variant="filled">Primary</Button>      {/* solid background */}
<Button variant="light">Secondary</Button>      {/* subtle background */}
<Button variant="outline">Outline</Button>
<Button variant="subtle">Ghost</Button>
<Button variant="default">Neutral</Button>       {/* gray border */}
<Button variant="transparent">Transparent</Button>
```

### Icon usage

```tsx
import { IconMapPin, IconFlame } from "@tabler/icons-react";

<ActionIcon variant="light" color="red">
  <IconFlame size={18} />
</ActionIcon>

<Button leftSection={<IconMapPin size={16} />}>Locate</Button>
```

### Responsive Grid

```tsx
<SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
  <Card>...</Card>
  <Card>...</Card>
  <Card>...</Card>
</SimpleGrid>
```

### Notifications (if `@mantine/notifications` is installed)

```tsx
import { notifications } from "@mantine/notifications";

notifications.show({
  title: "Success",
  message: "Forest data refreshed",
  color: "green",
  autoClose: 3000,
});
```

---

## 8. Anti-Patterns to Avoid

| Do NOT | Do Instead |
|---|---|
| Write a custom tooltip component | Use `<Tooltip>` |
| Write a custom modal wrapper | Use `<Modal>` |
| Use `div` + CSS for flex row | Use `<Group>` |
| Use `div` + CSS for flex column | Use `<Stack>` |
| Use `window.matchMedia` directly | Use `useMediaQuery` |
| Use raw `localStorage` | Use `useLocalStorage` |
| Use `setTimeout` without cleanup | Use `useTimeout` |
| Use `setInterval` without cleanup | Use `useInterval` |
| Write debounce utility | Use `useDebouncedValue` or `useDebouncedCallback` |
| Use FontAwesome or other icon sets | Use `@tabler/icons-react` |
| Add inline `style={{ color: "#2f855a" }}` | Use `c="green.5"` or theme token |
| Use raw hex/RGB/HSL anywhere (even theme) | Use Mantine built-in named colors only |
| Modify theme without asking | Propose theme changes and wait for explicit approval |
| Hard-code pixel values | Use spacing tokens (`"xs"`, `"sm"`, `"md"`, `"lg"`, `"xl"`) or `rem()` |
| Override Mantine class names with `!important` | Use `classNames` prop / Styles API |
| Write custom open/close state hooks | Use `useDisclosure` |
| Add `aria-*` manually to Mantine components | Trust built-in accessibility (verify first) |
| Nest `<Paper>` inside `<Card>` unnecessarily | Pick one surface component |
| Use `<h1>`–`<h6>` HTML elements | Use `<Title order={1}>` |
| Use `<p>` for styled text | Use `<Text>` |
| Use `<a>` for links | Use `<Anchor>` |

---

## 9. Testing with Mantine

- Wrap test renders with `renderWithMantine` from `tests/test-utils.tsx`.
- Set `env: "test"` on `MantineProvider` to disable transitions and portals (simplifies testing).
- The vitest setup (`tests/vitest-jsdom-setup.ts`) polyfills `window.matchMedia` and `ResizeObserver`.
- Mantine components use `role` and `aria-*` attributes — query by role in tests when possible.

---

## 10. When to Look Up Docs

Use `mcp_context7` with `/llmstxt/mantine_dev_llms_txt` (or `/mantinedev/mantine` for code-level API) when you need:

- Exact prop types for a specific component.
- Styles API selectors (which internal parts like `root`, `input`, `label` a component exposes).
- Migration details (v7 → v8 changes).
- Advanced patterns (Combobox for custom selects, polymorphic components, createFormContext).
- Extension package setup (`@mantine/notifications`, `@mantine/dates`, etc.).
