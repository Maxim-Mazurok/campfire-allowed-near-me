import { createTheme, virtualColor } from "@mantine/core";

export const campfireTheme = createTheme({
  primaryColor: "green",
  defaultRadius: "md",
  colors: {
    warning: virtualColor({
      name: "warning",
      dark: "orange",
      light: "orange",
    }),
    green: [
      "#e6f7ec",
      "#c8ebd5",
      "#a3deb8",
      "#7bd29c",
      "#53c680",
      "#2f855a",
      "#276e4c",
      "#1f573d",
      "#17402e",
      "#0f291f",
    ],
  },
});
