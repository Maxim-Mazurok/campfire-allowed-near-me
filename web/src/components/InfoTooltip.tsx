import { useState, useCallback, useRef, useEffect } from "react";
import type { ReactNode } from "react";
import { Popover, Text } from "@mantine/core";
import { IconInfoCircle } from "@tabler/icons-react";

type InfoTooltipProps = {
  label: ReactNode;
  width?: number;
  position?: "top" | "bottom" | "left" | "right";
  iconSize?: number;
};

export const InfoTooltip = ({
  label,
  width = 260,
  position = "top",
  iconSize = 14,
}: InfoTooltipProps) => {
  const [pinned, setPinned] = useState(false);
  const [hovered, setHovered] = useState(false);
  const triggerReference = useRef<HTMLSpanElement>(null);

  const handleClick = useCallback((event: React.MouseEvent | React.KeyboardEvent) => {
    event.stopPropagation();
    event.preventDefault();
    setPinned((current) => {
      if (current) {
        setHovered(false);
      }
      return !current;
    });
  }, []);

  const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (event.key === "Enter" || event.key === " ") {
      handleClick(event);
    }
  }, [handleClick]);

  // Dismiss on outside pointer-down (capture phase) or Escape key
  useEffect(() => {
    if (!pinned) {
      return;
    }

    const handleOutsidePointerDown = (event: PointerEvent) => {
      const target = event.target as Element;
      // Click on the trigger itself — let handleClick deal with toggle
      if (triggerReference.current?.contains(target)) {
        return;
      }
      // Any other click (including inside the popover content) dismisses
      setPinned(false);
      setHovered(false);
    };

    const handleEscapeKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPinned(false);
        setHovered(false);
      }
    };

    // Capture phase ensures we receive the event before any stopPropagation
    document.addEventListener("pointerdown", handleOutsidePointerDown, true);
    document.addEventListener("keydown", handleEscapeKey);
    return () => {
      document.removeEventListener("pointerdown", handleOutsidePointerDown, true);
      document.removeEventListener("keydown", handleEscapeKey);
    };
  }, [pinned]);

  const handleDismiss = useCallback(() => {
    setPinned(false);
    setHovered(false);
  }, []);

  return (
    <Popover
      opened={pinned || hovered}
      position={position}
      width={width}
      withArrow
      shadow="sm"
      closeOnClickOutside={false}
      onDismiss={handleDismiss}
    >
      <Popover.Target>
        <span
          ref={triggerReference}
          role="button"
          tabIndex={0}
          aria-label="More information"
          aria-expanded={pinned || hovered}
          className={`info-tooltip-trigger${pinned ? " info-tooltip-trigger--active" : hovered ? " info-tooltip-trigger--hovered" : ""}`}
          data-pinned={pinned ? "true" : undefined}
          onClick={handleClick}
          onKeyDown={handleKeyDown}
          onPointerEnter={() => setHovered(true)}
          onPointerLeave={() => setHovered(false)}
        >
          <IconInfoCircle size={iconSize} />
        </span>
      </Popover.Target>
      <Popover.Dropdown>
        <Text size="xs">{label}</Text>
      </Popover.Dropdown>
    </Popover>
  );
};
