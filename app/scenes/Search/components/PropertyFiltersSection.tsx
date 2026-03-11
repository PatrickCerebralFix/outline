import { PlusIcon } from "outline-icons";
import { observer } from "mobx-react";
import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import styled from "styled-components";
import Button from "~/components/Button";
import useStores from "~/hooks/useStores";
import { PropertyFilter } from "./PropertyFilter";
import type { PropertyFilterState } from "./PropertyFilter";

type Props = {
  /** The current list of property filter states. */
  filters: PropertyFilterState[];
  /** Called when a field in any filter row changes. */
  onChange: (index: number, updates: Partial<PropertyFilterState>) => void;
  /** Called to add a new empty filter row. */
  onAdd: () => void;
  /** Called to remove the filter row at the given index. */
  onRemove: (index: number) => void;
};

export const PropertyFiltersSection = observer(
  function PropertyFiltersSection({ filters, onChange, onAdd, onRemove }: Props) {
    const { t } = useTranslation();
    const { propertyDefinitions } = useStores();

    useEffect(() => {
      const load = async () => {
        try {
          await propertyDefinitions.fetchDefinitions();
        } catch (err) {
          toast.error((err as Error).message);
        }
      };

      void load();
    }, [propertyDefinitions]);

    const hasActiveFilter = useMemo(
      () => filters.some((f) => !!f.propertyDefinitionId),
      [filters]
    );

    return (
      <PropertyFiltersContainer>
        {filters.map((filter, index) => (
          <PropertyFilter
            key={index}
            index={index}
            propertyDefinitionId={filter.propertyDefinitionId}
            operator={filter.operator}
            value={filter.value}
            onChange={onChange}
            onRemove={onRemove}
            showRemove={filters.length > 1}
          />
        ))}
        {hasActiveFilter && (
          <AddFilterButton onClick={onAdd} neutral>
            <PlusIcon size={16} /> {t("Add property filter")}
          </AddFilterButton>
        )}
      </PropertyFiltersContainer>
    );
  }
);

const PropertyFiltersContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-top: 4px;
`;

const AddFilterButton = styled(Button)`
  align-self: flex-start;
  font-size: 13px;
  gap: 4px;
`;
