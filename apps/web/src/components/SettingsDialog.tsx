import { Modal, Radio, Stack, Text } from "@mantine/core";

interface SettingsDialogProperties {
  isOpen: boolean;
  avoidTolls: boolean;
  onClose: () => void;
  setAvoidTolls: (value: boolean) => void;
}

export const SettingsDialog = ({
  isOpen,
  avoidTolls,
  onClose,
  setAvoidTolls
}: SettingsDialogProperties) => {
  return (
    <Modal
      opened={isOpen}
      onClose={onClose}
      title="Route Settings"
      // @ts-expect-error Mantine v8 attributes prop works at runtime but ModalRootFactory types don't expose it
      attributes={{ content: { "data-testid": "settings-dialog" } }}
      closeButtonProps={{ "aria-label": "Close" }}
      size="sm"
      centered
    >
      <Text size="sm" c="dimmed" mb="md">
        Driving estimates use Google Routes traffic for the next Saturday at 10:00 AM
        (calculated at request time).
      </Text>
      <Radio.Group
        label="Toll roads"
        value={avoidTolls ? "avoid" : "allow"}
        onChange={(value) => setAvoidTolls(value === "avoid")}
      >
        <Stack gap="xs" mt="xs">
          <Radio value="avoid" label="No tolls (default)" data-testid="settings-tolls-avoid" />
          <Radio value="allow" label="Allow toll roads" data-testid="settings-tolls-allow" />
        </Stack>
      </Radio.Group>
    </Modal>
  );
};
