import debounce from "lodash/debounce";
import { toJS } from "mobx";
import { observer } from "mobx-react";
import { transparentize } from "polished";
import { CloseIcon, PlusIcon } from "outline-icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import styled, { useTheme } from "styled-components";
import type { DocumentPropertyValues } from "@shared/types";
import { DocumentPropertyType } from "@shared/types";
import Button from "~/components/Button";
import Flex from "~/components/Flex";
import Input from "~/components/Input";
import type { Option } from "~/components/InputSelect";
import { InputSelect } from "~/components/InputSelect";
import NudeButton from "~/components/NudeButton";
import { PropertyPicker } from "~/components/PropertyPicker";
import Text from "~/components/Text";
import { UserValuesInput } from "~/components/UserValuesInput";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/primitives/Popover";
import useStores from "~/hooks/useStores";
import type Document from "~/models/Document";
import { client } from "~/utils/ApiClient";

type Props = {
  document: Document;
  readOnly?: boolean;
};

interface PropertyDefinitionOption {
  id?: string;
  label: string;
  value: string;
  color?: string | null;
  index?: string | null;
}

interface PropertyDefinitionData {
  id: string;
  name: string;
  description?: string | null;
  type: DocumentPropertyType;
  options?: PropertyDefinitionOption[];
}

interface CollectionPropertyDefinition {
  id: string;
  propertyDefinitionId: string;
  state: "attached" | "excluded";
  required: boolean;
  index: string | null;
  definition: PropertyDefinitionData;
}

function isEmptyPropertyValue(value: DocumentPropertyValues[string]) {
  return (
    value === null ||
    value === undefined ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  );
}

function emptyPropertyValueForDefinition(
  definition: CollectionPropertyDefinition
): DocumentPropertyValues[string] {
  switch (definition.definition.type) {
    case DocumentPropertyType.MultiSelect:
    case DocumentPropertyType.User:
      return [];
    case DocumentPropertyType.Text:
    case DocumentPropertyType.Number:
    case DocumentPropertyType.Date:
    case DocumentPropertyType.Select:
      return "";
    default:
      return "";
  }
}

function sortDefinitions(definitions: CollectionPropertyDefinition[]) {
  return [...definitions].sort((a, b) => {
    const indexCompare = `${a.index ?? ""}`.localeCompare(`${b.index ?? ""}`);
    if (indexCompare !== 0) {
      return indexCompare;
    }

    return a.definition.name.localeCompare(b.definition.name);
  });
}

export const DocumentProperties = observer(function DocumentProperties({
  document,
  readOnly,
}: Props) {
  const { t } = useTranslation();
  const { documents } = useStores();
  const collectionId = document.collectionId;
  const [isLoading, setIsLoading] = useState(!!collectionId);
  const [definitions, setDefinitions] = useState<
    CollectionPropertyDefinition[]
  >([]);
  const [addPickerOpen, setAddPickerOpen] = useState(false);
  const lastConfirmedValuesRef = useRef<DocumentPropertyValues>({});
  const savePropertyRef = useRef<Map<string, ReturnType<typeof debounce>>>(
    new Map()
  );
  const propertyVersionRef = useRef<Map<string, number>>(new Map());

  const values = toJS(document.properties ?? {}) as DocumentPropertyValues;

  useEffect(() => {
    lastConfirmedValuesRef.current = values;
    propertyVersionRef.current.clear();
  }, [document.id]);

  useEffect(() => {
    if (!collectionId) {
      setDefinitions([]);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);

    const load = async () => {
      try {
        const res = await client.post<{
          data: { effective: CollectionPropertyDefinition[] };
        }>("/collectionPropertyDefinitions.list", {
          collectionId,
          includeAvailable: false,
          includeHidden: false,
          includeLocal: false,
        });
        const effective = (res.data?.effective ?? [])
          .filter((row) => row.state === "attached")
          .map((row) => ({
            ...row,
            propertyDefinitionId: row.propertyDefinitionId ?? row.definition.id,
          }));

        if (!cancelled) {
          setDefinitions(sortDefinitions(effective));
        }
      } catch (err) {
        if (!cancelled) {
          toast.error((err as Error).message);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [collectionId, document.id]);

  const addedDefinitionIds = useMemo(() => {
    const ids = new Set(Object.keys(values));

    for (const definition of definitions) {
      if (definition.required) {
        ids.add(definition.propertyDefinitionId);
      }
    }

    return ids;
  }, [definitions, values]);

  const assignedDefinitions = useMemo(
    () =>
      definitions.filter((definition) =>
        addedDefinitionIds.has(definition.propertyDefinitionId)
      ),
    [addedDefinitionIds, definitions]
  );

  const unassignedDefinitions = useMemo(
    () =>
      definitions.filter(
        (definition) =>
          !addedDefinitionIds.has(definition.propertyDefinitionId) &&
          !definition.required
      ),
    [addedDefinitionIds, definitions]
  );

  const applyLocalPropertyValue = useCallback(
    (
      propertyDefinitionId: string,
      value: DocumentPropertyValues[string],
      options?: {
        removeIfEmpty?: boolean;
      }
    ) => {
      const nextValues = {
        ...toJS(document.properties ?? {}),
      } as DocumentPropertyValues;

      if (options?.removeIfEmpty && isEmptyPropertyValue(value)) {
        delete nextValues[propertyDefinitionId];
      } else {
        nextValues[propertyDefinitionId] = value;
      }

      document.properties = nextValues;
    },
    [document]
  );

  const rollbackPropertyValue = useCallback(
    (propertyDefinitionId: string) => {
      const confirmedValue =
        lastConfirmedValuesRef.current[propertyDefinitionId];
      applyLocalPropertyValue(propertyDefinitionId, confirmedValue, {
        removeIfEmpty: confirmedValue === undefined || confirmedValue === null,
      });
    },
    [applyLocalPropertyValue]
  );

  const persistPropertyValue = useCallback(
    async (
      propertyDefinitionId: string,
      value: DocumentPropertyValues[string],
      options?: {
        removeIfEmpty?: boolean;
      },
      version?: number
    ) => {
      try {
        const model = await documents.updateProperties({
          id: document.id,
          properties: {
            [propertyDefinitionId]:
              options?.removeIfEmpty && isEmptyPropertyValue(value)
                ? null
                : value,
          },
        });

        if (propertyVersionRef.current.get(propertyDefinitionId) !== version) {
          return;
        }

        lastConfirmedValuesRef.current = toJS(
          model?.properties ?? document.properties ?? {}
        ) as DocumentPropertyValues;
      } catch (err) {
        if (propertyVersionRef.current.get(propertyDefinitionId) !== version) {
          return;
        }

        rollbackPropertyValue(propertyDefinitionId);
        toast.error((err as Error).message);
      }
    },
    [document.id, documents, rollbackPropertyValue]
  );

  const getDebouncedPropertySaver = useCallback(
    (propertyDefinitionId: string) => {
      const existing = savePropertyRef.current.get(propertyDefinitionId);
      if (existing) {
        return existing;
      }

      const debouncedSave = debounce(
        (
          value: DocumentPropertyValues[string],
          version: number,
          options?: {
            removeIfEmpty?: boolean;
          }
        ) => {
          void persistPropertyValue(
            propertyDefinitionId,
            value,
            options,
            version
          );
        },
        400
      );

      savePropertyRef.current.set(propertyDefinitionId, debouncedSave);
      return debouncedSave;
    },
    [persistPropertyValue]
  );

  const flushPendingSaves = useCallback(() => {
    savePropertyRef.current.forEach((saveProperty) => saveProperty.flush());
    savePropertyRef.current.clear();
  }, []);

  useEffect(
    () => () => {
      flushPendingSaves();
    },
    [document.id, flushPendingSaves]
  );

  const updateValue = useCallback(
    (
      propertyDefinitionId: string,
      value: DocumentPropertyValues[string],
      options?: {
        removeIfEmpty?: boolean;
        immediate?: boolean;
      }
    ) => {
      if (readOnly) {
        return;
      }

      applyLocalPropertyValue(propertyDefinitionId, value, options);
      const nextVersion =
        (propertyVersionRef.current.get(propertyDefinitionId) ?? 0) + 1;
      propertyVersionRef.current.set(propertyDefinitionId, nextVersion);

      const debouncedSave = getDebouncedPropertySaver(propertyDefinitionId);
      if (options?.immediate) {
        debouncedSave.cancel();
        void persistPropertyValue(
          propertyDefinitionId,
          value,
          options,
          nextVersion
        );
        return;
      }

      debouncedSave(value, nextVersion, options);
    },
    [
      applyLocalPropertyValue,
      getDebouncedPropertySaver,
      persistPropertyValue,
      readOnly,
    ]
  );

  const handleAddProperty = useCallback(
    (propertyDefinitionId: string) => {
      const definition = definitions.find(
        (item) => item.propertyDefinitionId === propertyDefinitionId
      );
      if (!definition) {
        return;
      }

      updateValue(
        propertyDefinitionId,
        emptyPropertyValueForDefinition(definition),
        {
          immediate: true,
        }
      );
      setAddPickerOpen(false);
    },
    [definitions, updateValue]
  );

  const handleRemoveProperty = useCallback(
    (propertyDefinitionId: string) => {
      updateValue(propertyDefinitionId, null, {
        immediate: true,
        removeIfEmpty: true,
      });
    },
    [updateValue]
  );

  if (!collectionId) {
    return null;
  }

  if (readOnly && !isLoading && assignedDefinitions.length === 0) {
    return null;
  }

  return (
    <Wrapper>
      <HeaderRow>
        <Heading type="secondary" weight="bold">
          {t("Properties")}
        </Heading>
        {!readOnly && (
        <PropertyPicker
            open={addPickerOpen}
            onOpenChange={setAddPickerOpen}
            title={t("Add property")}
            searchPlaceholder={t("Search collection properties")}
            emptyMessage={t("No other properties available.")}
            emptySectionTitle={t("Available properties")}
            items={unassignedDefinitions.map((definition) => ({
              id: definition.propertyDefinitionId,
              name: definition.definition.name,
              type: definition.definition.type,
            }))}
            showItemsOnEmpty
            onSelect={(item) => handleAddProperty(item.id)}
            trigger={
              <Button type="button" neutral>
                {t("Add property")}
              </Button>
            }
          />
        )}
      </HeaderRow>
      {isLoading && definitions.length === 0 ? (
        <Text type="secondary">{t("Loading")}…</Text>
      ) : assignedDefinitions.length === 0 && !readOnly ? (
        <Text type="secondary">
          {t("No properties added to this document yet.")}
        </Text>
      ) : (
        <PropertyRows>
          {assignedDefinitions.map((definition) => (
            <PropertyRow
              key={definition.propertyDefinitionId}
              definition={definition}
              value={values[definition.propertyDefinitionId]}
              readOnly={readOnly}
              onChange={(value, options) =>
                updateValue(definition.propertyDefinitionId, value, options)
              }
              onRemove={() =>
                handleRemoveProperty(definition.propertyDefinitionId)
              }
            />
          ))}
        </PropertyRows>
      )}
    </Wrapper>
  );
});

type PropertyRowProps = {
  definition: CollectionPropertyDefinition;
  value: DocumentPropertyValues[string];
  readOnly?: boolean;
  onChange: (
    value: DocumentPropertyValues[string],
    options?: {
      immediate?: boolean;
    }
  ) => void;
  onRemove: () => void;
};

const PropertyRow = observer(function PropertyRow({
  definition,
  value,
  readOnly,
  onChange,
  onRemove,
}: PropertyRowProps) {
  const { t } = useTranslation();
  const label = definition.required
    ? `${definition.definition.name} *`
    : definition.definition.name;

  const renderValue = () => {
    if (definition.definition.type === DocumentPropertyType.Text) {
      return (
        <Input
          label={label}
          labelHidden
          placeholder={label}
          value={typeof value === "string" ? value : ""}
          onChange={(ev) => onChange(ev.target.value)}
          readOnly={readOnly}
          margin={0}
          flex
        />
      );
    }

    if (definition.definition.type === DocumentPropertyType.Number) {
      return (
        <Input
          label={label}
          labelHidden
          placeholder={label}
          type="text"
          inputMode="decimal"
          value={typeof value === "number" ? `${value}` : ""}
          onChange={(ev) => {
            const nextValue = ev.target.value.trim();
            if (!nextValue) {
              onChange("");
              return;
            }

            const parsed = Number(nextValue);
            if (Number.isFinite(parsed)) {
              onChange(parsed);
            }
          }}
          readOnly={readOnly}
          margin={0}
          flex
        />
      );
    }

    if (definition.definition.type === DocumentPropertyType.Date) {
      const selectedDate = typeof value === "string" ? value.slice(0, 10) : "";

      return (
        <Input
          label={label}
          labelHidden
          type="date"
          value={selectedDate}
          onChange={(ev) => onChange(ev.target.value)}
          readOnly={readOnly}
          margin={0}
          flex
        />
      );
    }

    if (definition.definition.type === DocumentPropertyType.Select) {
      const noneValue = "__none__";
      const selectOptions: Option[] = [
        {
          type: "item",
          label: t("None"),
          value: noneValue,
        },
        ...(definition.definition.options ?? [])
          .filter((option) => !!option.id)
          .map((option) => ({
            type: "item" as const,
            label: option.label || option.value,
            value: option.id!,
          })),
      ];

      return (
        <InputSelect
          label={label}
          hideLabel
          options={selectOptions}
          value={typeof value === "string" && value ? value : noneValue}
          disabled={readOnly}
          onChange={(nextValue) =>
            onChange(nextValue === noneValue ? "" : nextValue, {
              immediate: true,
            })
          }
        />
      );
    }

    if (definition.definition.type === DocumentPropertyType.MultiSelect) {
      const selected = Array.isArray(value)
        ? value.filter((item): item is string => typeof item === "string")
        : [];

      return (
        <MultiSelectPills
          definition={definition}
          selected={selected}
          readOnly={readOnly}
          onChange={onChange}
        />
      );
    }

    if (definition.definition.type === DocumentPropertyType.User) {
      const selected = Array.isArray(value)
        ? value.filter((item): item is string => typeof item === "string")
        : [];

      return (
        <UserValuesInput
          selectedIds={selected}
          readOnly={readOnly}
          placeholder={t("Select users")}
          onChange={(nextValue) =>
            onChange(nextValue, {
              immediate: true,
            })
          }
        />
      );
    }

    return null;
  };

  return (
    <PropertyRowContainer>
      <PropertyLabel title={label}>{label}</PropertyLabel>
      <PropertyValueWrapper>{renderValue()}</PropertyValueWrapper>
      {!readOnly && !definition.required && (
        <RemovePropertyButton
          onClick={onRemove}
          size={20}
          aria-label={t("Remove property")}
        >
          <CloseIcon size={14} />
        </RemovePropertyButton>
      )}
    </PropertyRowContainer>
  );
});

type MultiSelectPillsProps = {
  definition: CollectionPropertyDefinition;
  selected: string[];
  readOnly?: boolean;
  onChange: (
    value: DocumentPropertyValues[string],
    options?: {
      immediate?: boolean;
    }
  ) => void;
};

const MultiSelectPills = observer(function MultiSelectPills({
  definition,
  selected,
  readOnly,
  onChange,
}: MultiSelectPillsProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const options = definition.definition.options ?? [];
  const unselectedOptions = options.filter(
    (option) => option.id && !selected.includes(option.id)
  );

  const handleToggle = useCallback(
    (optionId: string) => {
      if (selected.includes(optionId)) {
        onChange(
          selected.filter((currentId) => currentId !== optionId),
          {
            immediate: true,
          }
        );
        return;
      }

      onChange([...selected, optionId], { immediate: true });
    },
    [onChange, selected]
  );

  return (
    <PillsRow>
      {selected.length === 0 &&
        (readOnly ? (
          <EmptyValue>—</EmptyValue>
        ) : (
          <PlaceholderText>{t("Select options")}</PlaceholderText>
        ))}
      {selected.map((optionId) => {
        const option = options.find(
          (currentOption) => currentOption.id === optionId
        );
        if (!option) {
          return null;
        }

        return (
          <Pill key={optionId} $color={option.color ?? theme.accent}>
            <span>{option.label || option.value}</span>
            {!readOnly && (
              <PillRemove
                onClick={() => handleToggle(optionId)}
                size={16}
                aria-label={t("Remove")}
              >
                <CloseIcon size={12} />
              </PillRemove>
            )}
          </Pill>
        );
      })}
      {!readOnly && (
        <Popover open={dropdownOpen} onOpenChange={setDropdownOpen}>
          <PopoverTrigger>
            <AddPillButton size={22} aria-label={t("Add value")}>
              <PlusIcon size={14} />
            </AddPillButton>
          </PopoverTrigger>
          <PopoverContent width={220} shrink>
            {unselectedOptions.length === 0 ? (
              <PickerEmpty>
                <Text type="secondary" size="small">
                  {t("All options selected")}
                </Text>
              </PickerEmpty>
            ) : (
              unselectedOptions.map((option) => (
                <PickerItem
                  key={option.id}
                  onClick={() => {
                    if (option.id) {
                      handleToggle(option.id);
                    }
                  }}
                >
                  <span>{option.label || option.value}</span>
                </PickerItem>
              ))
            )}
          </PopoverContent>
        </Popover>
      )}
    </PillsRow>
  );
});

const Wrapper = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const HeaderRow = styled(Flex)`
  justify-content: space-between;
  align-items: center;
`;

const Heading = styled(Text)`
  margin-bottom: 0;
`;

const PropertyRows = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const PropertyRowContainer = styled.div`
  display: grid;
  grid-template-columns: 180px 1fr auto;
  gap: 8px;
  align-items: center;
`;

const PropertyLabel = styled.div`
  font-size: 14px;
  color: ${(props) => props.theme.textSecondary};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const PropertyValueWrapper = styled.div`
  min-width: 0;
`;

const RemovePropertyButton = styled(NudeButton)`
  color: ${(props) => props.theme.textSecondary};
`;

const PillsRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
`;

const Pill = styled.div<{ $color: string }>`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border-radius: 999px;
  padding: 3px 8px;
  background: ${(props) => transparentize(0.84, props.$color)};
  color: ${(props) => props.$color};
  font-size: 13px;
`;

const PillRemove = styled(NudeButton)`
  color: inherit;
`;

const AddPillButton = styled(NudeButton)`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 999px;
  color: ${(props) => props.theme.textSecondary};
  border: 1px dashed ${(props) => props.theme.divider};
`;

const PlaceholderText = styled(Text)`
  margin-bottom: 0;
`;

const EmptyValue = styled.span`
  color: ${(props) => props.theme.textTertiary};
`;

const PickerEmpty = styled.div`
  padding: 8px 4px;
`;

const PickerItem = styled.button`
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px;
  border: 0;
  background: transparent;
  border-radius: 6px;
  cursor: pointer;

  &:hover {
    background: ${(props) => props.theme.sidebarControlHoverBackground};
  }
`;
