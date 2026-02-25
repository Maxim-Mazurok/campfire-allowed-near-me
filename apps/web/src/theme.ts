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
});
