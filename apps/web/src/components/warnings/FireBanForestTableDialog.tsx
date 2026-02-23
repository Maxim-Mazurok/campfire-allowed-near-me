import { Button, Modal, Table, Text } from "@mantine/core";
import type { FireBanForestTableProps } from "./WarningsTypes";

export const FireBanForestTableDialog = ({
  fireBanForestTableOpen,
  closeFireBanForestTable,
  fireBanPageForests,
  sortedFireBanPageForests,
  fireBanForestSortColumn,
  fireBanForestTableSortLabel,
  toggleFireBanForestSort
}: FireBanForestTableProps) => {
  return (
    <Modal
      opened={fireBanForestTableOpen}
      onClose={closeFireBanForestTable}
      title={`Solid Fuel Fire Ban Forests (${fireBanPageForests.length})`}
      // @ts-expect-error Mantine v8 attributes prop works at runtime but ModalRootFactory types don't expose it
      attributes={{ content: { "data-testid": "fire-ban-forest-table-dialog" } }}
      closeButtonProps={{ "aria-label": "Close" }}
      size="xl"
      centered
    >
      <Text size="sm" c="dimmed" mb="sm">
        Sort columns alphabetically by clicking the table headers.
      </Text>
      <Table striped highlightOnHover data-testid="fire-ban-forest-table">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>
              <Button
                variant="subtle"
                size="compact-xs"
                fw={700}
                color={fireBanForestSortColumn === "forestName" ? "blue" : "gray"}
                data-testid="fire-ban-forest-table-forest-sort"
                onClick={() => toggleFireBanForestSort("forestName")}
              >
                Forest name{" "}
                {fireBanForestSortColumn === "forestName"
                  ? `(${fireBanForestTableSortLabel})`
                  : ""}
              </Button>
            </Table.Th>
            <Table.Th>
              <Button
                variant="subtle"
                size="compact-xs"
                fw={700}
                color={fireBanForestSortColumn === "areaName" ? "blue" : "gray"}
                data-testid="fire-ban-forest-table-region-sort"
                onClick={() => toggleFireBanForestSort("areaName")}
              >
                Region name{" "}
                {fireBanForestSortColumn === "areaName"
                  ? `(${fireBanForestTableSortLabel})`
                  : ""}
              </Button>
            </Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {sortedFireBanPageForests.length > 0 ? (
            sortedFireBanPageForests.map((forest) => (
              <Table.Tr key={`${forest.id}:fire-ban-table`} data-testid="fire-ban-forest-table-row">
                <Table.Td>{forest.forestName}</Table.Td>
                <Table.Td>{forest.areaName}</Table.Td>
              </Table.Tr>
            ))
          ) : (
            <Table.Tr>
              <Table.Td colSpan={2}>No forests are currently available from Solid Fuel Fire Ban pages.</Table.Td>
            </Table.Tr>
          )}
        </Table.Tbody>
      </Table>
    </Modal>
  );
};
