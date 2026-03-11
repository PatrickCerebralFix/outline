import { CloseIcon } from "outline-icons";
import { observer } from "mobx-react";
import { useCallback, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import styled from "styled-components";
import { Avatar, AvatarSize } from "~/components/Avatar";
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
export type PropertyFilterValue = string | string[] | [string, string];

export interface PropertyFilterState {
  propertyDefinitionId?: string;
  operator: DocumentPropertyFilterOperator;
  value?: PropertyFilterValue;
}

type Props = {
  /** Position of this filter in the list. */
  index: number;
  propertyDefinitionId?: string;
  operator: DocumentPropertyFilterOperator;
  value?: PropertyFilterValue;
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
  propertyDefinitionId: string;
  propertyType: DocumentPropertyType;
};

type OperatorOption = {
  key: string;
  label: string;
};

export const noValueOperators = new Set([
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

function getBetweenValue(
  value: PropertyFilterValue | undefined
): [string, string] {
  if (Array.isArray(value)) {
    return [value[0] ?? "", value[1] ?? ""];
  }

  return ["", ""];
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
  const isEmpty = {
    key: DocumentPropertyFilterOperator.IsEmpty,
    label: t("Is empty"),
  };
  const isNotEmpty = {
    key: DocumentPropertyFilterOperator.IsNotEmpty,
    label: t("Is not empty"),
  };

  switch (type) {
    case DocumentPropertyType.Number:
      return [
        { key: DocumentPropertyFilterOperator.Equals, label: t("Equals") },
        {
          key: DocumentPropertyFilterOperator.GreaterThan,
          label: t("Greater than"),
        },
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
    case DocumentPropertyType.User:
      return [
        {
          key: DocumentPropertyFilterOperator.IncludesAny,
          label: t("Includes any of"),
        },
        {
          key: DocumentPropertyFilterOperator.IncludesAll,
          label: t("Includes all of"),
        },
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
  propertyDefinitionId,
  operator,
  value,
  onChange,
  onRemove,
  showRemove,
}: Props) {
  const { t } = useTranslation();
  const { propertyDefinitions, users } = useStores();

  const propertyOptions = useMemo(() => {
    const duplicateNames = new Map<string, number>();
    for (const definition of propertyDefinitions.orderedData) {
      if (definition.deletedAt) {
        continue;
      }

      const normalizedName = definition.name.trim();
      if (!normalizedName) {
        continue;
      }
      const duplicateKey = `${normalizedName.toLowerCase()}:${definition.type}`;
      duplicateNames.set(duplicateKey, (duplicateNames.get(duplicateKey) ?? 0) + 1);
    }

    return propertyDefinitions.orderedData
      .filter((definition) => !definition.deletedAt && definition.name.trim())
      .map((definition) => {
        const normalizedName = definition.name.trim();
        const duplicateKey = `${normalizedName.toLowerCase()}:${definition.type}`;
        const isDuplicate = (duplicateNames.get(duplicateKey) ?? 0) > 1;

        return {
          key: definition.id,
          label: isDuplicate
            ? `${normalizedName} · ${definition.type}`
            : normalizedName,
          propertyDefinitionId: definition.id,
          propertyType: definition.type,
        };
      })
      .sort((a, b) =>
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
    () =>
      getOperatorsForType(
        propertyOptions.find((option) => option.key === propertyDefinitionId)
          ?.propertyType,
        t
      ),
    [propertyDefinitionId, propertyOptions, t]
  );

  const selectedPropertyKey = propertyDefinitionId ?? "";

  const selectedPropertyType = useMemo(
    () =>
      propertyOptions.find((option) => option.key === propertyDefinitionId)
        ?.propertyType,
    [propertyDefinitionId, propertyOptions]
  );

  const requiresValue = !noValueOperators.has(operator);

  useEffect(() => {
    if (selectedPropertyType !== DocumentPropertyType.User || !Array.isArray(value)) {
      return;
    }

    const missingUserIds = value.filter((userId) => !users.get(userId));

    if (missingUserIds.length === 0) {
      return;
    }

    void users.fetchPage({
      ids: missingUserIds,
      limit: missingUserIds.length,
      sort: "name",
      direction: "ASC",
    });
  }, [selectedPropertyType, users, value]);

  const selectOptions = useMemo(() => {
    if (
      !propertyDefinitionId ||
      !selectedPropertyType ||
      (selectedPropertyType !== DocumentPropertyType.Select &&
        selectedPropertyType !== DocumentPropertyType.MultiSelect)
    ) {
      return [];
    }

    const definition = propertyDefinitions.get(propertyDefinitionId);

    return [...(definition?.options ?? [])];
  }, [
    propertyDefinitionId,
    propertyDefinitions,
    selectedPropertyType,
  ]);

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
          propertyDefinitionId: undefined,
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
        propertyDefinitionId: selected.propertyDefinitionId,
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
      if (
        selectedPropertyType === DocumentPropertyType.MultiSelect ||
        selectedPropertyType === DocumentPropertyType.User
      ) {
        const current = Array.isArray(value) ? [...value] : [];
        const idx = current.indexOf(optionValue);

        if (idx >= 0) {
          current.splice(idx, 1);
        } else {
          current.push(optionValue);
        }

        onChange(index, { value: current });
      } else {
        onChange(index, { value: optionValue });
      }
    },
    [onChange, index, selectedPropertyType, value]
  );

  const userFilterOptions = useMemo(
    () =>
      users.all.map((user) => ({
        key: user.id,
        label: user.name,
        icon: <StyledAvatar model={user} size={AvatarSize.Small} />,
      })),
    [users.all]
  );

  const handleValueChange = useCallback(
    (val: PropertyFilterValue | undefined) => {
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
      selectedPropertyType === DocumentPropertyType.Select ||
      selectedPropertyType === DocumentPropertyType.MultiSelect
    ) {
      const selectedKeys =
        selectedPropertyType === DocumentPropertyType.MultiSelect &&
        Array.isArray(value)
          ? value
          : typeof value === "string"
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

    if (selectedPropertyType === DocumentPropertyType.User) {
      const selectedKeys = Array.isArray(value)
        ? value.filter((entry): entry is string => typeof entry === "string")
        : [];

      return (
        <FilterOptions
          options={userFilterOptions}
          selectedKeys={selectedKeys}
          defaultLabel={t("People")}
          showFilter
          onSelect={handleSelectOptionSelect}
          fetchQuery={users.fetchPage}
          fetchQueryOptions={{ sort: "name", direction: "ASC" }}
        />
      );
    }

    if (isBetween) {
      const parts = getBetweenValue(value);
      const inputType =
        selectedPropertyType === DocumentPropertyType.Date ? "date" : "number";

      return (
        <BetweenContainer>
          <ValueInput
            label={t("Min")}
            labelHidden
            placeholder={
              selectedPropertyType === DocumentPropertyType.Date ? "" : t("Min")
            }
            type={inputType}
            value={parts[0] ?? ""}
            onChange={(ev) =>
              handleValueChange([ev.target.value, parts[1] ?? ""])
            }
            margin={0}
          />
          <BetweenSeparator>{t("and")}</BetweenSeparator>
          <ValueInput
            label={t("Max")}
            labelHidden
            placeholder={
              selectedPropertyType === DocumentPropertyType.Date ? "" : t("Max")
            }
            type={inputType}
            value={parts[1] ?? ""}
            onChange={(ev) =>
              handleValueChange([parts[0] ?? "", ev.target.value])
            }
            margin={0}
          />
        </BetweenContainer>
      );
    }

    if (selectedPropertyType === DocumentPropertyType.Number) {
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

    if (selectedPropertyType === DocumentPropertyType.Date) {
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
      {propertyDefinitionId && (
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

const StyledAvatar = styled(Avatar)`
  margin: 2px;
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
