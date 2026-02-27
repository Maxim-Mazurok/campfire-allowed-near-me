import { createTheme, virtualColor } from "@mantine/core";

export const campfireTheme = createTheme({
  defaultRadius: "md",
  colors: {
    warning: virtualColor({
      name: "warning",
      dark: "orange",
      light: "orange",
    }),
  },
  components: {
    Tooltip: {
      styles: {
        tooltip: {
          backgroundColor: "var(--mantine-color-body)",
          color: "var(--mantine-color-text)",
          border: "1px solid var(--mantine-color-default-border)",
        },
      },
    },
  },
});
