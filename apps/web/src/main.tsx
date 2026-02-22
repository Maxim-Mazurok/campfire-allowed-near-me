import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import "leaflet/dist/leaflet.css";
import "tippy.js/dist/tippy.css";
import "./styles.css";
import { App } from "./App";
import { queryClient } from "./lib/query-client";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>
);
