import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { MantineProvider } from "@mantine/core";
import "@mantine/core/styles.css";
import "leaflet/dist/leaflet.css";
import "./styles.css";
import { App } from "./App";
import { queryClient } from "./lib/query-client";
import { campfireTheme } from "./theme";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <MantineProvider theme={campfireTheme} defaultColorScheme="auto">
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </MantineProvider>
  </React.StrictMode>
);
