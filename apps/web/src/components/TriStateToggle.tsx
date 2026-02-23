import { ActionIcon, Group } from "@mantine/core";
import { IconCheck, IconX, IconQuestionMark } from "@tabler/icons-react";
import type { TriStateMode } from "../lib/app-domain-types";

type TriStateToggleProps = {
  mode: TriStateMode;
  onToggle: (targetMode: Exclude<TriStateMode, "ANY">) => void;
  onReset: () => void;
  label: string;
  includeTestId?: string;
  excludeTestId?: string;
  anyTestId?: string;
  includeAriaLabel?: string;
  excludeAriaLabel?: string;
  anyAriaLabel?: string;
};

export const TriStateToggle = ({
  mode,
  onToggle,
  onReset,
  label,
  includeTestId,
  excludeTestId,
  anyTestId,
  includeAriaLabel,
  excludeAriaLabel,
  anyAriaLabel,
}: TriStateToggleProps) => {
  return (
    <Group gap={4} role="group" aria-label={`${label} filter`}>
      <ActionIcon
        size="sm"
        variant={mode === "INCLUDE" ? "filled" : "default"}
        color="green"
        onClick={() => onToggle("INCLUDE")}
        data-testid={includeTestId}
        aria-label={includeAriaLabel ?? `Include ${label}`}
      >
        <IconCheck size={14} />
      </ActionIcon>
      <ActionIcon
        size="sm"
        variant={mode === "EXCLUDE" ? "filled" : "default"}
        color="red"
        onClick={() => onToggle("EXCLUDE")}
        data-testid={excludeTestId}
        aria-label={excludeAriaLabel ?? `Exclude ${label}`}
      >
        <IconX size={14} />
      </ActionIcon>
      <ActionIcon
        size="sm"
        variant={mode === "ANY" ? "filled" : "default"}
        color="gray"
        onClick={onReset}
        data-testid={anyTestId}
        aria-label={anyAriaLabel ?? `${label} does not matter`}
      >
        <IconQuestionMark size={14} />
      </ActionIcon>
    </Group>
  );
};
