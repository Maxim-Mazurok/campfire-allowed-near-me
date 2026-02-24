import { useRef, useEffect, useState } from "react";
import { createPortal } from "react-dom";

type PopupShadowContainerProps = {
  children: React.ReactNode;
  className?: string;
};

/**
 * Renders children inside a Shadow DOM to isolate them from Leaflet CSS.
 *
 * CSS custom properties (Mantine theme variables) inherit through the shadow
 * boundary naturally. Document `<style>` tags are cloned into the shadow root
 * so Mantine component styles still work. Leaflet CSS selectors like
 * `.leaflet-container a` can't cross the shadow boundary, preventing
 * style interference with Mantine components (e.g. Badge text color).
 */
export const PopupShadowContainer = ({ children, className }: PopupShadowContainerProps) => {
  const hostReference = useRef<HTMLDivElement>(null);
  const [portalContainer, setPortalContainer] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    const hostElement = hostReference.current;
    if (!hostElement) {
      return;
    }

    const shadowRoot = hostElement.shadowRoot ?? hostElement.attachShadow({ mode: "open" });

    // Clear any previous content (React StrictMode double-mount)
    shadowRoot.replaceChildren();

    // Clone all document stylesheets into the shadow root.
    // Leaflet selectors (e.g. `.leaflet-container a`) won't match inside
    // because parent elements like `.leaflet-container` are outside the shadow boundary.
    const documentStyleElements = document.querySelectorAll("style, link[rel='stylesheet']");
    for (const styleElement of documentStyleElements) {
      shadowRoot.appendChild(styleElement.cloneNode(true));
    }

    // Create a container for the React portal content
    const contentContainer = document.createElement("div");
    if (className) {
      contentContainer.className = className;
    }
    shadowRoot.appendChild(contentContainer);
    setPortalContainer(contentContainer);

    // Watch for dynamically added styles (Mantine may inject lazily)
    const styleObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const addedNode of mutation.addedNodes) {
          const isStyleElement = addedNode instanceof HTMLStyleElement;
          const isStylesheetLink =
            addedNode instanceof HTMLLinkElement && addedNode.rel === "stylesheet";
          if (isStyleElement || isStylesheetLink) {
            shadowRoot.insertBefore(addedNode.cloneNode(true), contentContainer);
          }
        }
      }
    });
    styleObserver.observe(document.head, { childList: true });

    return () => {
      styleObserver.disconnect();
    };
  }, [className]);

  return (
    <div ref={hostReference} style={{ display: "contents" }}>
      {portalContainer ? createPortal(children, portalContainer) : null}
    </div>
  );
};
