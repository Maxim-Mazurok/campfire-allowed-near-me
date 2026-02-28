import React from "react";
import type { ReactElement } from "react";
import { MantineProvider } from "@mantine/core";
import { render } from "@testing-library/react";
import type { RenderOptions } from "@testing-library/react";
import { renderToStaticMarkup as reactRenderToStaticMarkup } from "react-dom/server";
import { campfireTheme } from "../web/src/theme";

const TestProviders = ({ children }: { children: React.ReactNode }) => (
  <MantineProvider theme={campfireTheme}>{children}</MantineProvider>
);

export const renderWithMantine = (
  ui: ReactElement,
  options?: Omit<RenderOptions, "wrapper">
) => render(ui, { wrapper: TestProviders, ...options });

export const renderToStaticMarkupWithMantine = (ui: ReactElement): string =>
  reactRenderToStaticMarkup(
    <MantineProvider theme={campfireTheme}>{ui}</MantineProvider>
  );
