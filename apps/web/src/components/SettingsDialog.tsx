import { Modal, Radio, SegmentedControl, Stack, Text } from "@mantine/core";
import { useMantineColorScheme } from "@mantine/core";
import type { MantineColorScheme } from "@mantine/core";

interface SettingsDialogProperties {
  isOpen: boolean;
  avoidTolls: boolean;
  onClose: () => void;
  setAvoidTolls: (value: boolean) => void;
}

const colorSchemeOptions = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "auto", label: "System" }
];

export const SettingsDialog = ({
  isOpen,
  avoidTolls,
  onClose,
  setAvoidTolls
}: SettingsDialogProperties) => {
  const { colorScheme, setColorScheme } = useMantineColorScheme();

  return (
    <Modal
      opened={isOpen}
      onClose={onClose}
      title="Settings"
      // @ts-expect-error Mantine v8 attributes prop works at runtime but ModalRootFactory types don't expose it
      attributes={{ content: { "data-testid": "settings-dialog" } }}
      closeButtonProps={{ "aria-label": "Close" }}
      size="sm"
      centered
    >
      <Stack gap="lg">
        <div>
          <Text size="sm" fw={500} mb="xs">Color theme</Text>
          <SegmentedControl
            value={colorScheme}
            onChange={(value) => setColorScheme(value as MantineColorScheme)}
            data={colorSchemeOptions}
            fullWidth
            data-testid="color-scheme-control"
          />
        </div>

        <div>
          <Text size="sm" fw={500} mb={4}>Toll roads</Text>
          <Text size="sm" c="dimmed" mb="xs">
            Driving estimates use Google Routes traffic for the next Saturday at 10:00 AM
            (calculated at request time).
          </Text>
          <Radio.Group
            value={avoidTolls ? "avoid" : "allow"}
            onChange={(value) => setAvoidTolls(value === "avoid")}
          >
            <Stack gap="xs">
              <Radio value="avoid" label="No tolls (default)" data-testid="settings-tolls-avoid" />
              <Radio value="allow" label="Allow toll roads" data-testid="settings-tolls-allow" />
            </Stack>
          </Radio.Group>
        </div>
      </Stack>
    </Modal>
  );
};
