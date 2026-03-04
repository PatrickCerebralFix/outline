import debounce from "lodash/debounce";
import { toJS } from "mobx";
import { observer } from "mobx-react";
import { transparentize } from "polished";
import { CloseIcon, PlusIcon } from "outline-icons";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
import Text from "~/components/Text";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "~/components/primitives/Popover";
import useStores from "~/hooks/useStores";
import type Document from "~/models/Document";
import type { PropertyDefinitionOption } from "~/models/PropertyDefinition";
import { client } from "~/utils/ApiClient";

type Props = {
  document: Document;
  readOnly?: boolean;
};

interface LegacyDocumentPropertySnapshot {
  definitionId?: string;
  value?: DocumentPropertyValues[string];
}

function isDocumentPropertyType(value: string): value is DocumentPropertyType {
  return Object.values(DocumentPropertyType).some((type) => type === value);
}

/**
 * Normalize a property payload into its primitive value.
 *
 * Supports both current payload shape (`{ [id]: value }`) and legacy shape
 * (`{ [id]: { value, ...metadata } }`).
 */
function toPropertyValue(
  value: DocumentPropertyValues[string] | LegacyDocumentPropertySnapshot
): DocumentPropertyValues[string] {
  if (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    "value" in value
  ) {
    return value.value ?? null;
  }

  return value as DocumentPropertyValues[string];
}

function isEmptyPropertyValue(value: DocumentPropertyValues[string]) {
  return (
    value === null ||
    value === undefined ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  );
}

/** Friendly display labels for property types. */
function typeLabel(type: DocumentPropertyType, t: (s: string) => string) {
  switch (type) {
    case DocumentPropertyType.Text:
      return t("Text");
    case DocumentPropertyType.Number:
      return t("Number");
    case DocumentPropertyType.Date:
      return t("Date");
    case DocumentPropertyType.Select:
      return t("Select");
    case DocumentPropertyType.MultiSelect:
      return t("Multi-select");
    default:
      return type;
  }
}

export const DocumentProperties = observer(function DocumentProperties({
  document,
  readOnly,
}: Props) {
  const { t } = useTranslation();
  const { propertyDefinitions } = useStores();
  const collectionId = document.collectionId;
  const [isLoading, setIsLoading] = useState(!!collectionId);

  // Read values directly from the MobX observable so the component
  // re-renders whenever properties change (API fetch, WebSocket, etc.).
  const rawValues = toJS(document.properties ?? {}) as DocumentPropertyValues;
  const values = Object.fromEntries(
    Object.entries(rawValues).map(([rawKey, rawValue]) => {
      const snapshot =
        rawValue as
          | DocumentPropertyValues[string]
          | LegacyDocumentPropertySnapshot;
      const definitionId =
        typeof snapshot === "object" &&
        snapshot !== null &&
        !Array.isArray(snapshot) &&
        typeof snapshot.definitionId === "string" &&
        snapshot.definitionId.length > 0
          ? snapshot.definitionId
          : rawKey;

      return [definitionId, toPropertyValue(snapshot)];
    })
  ) as DocumentPropertyValues;

  // Tracks definition IDs that the user manually added via the picker
  // but that don't yet have a persisted value on the document.
  const [manuallyAddedIds, setManuallyAddedIds] = useState<Set<string>>(
    () => new Set<string>()
  );

  // The full set of shown definition IDs: those with values + manually added.
  const addedDefinitionIds = useMemo(() => {
    const ids = new Set(Object.keys(values));
    for (const id of manuallyAddedIds) {
      ids.add(id);
    }
    return ids;
  }, [values, manuallyAddedIds]);

  // "Add property" popover state.
  const [addPickerOpen, setAddPickerOpen] = useState(false);

  // Inline create form state (shown inside the picker popover).
  const [creatingInline, setCreatingInline] = useState(false);
  const [inlineName, setInlineName] = useState("");
  const [inlineType, setInlineType] = useState<DocumentPropertyType>(
    DocumentPropertyType.Text
  );
  const [inlineOptions, setInlineOptions] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const hasInitializedVisibleDefinitions = useRef(false);

  // Reset manually-added IDs when navigating to a different document.
  useEffect(() => {
    setManuallyAddedIds(new Set());
    hasInitializedVisibleDefinitions.current = false;
  }, [document.id]);

  useEffect(() => {
    if (!collectionId) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);

    let cancelled = false;
    const load = async () => {
      try {
        await propertyDefinitions.fetchDefinitions(collectionId);
      } catch (err) {
        toast.error(err.message);
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
  }, [collectionId, document.id, propertyDefinitions]);

  const definitions = collectionId
    ? propertyDefinitions
        .forCollection(collectionId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    : [];

  useEffect(() => {
    if (readOnly) {
      return;
    }

    if (hasInitializedVisibleDefinitions.current) {
      return;
    }

    if (isLoading || definitions.length === 0) {
      return;
    }

    hasInitializedVisibleDefinitions.current = true;
    const requiredDefinitionIds = definitions
      .filter((definition) => definition.required)
      .map((definition) => definition.id);
    setManuallyAddedIds(new Set(requiredDefinitionIds));
  }, [definitions, isLoading, readOnly]);

  useEffect(() => {
    const requiredIds = definitions
      .filter((d) => d.required)
      .map((d) => d.id);
    if (requiredIds.length > 0) {
      setManuallyAddedIds((prev) => {
        const next = new Set(prev);
        let changed = false;
        for (const id of requiredIds) {
          if (!next.has(id) && isEmptyPropertyValue(values[id])) {
            next.add(id);
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }
  }, [definitions, values]);

  const assignedDefinitions = definitions.filter((d) =>
    addedDefinitionIds.has(d.id)
  );

  const unassignedDefinitions = definitions.filter(
    (d) => !addedDefinitionIds.has(d.id) && !d.required
  );

  const typeOptions = useMemo<Option[]>(
    () => [
      {
        type: "item",
        label: t("Text"),
        value: DocumentPropertyType.Text,
      },
      {
        type: "item",
        label: t("Number"),
        value: DocumentPropertyType.Number,
      },
      {
        type: "item",
        label: t("Date"),
        value: DocumentPropertyType.Date,
      },
      {
        type: "item",
        label: t("Select"),
        value: DocumentPropertyType.Select,
      },
      {
        type: "item",
        label: t("Multi-select"),
        value: DocumentPropertyType.MultiSelect,
      },
    ],
    [t]
  );

  const saveProperties = useMemo(
    () =>
      debounce(async (nextValues: DocumentPropertyValues) => {
        try {
          await document.save(
            {
              properties: nextValues,
            },
            {
              autosave: true,
            }
          );
        } catch (err) {
          toast.error(err.message);
        }
      }, 400),
    [document]
  );

  useEffect(
    () => () => {
      saveProperties.cancel();
    },
    [saveProperties]
  );

  const updateValue = useCallback(
    (propertyDefinitionId: string, value: DocumentPropertyValues[string]) => {
      if (readOnly) {
        return;
      }

      const nextValues = {
        ...values,
      };

      if (isEmptyPropertyValue(value)) {
        delete nextValues[propertyDefinitionId];
      } else {
        nextValues[propertyDefinitionId] = value;
      }

      document.properties = nextValues;

      saveProperties(nextValues);
    },
    [document, readOnly, saveProperties, values]
  );

  const handleRemoveProperty = useCallback(
    (definitionId: string) => {
      setManuallyAddedIds((prev) => {
        const next = new Set(prev);
        next.delete(definitionId);
        return next;
      });
      updateValue(definitionId, null);
    },
    [updateValue]
  );

  const handleAddDefinition = useCallback((definitionId: string) => {
    setManuallyAddedIds((prev) => new Set(prev).add(definitionId));
    setAddPickerOpen(false);
  }, []);

  const resetInlineForm = useCallback(() => {
    setCreatingInline(false);
    setInlineName("");
    setInlineType(DocumentPropertyType.Text);
    setInlineOptions([]);
  }, []);

  const handleCreateDefinition = useCallback(async () => {
    if (!collectionId || readOnly) {
      return;
    }

    const name = inlineName.trim();
    if (!name) {
      toast.error(t("Property name is required"));
      return;
    }

    setIsSaving(true);
    try {
      const options =
        inlineType === DocumentPropertyType.Select ||
        inlineType === DocumentPropertyType.MultiSelect
          ? inlineOptions
              .map((o) => o.trim())
              .filter(Boolean)
              .map((label) => ({ label, value: label }))
          : [];

      const res = await client.post("/propertyDefinitions.create", {
        collectionId,
        name,
        type: inlineType,
        required: false,
        options,
      });

      await propertyDefinitions.fetchDefinitions(collectionId);

      const newId = res.data?.id as string | undefined;
      if (newId) {
        setManuallyAddedIds((prev) => new Set(prev).add(newId));
      }

      resetInlineForm();
      setAddPickerOpen(false);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setIsSaving(false);
    }
  }, [
    collectionId,
    inlineName,
    inlineOptions,
    inlineType,
    propertyDefinitions,
    readOnly,
    resetInlineForm,
    t,
  ]);

  if (!collectionId) {
    return null;
  }

  const showEmptyReadonlyState =
    definitions.length === 0 && !isLoading && readOnly;

  if (showEmptyReadonlyState) {
    return null;
  }

  // In read-only mode, hide if no properties are assigned.
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
          <Popover
            open={addPickerOpen}
            onOpenChange={(open) => {
              setAddPickerOpen(open);
              if (!open) {
                resetInlineForm();
              }
            }}
          >
            <PopoverTrigger>
              <Button type="button" neutral>
                {t("Add property")}
              </Button>
            </PopoverTrigger>
            <PopoverContent
              width={280}
              shrink
              onInteractOutside={(event) => {
                // Prevent the popover from closing when the user interacts
                // with the InputSelect dropdown, which renders in a portal
                // outside the popover's DOM tree.
                const target = event.target as HTMLElement | null;
                if (
                  target?.closest?.(
                    "[data-radix-select-viewport], [role='listbox'], [role='option']"
                  )
                ) {
                  event.preventDefault();
                }
              }}
            >
              {creatingInline ? (
                <InlineCreateForm
                  as="form"
                  onSubmit={(ev: React.FormEvent) => {
                    ev.preventDefault();
                    void handleCreateDefinition();
                  }}
                  onKeyDown={(ev: React.KeyboardEvent) => {
                    if (ev.key === "Escape") {
                      ev.stopPropagation();
                      resetInlineForm();
                    }
                  }}
                >
                  <Input
                    label={t("Name")}
                    labelHidden
                    placeholder={t("Property name")}
                    value={inlineName}
                    onChange={(ev) => setInlineName(ev.target.value)}
                    margin={0}
                    autoFocus
                    flex
                  />
                  <InputSelect
                    label={t("Type")}
                    hideLabel
                    value={inlineType}
                    options={typeOptions}
                    onChange={(value) => {
                      if (!isDocumentPropertyType(value)) {
                        return;
                      }
                      setInlineType(value);
                    }}
                  />
                  {(inlineType === DocumentPropertyType.Select ||
                    inlineType === DocumentPropertyType.MultiSelect) && (
                    <OptionsSection>
                      {inlineOptions.map((opt, idx) => (
                        <OptionRow key={idx}>
                          <Input
                            label={`Option ${idx + 1}`}
                            labelHidden
                            placeholder={`${t("Option")} ${idx + 1}`}
                            value={opt}
                            onChange={(ev) => {
                              const next = [...inlineOptions];
                              next[idx] = ev.target.value;
                              setInlineOptions(next);
                            }}
                            margin={0}
                            flex
                          />
                          <NudeButton
                            onClick={() =>
                              setInlineOptions((prev) =>
                                prev.filter((_, i) => i !== idx)
                              )
                            }
                            size={20}
                            aria-label={t("Remove option")}
                          >
                            <CloseIcon size={16} />
                          </NudeButton>
                        </OptionRow>
                      ))}
                      <Button
                        type="button"
                        neutral
                        onClick={() =>
                          setInlineOptions((prev) => [...prev, ""])
                        }
                      >
                        {t("Add option")}
                      </Button>
                    </OptionsSection>
                  )}
                  <InlineCreateButtons>
                    <Button
                      type="button"
                      neutral
                      onClick={resetInlineForm}
                    >
                      {t("Back")}
                    </Button>
                    <Button
                      type="submit"
                      disabled={isSaving}
                    >
                      {isSaving ? `${t("Creating")}…` : t("Create")}
                    </Button>
                  </InlineCreateButtons>
                </InlineCreateForm>
              ) : (
                <>
                  {unassignedDefinitions.length === 0 ? (
                    <PickerEmpty>
                      <Text type="secondary" size="small">
                        {t("All properties added")}
                      </Text>
                    </PickerEmpty>
                  ) : (
                    unassignedDefinitions.map((def) => (
                      <PickerItem
                        key={def.id}
                        onClick={() => handleAddDefinition(def.id)}
                      >
                        <span>{def.name}</span>
                        <PickerTypeBadge>{typeLabel(def.type, t)}</PickerTypeBadge>
                      </PickerItem>
                    ))
                  )}
                  <PickerDivider />
                  <PickerItem onClick={() => setCreatingInline(true)}>
                    <PlusIcon size={16} />
                    <span>{t("Create new property")}</span>
                  </PickerItem>
                </>
              )}
            </PopoverContent>
          </Popover>
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
              key={definition.id}
              definition={definition}
              value={values[definition.id]}
              readOnly={readOnly}
              onChange={(value) => updateValue(definition.id, value)}
              onRemove={() => handleRemoveProperty(definition.id)}
              collectionId={collectionId}
            />
          ))}
        </PropertyRows>
      )}
    </Wrapper>
  );
});

// ---------------------------------------------------------------------------
// PropertyRow – renders a single property label + value control
// ---------------------------------------------------------------------------

type PropertyRowProps = {
  definition: {
    id: string;
    name: string;
    type: DocumentPropertyType;
    required: boolean;
    options: PropertyDefinitionOption[];
  };
  value: DocumentPropertyValues[string];
  readOnly?: boolean;
  onChange: (value: DocumentPropertyValues[string]) => void;
  onRemove: () => void;
  collectionId: string;
};

const PropertyRow = observer(function PropertyRow({
  definition,
  value,
  readOnly,
  onChange,
  onRemove,
  collectionId,
}: PropertyRowProps) {
  const { t } = useTranslation();

  const label = definition.required
    ? `${definition.name} *`
    : definition.name;

  const renderValue = () => {
    if (definition.type === DocumentPropertyType.Text) {
      return (
        <Input
          label={label}
          labelHidden
          placeholder={label}
          value={typeof value === "string" ? value : ""}
          onChange={(ev) => onChange(ev.target.value || null)}
          readOnly={readOnly}
          margin={0}
          flex
        />
      );
    }

    if (definition.type === DocumentPropertyType.Number) {
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
              onChange(null);
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

    if (definition.type === DocumentPropertyType.Date) {
      const selectedDate =
        typeof value === "string" ? value.slice(0, 10) : "";

      return (
        <Input
          label={label}
          labelHidden
          type="date"
          value={selectedDate}
          onChange={(ev) => onChange(ev.target.value || null)}
          readOnly={readOnly}
          margin={0}
          flex
        />
      );
    }

    if (definition.type === DocumentPropertyType.Select) {
      const NONE_VALUE = "__none__";
      const selectOptions: Option[] = [
        {
          type: "item",
          label: t("None"),
          value: NONE_VALUE,
        },
        ...(definition.options ?? [])
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
          value={typeof value === "string" && value ? value : NONE_VALUE}
          disabled={readOnly}
          onChange={(nextValue) =>
            onChange(nextValue === NONE_VALUE ? null : nextValue)
          }
        />
      );
    }

    if (definition.type === DocumentPropertyType.MultiSelect) {
      const selected = Array.isArray(value)
        ? value.filter(
            (item): item is string => typeof item === "string"
          )
        : [];

      return (
        <MultiSelectPills
          definition={definition}
          selected={selected}
          readOnly={readOnly}
          onChange={onChange}
          collectionId={collectionId}
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

// ---------------------------------------------------------------------------
// MultiSelectPills – pill display with inline dropdown for multi-select values
// ---------------------------------------------------------------------------

type MultiSelectPillsProps = {
  definition: {
    id: string;
    options: PropertyDefinitionOption[];
  };
  selected: string[];
  readOnly?: boolean;
  onChange: (value: DocumentPropertyValues[string]) => void;
  collectionId: string;
};

const MultiSelectPills = observer(function MultiSelectPills({
  definition,
  selected,
  readOnly,
  onChange,
  collectionId,
}: MultiSelectPillsProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const { propertyDefinitions } = useStores();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [newOptionValue, setNewOptionValue] = useState("");
  const [isAddingOption, setIsAddingOption] = useState(false);
  const newOptionRef = useRef<HTMLInputElement>(null);

  const options = definition.options ?? [];
  const unselectedOptions = options.filter(
    (o) => !selected.includes(o.id ?? "")
  );

  const handleToggle = useCallback(
    (optionId: string) => {
      if (selected.includes(optionId)) {
        const next = selected.filter((id) => id !== optionId);
        onChange(next.length > 0 ? next : null);
      } else {
        onChange([...selected, optionId]);
      }
    },
    [onChange, selected]
  );

  const handleRemovePill = useCallback(
    (optionId: string) => {
      const next = selected.filter((id) => id !== optionId);
      onChange(next.length > 0 ? next : null);
    },
    [onChange, selected]
  );

  const handleAddNewOption = useCallback(async () => {
    if (isAddingOption) {
      return;
    }

    const label = newOptionValue.trim();
    if (!label) {
      return;
    }

    setIsAddingOption(true);
    try {
      const updatedOptions = [
        ...options.map((o) => ({
          id: o.id,
          label: o.label,
          value: o.value,
        })),
        { label, value: label },
      ];

      const res = await client.post("/propertyDefinitions.update", {
        id: definition.id,
        options: updatedOptions,
      });

      await propertyDefinitions.fetchDefinitions(collectionId);

      // Find the newly created option (it will have an id assigned by the server).
      const serverOptions = (res.data?.options ?? []) as PropertyDefinitionOption[];
      const newOpt = serverOptions.find(
        (o) => o.label === label && !selected.includes(o.id ?? "")
      );
      if (newOpt?.id) {
        const nextSelected = [...selected, newOpt.id];
        onChange(nextSelected);

        // Close dropdown if no unselected options remain after this selection.
        const remainingUnselected = serverOptions.filter(
          (o) => o.id && !nextSelected.includes(o.id)
        );
        if (remainingUnselected.length === 0) {
          setDropdownOpen(false);
        }
      }

      setNewOptionValue("");
    } catch (err) {
      toast.error(err.message);
    } finally {
      setIsAddingOption(false);
    }
  }, [
    collectionId,
    definition.id,
    isAddingOption,
    newOptionValue,
    onChange,
    options,
    propertyDefinitions,
    selected,
  ]);

  return (
    <PillsRow>
      {selected.length === 0 &&
        (readOnly ? (
          <EmptyValue>—</EmptyValue>
        ) : (
          <PlaceholderText>{t("Select options")}</PlaceholderText>
        ))}
      {selected.map((optionId) => {
        const opt = options.find((o) => o.id === optionId);
        if (!opt) {
          return null;
        }
        return (
          <Pill
            key={optionId}
            $color={opt.color ?? theme.accent}
          >
            <span>{opt.label || opt.value}</span>
            {!readOnly && (
              <PillRemove
                onClick={() => handleRemovePill(optionId)}
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
        <Popover
          open={dropdownOpen}
          onOpenChange={(open) => {
            setDropdownOpen(open);
            if (!open) {
              setNewOptionValue("");
            }
          }}
        >
          <PopoverTrigger>
            <AddPillButton size={22} aria-label={t("Add value")}>
              <PlusIcon size={14} />
            </AddPillButton>
          </PopoverTrigger>
          <PopoverContent width={220} shrink>
            {unselectedOptions.length > 0 &&
              unselectedOptions.map((opt) => (
                <DropdownItem
                  key={opt.id ?? opt.value}
                  onClick={() => {
                    handleToggle(opt.id ?? "");
                  }}
                >
                  {opt.label || opt.value}
                </DropdownItem>
              ))}
            <NewOptionInput
              ref={newOptionRef}
              type="text"
              placeholder={`${t("Add new option")}…`}
              value={newOptionValue}
              onChange={(ev) => setNewOptionValue(ev.target.value)}
              onKeyDown={(ev) => {
                if (ev.key === "Enter") {
                  ev.preventDefault();
                  void handleAddNewOption();
                }
              }}
              disabled={isAddingOption}
            />
          </PopoverContent>
        </Popover>
      )}
    </PillsRow>
  );
});

// ---------------------------------------------------------------------------
// Styled components
// ---------------------------------------------------------------------------

const Wrapper = styled(Flex)`
  flex-direction: column;
  gap: 12px;
  margin: -8px 0 1.5em;
`;

const Heading = styled(Text)`
  text-transform: uppercase;
  letter-spacing: 0.04em;
  font-size: 12px;
`;

const HeaderRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
`;

const PropertyRows = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const PropertyRowContainer = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 32px;
`;

const PropertyLabel = styled.span`
  width: 140px;
  min-width: 140px;
  font-size: 13px;
  font-weight: 500;
  color: ${(props) => props.theme.textTertiary};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const PropertyValueWrapper = styled.div`
  flex: 1;
  min-width: 0;
`;

const RemovePropertyButton = styled(NudeButton)`
  opacity: 0;
  color: ${(props) => props.theme.textTertiary};

  ${PropertyRowContainer}:hover & {
    opacity: 1;
  }

  &:focus-visible {
    opacity: 1;
  }

  &:hover {
    color: ${(props) => props.theme.text};
  }
`;

// Pill styles for multi-select

const PillsRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  min-height: 28px;
`;

const Pill = styled.span<{ $color: string }>`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 500;
  background: ${(props) => transparentize(0.85, props.$color)};
  color: ${(props) => props.theme.text};
  white-space: nowrap;
`;

const PillRemove = styled(NudeButton)`
  color: ${(props) => props.theme.textTertiary};
  flex-shrink: 0;

  &:hover {
    color: ${(props) => props.theme.text};
  }
`;

const PlaceholderText = styled.span`
  font-size: 13px;
  color: ${(props) => props.theme.textTertiary};
`;

const EmptyValue = styled.span`
  font-size: 13px;
  color: ${(props) => props.theme.textTertiary};
`;

const AddPillButton = styled(NudeButton)`
  border: 1.5px dashed ${(props) => props.theme.textTertiary};
  border-radius: 50%;
  color: ${(props) => props.theme.textTertiary};
  display: inline-flex;
  align-items: center;
  justify-content: center;

  &:hover {
    color: ${(props) => props.theme.text};
    border-color: ${(props) => props.theme.text};
  }
`;

// Picker popover styles

const PickerItem = styled.button`
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 12px;
  border: none;
  background: none;
  cursor: var(--pointer);
  font-size: 14px;
  color: ${(props) => props.theme.text};
  text-align: left;
  border-radius: 4px;

  &:hover {
    background: ${(props) => props.theme.listItemHoverBackground};
  }
`;

const PickerTypeBadge = styled.span`
  margin-left: auto;
  font-size: 11px;
  color: ${(props) => props.theme.textTertiary};
  text-transform: uppercase;
  letter-spacing: 0.03em;
`;

const PickerDivider = styled.hr`
  border: none;
  border-top: 1px solid ${(props) => props.theme.divider};
  margin: 4px 0;
`;

const PickerEmpty = styled.div`
  padding: 8px 12px;
`;

// Inline create form inside popover

const InlineCreateForm = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px 12px;
`;

const InlineCreateButtons = styled.div`
  display: flex;
  gap: 8px;
  justify-content: flex-end;
`;

const OptionsSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const OptionRow = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
`;

// Multi-select dropdown styles

const DropdownItem = styled.button`
  display: block;
  width: 100%;
  padding: 6px 12px;
  border: none;
  background: none;
  cursor: var(--pointer);
  font-size: 13px;
  color: ${(props) => props.theme.text};
  text-align: left;
  border-radius: 4px;

  &:hover {
    background: ${(props) => props.theme.listItemHoverBackground};
  }
`;

const NewOptionInput = styled.input`
  width: 100%;
  padding: 6px 12px;
  border: none;
  border-top: 1px solid ${(props) => props.theme.divider};
  background: none;
  font-size: 13px;
  color: ${(props) => props.theme.text};
  outline: none;

  &::placeholder {
    color: ${(props) => props.theme.placeholder};
  }
`;
