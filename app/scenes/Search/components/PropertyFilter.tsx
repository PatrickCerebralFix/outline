import { CloseIcon } from "outline-icons";
import { observer } from "mobx-react";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import styled from "styled-components";
import {
  DocumentPropertyFilterOperator,
  DocumentPropertyType,
} from "@shared/types";
import FilterOptions from "~/components/FilterOptions";
import Input from "~/components/Input";
import NudeButton from "~/components/NudeButton";
import Tooltip from "~/components/Tooltip";
import useStores from "~/hooks/useStores";
import type { PropertyDefinitionOption } from "~/models/PropertyDefinition";

/** State shape for a single property filter row. */
export interface PropertyFilterState {
  propertyName?: string;
  propertyType?: DocumentPropertyType;
  operator: DocumentPropertyFilterOperator;
  value?: string;
}

type Props = {
  /** Position of this filter in the list. */
  index: number;
  propertyName?: string;
  propertyType?: DocumentPropertyType;
  operator: DocumentPropertyFilterOperator;
  value?: string;
  /** Called when any field in this filter changes. */
  onChange: (index: number, filter: Partial<PropertyFilterState>) => void;
  /** Called when the remove button is clicked. */
  onRemove?: (index: number) => void;
  /** Whether to show the remove button. */
  showRemove?: boolean;
};

type PropertyOption = {
  key: string;
  label: string;
  propertyName: string;
  propertyType: DocumentPropertyType;
};

type OperatorOption = {
  key: string;
  label: string;
};

const noValueOperators = new Set([
  DocumentPropertyFilterOperator.IsEmpty,
  DocumentPropertyFilterOperator.IsNotEmpty,
]);

function isPropertyOperator(
  value: string
): value is DocumentPropertyFilterOperator {
  return Object.values(DocumentPropertyFilterOperator).some(
    (operator) => operator === value
  );
}

/**
 * Returns the valid operators for the given property type.
 *
 * @param type - the property type.
 * @param t - the translation function.
 * @returns operator options for the type.
 */
export function getOperatorsForType(
  type: DocumentPropertyType | undefined,
  t: (key: string) => string
): OperatorOption[] {
  const isEmpty = { key: DocumentPropertyFilterOperator.IsEmpty, label: t("Is empty") };
  const isNotEmpty = { key: DocumentPropertyFilterOperator.IsNotEmpty, label: t("Is not empty") };

  switch (type) {
    case DocumentPropertyType.Number:
      return [
        { key: DocumentPropertyFilterOperator.Equals, label: t("Equals") },
        { key: DocumentPropertyFilterOperator.GreaterThan, label: t("Greater than") },
        { key: DocumentPropertyFilterOperator.LessThan, label: t("Less than") },
        { key: DocumentPropertyFilterOperator.Between, label: t("Between") },
        isNotEmpty,
        isEmpty,
      ];
    case DocumentPropertyType.Date:
      return [
        { key: DocumentPropertyFilterOperator.Equals, label: t("Equals") },
        { key: DocumentPropertyFilterOperator.GreaterThan, label: t("After") },
        { key: DocumentPropertyFilterOperator.LessThan, label: t("Before") },
        { key: DocumentPropertyFilterOperator.Between, label: t("Between") },
        isNotEmpty,
        isEmpty,
      ];
    case DocumentPropertyType.Select:
      return [
        { key: DocumentPropertyFilterOperator.Equals, label: t("Equals") },
        isNotEmpty,
        isEmpty,
      ];
    case DocumentPropertyType.MultiSelect:
      return [
        { key: DocumentPropertyFilterOperator.IncludesAny, label: t("Includes any of") },
        { key: DocumentPropertyFilterOperator.IncludesAll, label: t("Includes all of") },
        { key: DocumentPropertyFilterOperator.Excludes, label: t("Excludes") },
        isNotEmpty,
        isEmpty,
      ];
    default:
      return [
        { key: DocumentPropertyFilterOperator.Contains, label: t("Contains") },
        { key: DocumentPropertyFilterOperator.Equals, label: t("Equals") },
        isNotEmpty,
        isEmpty,
      ];
  }
}

export const PropertyFilter = observer(function PropertyFilter({
  index,
  propertyName,
  propertyType,
  operator,
  value,
  onChange,
  onRemove,
  showRemove,
}: Props) {
  const { t } = useTranslation();
  const { propertyDefinitions } = useStores();

  const propertyOptions = useMemo(() => {
    const entries = new Map<string, PropertyOption>();

    for (const definition of propertyDefinitions.orderedData) {
      if (definition.deletedAt) {
        continue;
      }

      const normalizedName = definition.name.trim();
      if (!normalizedName) {
        continue;
      }

      const key = `${definition.type}:${normalizedName.toLowerCase()}`;
      if (!entries.has(key)) {
        entries.set(key, {
          key,
          label: normalizedName,
          propertyName: normalizedName,
          propertyType: definition.type,
        });
      }
    }

    return Array.from(entries.values()).sort((a, b) =>
      a.label.localeCompare(b.label)
    );
  }, [propertyDefinitions.orderedData]);

  const propertyOptionsWithEmpty = useMemo(
    () => [
      {
        key: "",
        label: t("Any property"),
      },
      ...propertyOptions.map((option) => ({
        key: option.key,
        label: option.label,
      })),
    ],
    [propertyOptions, t]
  );

  const operatorOptions = useMemo(
    () => getOperatorsForType(propertyType, t),
    [propertyType, t]
  );

  const selectedPropertyKey = useMemo(() => {
    if (!propertyName || !propertyType) {
      return "";
    }

    return `${propertyType}:${propertyName.toLowerCase()}`;
  }, [propertyName, propertyType]);

  const requiresValue = !noValueOperators.has(operator);

  const selectOptions = useMemo(() => {
    if (
      !propertyName ||
      !propertyType ||
      (propertyType !== DocumentPropertyType.Select &&
        propertyType !== DocumentPropertyType.MultiSelect)
    ) {
      return [];
    }

    const optionsMap = new Map<string, PropertyDefinitionOption>();
    const normalizedName = propertyName.trim().toLowerCase();

    for (const definition of propertyDefinitions.orderedData) {
      if (definition.deletedAt) {
        continue;
      }

      if (
        definition.name.trim().toLowerCase() !== normalizedName ||
        definition.type !== propertyType
      ) {
        continue;
      }

      for (const opt of definition.options ?? []) {
        if (!optionsMap.has(opt.value)) {
          optionsMap.set(opt.value, opt);
        }
      }
    }

    return Array.from(optionsMap.values());
  }, [propertyName, propertyType, propertyDefinitions.orderedData]);

  const selectFilterOptions = useMemo(
    () =>
      selectOptions.map((opt) => ({
        key: opt.value,
        label: opt.label,
      })),
    [selectOptions]
  );

  const handlePropertySelect = useCallback(
    (selectedKey: string) => {
      if (!selectedKey) {
        onChange(index, {
          propertyName: undefined,
          propertyType: undefined,
          value: undefined,
          operator: DocumentPropertyFilterOperator.Contains,
        });
        return;
      }

      const selected = propertyOptions.find(
        (option) => option.key === selectedKey
      );
      if (!selected) {
        return;
      }

      const operators = getOperatorsForType(selected.propertyType, t);
      const firstOperator = operators[0]?.key as
        | DocumentPropertyFilterOperator
        | undefined;

      onChange(index, {
        propertyName: selected.propertyName,
        propertyType: selected.propertyType,
        operator: firstOperator,
        value: undefined,
      });
    },
    [onChange, index, propertyOptions, t]
  );

  const handleOperatorSelect = useCallback(
    (nextOperator: string) => {
      if (!isPropertyOperator(nextOperator)) {
        return;
      }

      onChange(index, {
        operator: nextOperator,
        value: noValueOperators.has(nextOperator) ? undefined : value,
      });
    },
    [onChange, index, value]
  );

  const handleSelectOptionSelect = useCallback(
    (optionValue: string) => {
      if (propertyType === DocumentPropertyType.MultiSelect) {
        const current = value ? value.split(",").filter(Boolean) : [];
        const idx = current.indexOf(optionValue);

        if (idx >= 0) {
          current.splice(idx, 1);
        } else {
          current.push(optionValue);
        }

        onChange(index, { value: current.join(",") });
      } else {
        onChange(index, { value: optionValue });
      }
    },
    [onChange, index, propertyType, value]
  );

  const handleValueChange = useCallback(
    (val: string) => {
      onChange(index, { value: val });
    },
    [onChange, index]
  );

  const handleRemove = useCallback(() => {
    onRemove?.(index);
  }, [onRemove, index]);

  const renderValueInput = () => {
    if (!requiresValue) {
      return null;
    }

    const isBetween = operator === DocumentPropertyFilterOperator.Between;

    if (
      propertyType === DocumentPropertyType.Select ||
      propertyType === DocumentPropertyType.MultiSelect
    ) {
      const selectedKeys =
        propertyType === DocumentPropertyType.MultiSelect && value
          ? value.split(",").filter(Boolean)
          : value
            ? [value]
            : [];

      return (
        <FilterOptions
          options={selectFilterOptions}
          selectedKeys={selectedKeys}
          defaultLabel={t("Value")}
          showFilter
          onSelect={handleSelectOptionSelect}
        />
      );
    }

    if (isBetween) {
      const parts = value ? value.split(",") : ["", ""];
      const inputType =
        propertyType === DocumentPropertyType.Date ? "date" : "number";

      return (
        <BetweenContainer>
          <ValueInput
            label={t("Min")}
            labelHidden
            placeholder={propertyType === DocumentPropertyType.Date ? "" : t("Min")}
            type={inputType}
            value={parts[0] ?? ""}
            onChange={(ev) =>
              handleValueChange(`${ev.target.value},${parts[1] ?? ""}`)
            }
            margin={0}
          />
          <BetweenSeparator>{t("and")}</BetweenSeparator>
          <ValueInput
            label={t("Max")}
            labelHidden
            placeholder={propertyType === DocumentPropertyType.Date ? "" : t("Max")}
            type={inputType}
            value={parts[1] ?? ""}
            onChange={(ev) =>
              handleValueChange(`${parts[0] ?? ""},${ev.target.value}`)
            }
            margin={0}
          />
        </BetweenContainer>
      );
    }

    if (propertyType === DocumentPropertyType.Number) {
      return (
        <ValueInput
          label={t("Value")}
          labelHidden
          placeholder={t("Value")}
          type="number"
          value={value ?? ""}
          onChange={(ev) => handleValueChange(ev.target.value)}
          margin={0}
        />
      );
    }

    if (propertyType === DocumentPropertyType.Date) {
      return (
        <ValueInput
          label={t("Value")}
          labelHidden
          type="date"
          value={value ?? ""}
          onChange={(ev) => handleValueChange(ev.target.value)}
          margin={0}
        />
      );
    }

    return (
      <ValueInput
        label={t("Value")}
        labelHidden
        placeholder={t("Value")}
        value={value ?? ""}
        onChange={(ev) => handleValueChange(ev.target.value)}
        margin={0}
      />
    );
  };

  return (
    <PropertyFilterRow>
      <FilterOptions
        options={propertyOptionsWithEmpty}
        selectedKeys={[selectedPropertyKey]}
        defaultLabel={t("Property")}
        showFilter
        onSelect={handlePropertySelect}
      />
      {propertyName && (
        <>
          <FilterOptions
            options={operatorOptions}
            selectedKeys={[operator]}
            defaultLabel={operatorOptions[0]?.label ?? t("Contains")}
            onSelect={handleOperatorSelect}
          />
          {renderValueInput()}
        </>
      )}
      {showRemove && (
        <Tooltip content={t("Remove filter")}>
          <RemoveButton onClick={handleRemove} size={20}>
            <CloseIcon size={16} />
          </RemoveButton>
        </Tooltip>
      )}
    </PropertyFilterRow>
  );
});

const PropertyFilterRow = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
`;

const RemoveButton = styled(NudeButton)`
  color: ${(props) => props.theme.textTertiary};

  &:hover {
    color: ${(props) => props.theme.text};
  }
`;

const ValueInput = styled(Input)`
  max-width: 220px;

  input {
    height: 32px;
  }
`;

const BetweenContainer = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
`;

const BetweenSeparator = styled.span`
  font-size: 14px;
  color: ${(props) => props.theme.textTertiary};
  white-space: nowrap;
`;
