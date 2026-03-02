import { IconHeart } from "@tabler/icons-react";
import { Anchor, Text } from "@mantine/core";

export const AppFooter = () => {
  return (
    <footer className="app-footer">
      <Text size="xs" c="dimmed" component="span">
        Data sourced from{" "}
        <Anchor href="https://www.forestrycorporation.com.au" target="_blank" rel="noreferrer" size="xs">
          Forestry Corporation of NSW
        </Anchor>
        {" "}and{" "}
        <Anchor href="https://www.rfs.nsw.gov.au" target="_blank" rel="noreferrer" size="xs">
          NSW RFS
        </Anchor>
        . Not official — always verify before lighting a fire.
      </Text>
      <Text size="xs" c="dimmed" component="span">
        Built with <IconHeart size={12} stroke={1.5} color="red" fill="red" style={{ verticalAlign: "middle" }} /> in Sydney by{" "}
        <Anchor href="https://github.com/Maxim-Mazurok" target="_blank" rel="noreferrer" size="xs">
          Maxim Mazurok{/* cspell:words Mazurok */}
        </Anchor>
        {" · "}
        <Anchor href="https://github.com/Maxim-Mazurok/campfire-allowed-near-me" target="_blank" rel="noreferrer" size="xs">
          GitHub
        </Anchor>
      </Text>
    </footer>
  );
};
