/**
 * Vitest setup for jsdom tests that use Mantine components.
 *
 * Mantine's MantineProvider requires window.matchMedia and ResizeObserver,
 * which jsdom does not provide. This setup file polyfills them.
 *
 * Guarded so it's a no-op when running in Node environment.
 */

if (typeof window !== "undefined") {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });

  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  window.ResizeObserver = window.ResizeObserver || ResizeObserverStub;
}
