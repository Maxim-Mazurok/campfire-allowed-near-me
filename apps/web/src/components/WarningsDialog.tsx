import { Badge, Group, Modal, Text } from "@mantine/core";
import { IconAlertTriangle } from "@tabler/icons-react";
import { FireBanForestTableDialog } from "./warnings/FireBanForestTableDialog";
import { WarningsSections } from "./warnings/WarningsSections";
import type { FireBanForestTableProps, WarningSectionProps } from "./warnings/WarningsTypes";

interface WarningsDialogProperties {
  isOpen: boolean;
  warningCount: number;
  closeWarningsDialog: () => void;
  warningSections: WarningSectionProps;
  fireBanForestTable: FireBanForestTableProps;
}

export const WarningsDialog = ({
  isOpen,
  warningCount,
  closeWarningsDialog,
  warningSections,
  fireBanForestTable
}: WarningsDialogProperties) => {
  return (
    <>
      <Modal
        opened={isOpen}
        onClose={closeWarningsDialog}
        title={
          <Group gap="xs">
            <IconAlertTriangle size={20} stroke={1.5} color="var(--mantine-color-warning-8)" />
            <Text fw={600}>Warnings</Text>
            <Badge size="lg" variant="filled" color="warning" circle>{warningCount}</Badge>
          </Group>
        }
        // @ts-expect-error Mantine v8 attributes prop works at runtime but ModalRootFactory types don't expose it
        attributes={{ content: { "data-testid": "warnings-dialog" } }}
        closeButtonProps={{ "aria-label": "Close" }}
        size="lg"
        centered
      >
        {warningCount === 0 ? <Text c="dimmed">No warnings right now.</Text> : null}
        <WarningsSections {...warningSections} />
      </Modal>
      <FireBanForestTableDialog {...fireBanForestTable} />
    </>
  );
};
